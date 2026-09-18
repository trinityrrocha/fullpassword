const crypto = require('crypto');
const argon2 = require('argon2');
const db = require('../config/database');
const { recordAuditEvent } = require('../services/auditService');
const audit = (client,req,action,metadata) => recordAuditEvent({queryable:client,throwOnError:true,user:req.user,req,action,status:'success',metadata});
const { requireClientPermission, canManageClientShares, normalizePermissionSet } = require('../services/accessControlService');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, statusCode=409) => { throw Object.assign(new Error(code), { code, statusCode }); };
const categories = new Set(['cPanel','VPN','Servidor TS','Servidor Linux','Servidores Diversos','Dispositivos','__history']);
const MAX_RECORDS = 20000;
const MAX_CIPHERTEXT_BYTES = 64 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validateCapacity = (count, bytes) => {
  if(count > MAX_RECORDS || bytes > MAX_CIPHERTEXT_BYTES) fail('VAULT_CAPACITY_EXCEEDED',413);
};
const envelopeValid = value => value?.version === 2 && typeof value.iv === 'string' && Buffer.from(value.iv,'base64').length === 12 && typeof value.ciphertext === 'string' && value.ciphertext.length >= 24 && value.ciphertext.length <= 16*1024*1024;
const transaction = handler => async (req,res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)',[8142027]);
    const result = await handler(req,client);
    await client.query('COMMIT');
    res.status(result?.status || 200).json(result?.body ?? result ?? {});
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    if (!error.statusCode) console.error('Falha na operação criptográfica.', { code:error.code || 'CRYPTO_OPERATION_FAILED' });
    const messages={
      LEGACY_DIRECT_SHARES_REQUIRE_REVIEW:'Este cofre possui compartilhamentos diretos legados. A migração exige revisão pelo operador; os dados e compartilhamentos foram preservados.',
      VAULT_CAPACITY_EXCEEDED:'O cofre atingiu o limite seguro de registros ou tamanho. Nenhuma alteração foi salva; solicite revisão pelo operador.'
    };
    res.status(error.statusCode || 500).json({ code:error.statusCode ? error.code : 'CRYPTO_OPERATION_FAILED', error:messages[error.code] || (error.statusCode ? error.code : 'Não foi possível concluir a operação criptográfica.') });
  } finally { client.release(); }
};
const lockVault = async (client,id,user,manage=false) => {
  const row=(await client.query('SELECT * FROM clients WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row) fail('VAULT_NOT_FOUND',404);
  await requireClientPermission(id,user,'view',client);
  if(manage && !(await canManageClientShares(id,user,client))) fail('VAULT_OWNER_REQUIRED',403);
  return row;
};
const currentShares = async (client,id) => (await client.query('SELECT group_id,can_view,can_edit,can_add,can_delete FROM client_group_access WHERE client_id=$1 ORDER BY group_id',[id])).rows;
const normalizeShares = shares => {
  if(!Array.isArray(shares) || shares.length>500) fail('INVALID_SHARES',400);
  const result=shares.map(share=>({group_id:share.group_id,...normalizePermissionSet(share)})).filter(share=>share.can_view);
  if(new Set(result.map(row=>row.group_id)).size!==result.length) fail('DUPLICATE_GROUP',400);
  return result.sort((a,b)=>String(a.group_id).localeCompare(String(b.group_id)));
};
const recipients = async (client,vault,shares) => {
  // Legacy direct shares are item-scoped, not vault-wide grants. Do not silently
  // delete them or broaden them to a whole-vault DEK during migration.
  if((await client.query(`SELECT 1 FROM vault_shares vs JOIN vault_items vi ON vi.id=vs.vault_item_id
    WHERE vi.client_id=$1 LIMIT 1`,[vault.id])).rowCount) fail('LEGACY_DIRECT_SHARES_REQUIRE_REVIEW');
  const ids=shares.filter(share=>share.can_view).map(share=>share.group_id);
  const rows=(await client.query(`SELECT DISTINCT u.id,u.name,u.email,u.crypto_identity
    FROM users u WHERE u.is_active=TRUE AND (u.id=$1 OR EXISTS(
      SELECT 1 FROM user_groups ug JOIN groups g ON g.id=ug.group_id
      WHERE ug.user_id=u.id AND ug.group_id=ANY($2::uuid[]) AND g.can_view=TRUE)) ORDER BY u.id`,[vault.created_by,ids])).rows;
  if(rows.some(row=>!row.crypto_identity)) fail('RECIPIENT_IDENTITY_MIGRATION_REQUIRED');
  return rows.map(row=>({userId:row.id,name:row.name,email:row.email,publicKey:row.crypto_identity.publicKey,fingerprint:row.crypto_identity.fingerprint}));
};
const source = async (client,vault) => {
  const records=vault.crypto_epoch>0
    ? (await client.query('SELECT * FROM vault_records WHERE client_id=$1 ORDER BY id',[vault.id])).rows
    : (await client.query('SELECT * FROM vault_items WHERE client_id=$1 ORDER BY created_at DESC,id',[vault.id])).rows;
  return {records,hash:digest({epoch:vault.crypto_epoch,revision:String(vault.crypto_revision),records})};
};
const validateRecords = (records,epoch) => {
  if(!Array.isArray(records) || records.length>MAX_RECORDS) fail('INVALID_RECORDS',400);
  const seen=new Set(), identities=new Set();
  for(const row of records) {
    const identity=JSON.stringify([row.category,row.collection,row.entity_id]);
    if(!uuid.test(row.id) || seen.has(row.id) || identities.has(identity) || !categories.has(row.category) ||
      typeof row.collection!=='string' || !['cpanels','servers','users','sshCredentials','devices','deviceLogins','__config','snapshots'].includes(row.collection) ||
      typeof row.entity_id!=='string' || !row.entity_id || row.entity_id.length>128 ||
      !Number.isSafeInteger(row.revision) || row.revision<1 || row.epoch!==epoch || !envelopeValid(row.envelope)) fail('INVALID_RECORD',400);
    seen.add(row.id); identities.add(identity);
  }
  validateCapacity(records.length,records.reduce((bytes,row)=>bytes+Buffer.byteLength(row.envelope.ciphertext),0));
};
const validateEnvelopes = (envelopes,targets,id,epoch) => {
  if(!Array.isArray(envelopes) || envelopes.length!==targets.length) fail('RECIPIENT_SET_CHANGED');
  for(const target of targets) {
    const matching=envelopes.filter(e=>e.userId===target.userId);
    if(matching.length!==1) fail('RECIPIENT_SET_CHANGED');
    const e=matching[0];
    if(e.version!==2 || e.vaultId!==id || e.epoch!==epoch || e.fingerprint!==target.fingerprint ||
      typeof e.ciphertext!=='string' || Buffer.from(e.ciphertext,'base64').length!==384) fail('INVALID_KEY_ENVELOPE',400);
  }
};
const getIdentity = transaction(async(req,client)=>{
  const row=(await client.query('SELECT crypto_identity,wrapped_key,crypto_salt,public_key,encrypted_private_key,kdf_version,kdf_name,kdf_hash,kdf_iterations FROM users WHERE id=$1',[req.user.id])).rows[0];
  return {identity:row.crypto_identity,legacy:row.wrapped_key ? {...row,crypto_identity:undefined} : null};
});
const saveIdentity = transaction(async(req,client)=>{
  const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
  if(user.crypto_identity) fail('IDENTITY_ALREADY_INITIALIZED');
  if(typeof req.body.current_password!=='string' || !(await argon2.verify(user.hash_senha_login,req.body.current_password))) fail('REAUTH_REQUIRED',403);
  const mfa=(await client.query('SELECT enabled FROM user_mfa_settings WHERE user_id=$1',[user.id])).rows[0];
  if(mfa?.enabled) await require('../services/sensitiveFactorService').consumeTotp(client,user.id,req.body.mfa_code);
  const identity=req.body.identity;
  if(identity?.version!==2 || identity.userId!==user.id || identity.kdf?.name!=='PBKDF2' || identity.kdf?.hash!=='SHA-256' ||
    identity.kdf?.iterations!==600000 || Buffer.from(identity.salt || '', 'base64').length!==32 ||
    !envelopeValid(identity.wrappedMasterKey) || !envelopeValid(identity.encryptedPrivateKey) ||
    (user.wrapped_key && !envelopeValid(identity.legacyArchive))) fail('INVALID_IDENTITY',400);
  const publicKey=crypto.createPublicKey({key:Buffer.from(identity.publicKey,'base64'),format:'der',type:'spki'});
  if(publicKey.asymmetricKeyType!=='rsa' || publicKey.asymmetricKeyDetails.modulusLength!==3072 ||
    identity.fingerprint!==crypto.createHash('sha256').update(Buffer.from(identity.publicKey,'base64')).digest('base64')) fail('INVALID_IDENTITY',400);
  // Only the authenticated holder can publish once. No admin directory replacement.
  const safeIdentity={version:2,userId:user.id,kdf:identity.kdf,salt:identity.salt,publicKey:identity.publicKey,fingerprint:identity.fingerprint,
    wrappedMasterKey:identity.wrappedMasterKey,encryptedPrivateKey:identity.encryptedPrivateKey,legacyArchive:identity.legacyArchive || null};
  await client.query('UPDATE users SET crypto_identity=$1 WHERE id=$2',[safeIdentity,user.id]);
  await audit(client,req,'crypto_identity_initialized',{version:2});
  return {identity:safeIdentity};
});
const getState = transaction(async(req,client)=>{
  const vault=await lockVault(client,req.params.id,req.user);
  const ownEnvelope=(await client.query('SELECT envelope FROM vault_crypto_envelopes WHERE client_id=$1 AND epoch=$2 AND user_id=$3',[vault.id,vault.crypto_epoch,req.user.id])).rows[0]?.envelope;
  const data=await source(client,vault);
  const stage=(await client.query("SELECT * FROM vault_migration_stages WHERE client_id=$1 AND actor_id=$2 AND state='staging'",[vault.id,req.user.id])).rows[0];
  return {epoch:vault.crypto_epoch,revision:String(vault.crypto_revision),rotationRequired:vault.rotation_required,ownerId:vault.created_by,
    envelope:ownEnvelope,records:data.records,sourceHash:data.hash,stage:stage || null};
});
const getRecipients = transaction(async(req,client)=>{
  const vault=await lockVault(client,req.params.id,req.user,true);
  const shares=req.body.shares ? normalizeShares(req.body.shares) : await currentShares(client,vault.id);
  const targets=await recipients(client,vault,shares);
  return {recipients:targets,recipientsHash:digest(targets),shares};
});
const stageEpoch = transaction(async(req,client)=>{
  const vault=await lockVault(client,req.params.id,req.user,true);
  if(vault.created_by!==req.user.id) fail('OWNER_MIGRATION_REQUIRED',403);
  const data=await source(client,vault);
  if(req.body.sourceHash!==data.hash) fail('SOURCE_CHANGED');
  const shares=normalizeShares(req.body.shares);
  const targets=await recipients(client,vault,shares);
  const epoch=vault.crypto_epoch+1;
  validateRecords(req.body.records,epoch);
  validateEnvelopes(req.body.envelopes,targets,vault.id,epoch);
  if(vault.crypto_epoch>0 && req.body.records.length>0) {
    // Rotation cannot add/remove records or change structural metadata.
    const structural=rows=>rows.map(r=>[r.id,r.category,r.collection,r.entity_id,r.revision,!!r.deleted]).sort((a,b)=>a[0].localeCompare(b[0]));
    if(digest(structural(data.records))!==digest(structural(req.body.records))) fail('ROTATION_RECORD_SET_CHANGED');
  }
  const count=req.body.recordCount ?? req.body.records.length;
  if(!Number.isInteger(count) || count<req.body.records.length || count>20000) fail('INVALID_RECORD_COUNT',400);
  const manifestHash=digest(req.body.records);
  const id=crypto.randomUUID();
  const existing=(await client.query("SELECT id FROM vault_migration_stages WHERE client_id=$1 AND state='staging'",[vault.id])).rows[0];
  if(existing) fail('MIGRATION_ALREADY_STAGED');
  await client.query(`INSERT INTO vault_migration_stages(id,client_id,actor_id,source_revision,source_hash,target_epoch,recipients_hash,shares,records,envelopes,manifest_hash,record_count)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,vault.id,req.user.id,vault.crypto_revision,data.hash,epoch,digest(targets),JSON.stringify(shares),JSON.stringify(req.body.records),JSON.stringify(req.body.envelopes),manifestHash,count]);
  return {id,manifestHash};
});
const appendStage = transaction(async(req,client)=>{
  const vault=await lockVault(client,req.params.id,req.user,true);
  const stage=(await client.query("SELECT * FROM vault_migration_stages WHERE id=$1 AND client_id=$2 AND actor_id=$3 AND state='staging' FOR UPDATE",[req.params.stageId,vault.id,req.user.id])).rows[0];
  if(!stage) fail('STAGE_NOT_FOUND',404);
  if(!Array.isArray(req.body.records) || req.body.records.length>1000) fail('INVALID_RECORDS',400);
  const rows=[...stage.records,...req.body.records];
  if(rows.length>stage.record_count) fail('STAGE_COUNT_EXCEEDED',400);
  validateRecords(rows,stage.target_epoch);
  await client.query('UPDATE vault_migration_stages SET records=$2,manifest_hash=$3 WHERE id=$1',[stage.id,JSON.stringify(rows),digest(rows)]);
  return {received:rows.length};
});
const abortStage = transaction(async(req,client)=>{
  await lockVault(client,req.params.id,req.user,true);
  await client.query("UPDATE vault_migration_stages SET state='aborted' WHERE id=$1 AND client_id=$2 AND actor_id=$3 AND state='staging'",[req.params.stageId,req.params.id,req.user.id]);
  return {aborted:true};
});
const activateEpoch = transaction(async(req,client)=>{
  const vault=await lockVault(client,req.params.id,req.user,true);
  const stage=(await client.query('SELECT * FROM vault_migration_stages WHERE id=$1 AND client_id=$2 AND actor_id=$3 FOR UPDATE',[req.params.stageId,vault.id,req.user.id])).rows[0];
  if(!stage || stage.state==='aborted') fail('STAGE_NOT_FOUND',404);
  if(stage.state==='active') return {epoch:stage.target_epoch};
  if(stage.manifest_hash!==req.body.verifiedManifestHash) fail('CLIENT_VERIFICATION_REQUIRED');
  const data=await source(client,vault);
  if(stage.source_hash!==data.hash || String(stage.source_revision)!==String(vault.crypto_revision)) fail('SOURCE_CHANGED');
  const targets=await recipients(client,vault,stage.shares);
  if(digest(targets)!==stage.recipients_hash) fail('RECIPIENT_SET_CHANGED');
  if(stage.records.length!==stage.record_count) fail('STAGE_INCOMPLETE');
  if(vault.crypto_epoch>0) {
    const structural=rows=>rows.map(r=>[r.id,r.category,r.collection,r.entity_id,r.revision,!!r.deleted]).sort((a,b)=>a[0].localeCompare(b[0]));
    if(digest(structural(data.records))!==digest(structural(stage.records))) fail('ROTATION_RECORD_SET_CHANGED');
  }
  validateRecords(stage.records,stage.target_epoch); validateEnvelopes(stage.envelopes,targets,vault.id,stage.target_epoch);
  await client.query('INSERT INTO vault_crypto_epochs(client_id,epoch,created_by) VALUES($1,$2,$3)',[vault.id,stage.target_epoch,req.user.id]);
  await client.query(`INSERT INTO vault_record_history(client_id,id,revision,epoch,category,collection,entity_id,envelope)
    SELECT client_id,id,revision,epoch,category,collection,entity_id,envelope FROM vault_records WHERE client_id=$1 ON CONFLICT DO NOTHING`,[vault.id]);
  await client.query('DELETE FROM vault_records WHERE client_id=$1',[vault.id]);
  for(const row of stage.records) await client.query(`INSERT INTO vault_records(client_id,id,category,collection,entity_id,revision,epoch,envelope,deleted)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[vault.id,row.id,row.category,row.collection,row.entity_id,row.revision,row.epoch,row.envelope,!!row.deleted]);
  // ACL and new envelopes activate together; old recipients lose obsolete envelopes.
  await client.query('DELETE FROM client_group_access WHERE client_id=$1',[vault.id]);
  for(const share of stage.shares) await client.query('INSERT INTO client_group_access(client_id,group_id,can_view,can_edit,can_add,can_delete) VALUES($1,$2,$3,$4,$5,$6)',[vault.id,share.group_id,share.can_view,share.can_edit,share.can_add,share.can_delete]);
  await client.query('DELETE FROM vault_crypto_envelopes WHERE client_id=$1 AND user_id<>$2',[vault.id,vault.created_by]);
  for(const e of stage.envelopes) await client.query('INSERT INTO vault_crypto_envelopes(client_id,epoch,user_id,identity_fingerprint,envelope) VALUES($1,$2,$3,$4,$5)',[vault.id,stage.target_epoch,e.userId,e.fingerprint,e]);
  await client.query('DELETE FROM client_key_shares WHERE client_id=$1',[vault.id]);
  await client.query('DELETE FROM vault_shares WHERE vault_item_id IN (SELECT id FROM vault_items WHERE client_id=$1)',[vault.id]);
  await client.query('UPDATE clients SET crypto_epoch=$2,crypto_revision=crypto_revision+1,rotation_required=false WHERE id=$1',[vault.id,stage.target_epoch]);
  await client.query("UPDATE vault_migration_stages SET state='active' WHERE id=$1",[stage.id]);
  await audit(client,req,'vault_epoch_activated',{client_id:vault.id,epoch:stage.target_epoch,record_count:stage.records.length,recipient_count:targets.length});
  return {epoch:stage.target_epoch};
});
const mutateRecords = transaction(async(req,client)=>{
  const vault=await lockVault(client,req.params.id,req.user);
  if(!vault.crypto_epoch) fail('VAULT_MIGRATION_REQUIRED');
  if(vault.rotation_required) fail('VAULT_ROTATION_REQUIRED');
  if(req.body.epoch!==vault.crypto_epoch || String(req.body.revision)!==String(vault.crypto_revision)) fail('VAULT_VERSION_CONFLICT');
  const mutations=req.body.mutations;
  if(!Array.isArray(mutations) || mutations.length>1000) fail('INVALID_MUTATIONS',400);
  const seen=new Set();
  for(const mutation of mutations) {
    if(!uuid.test(mutation.id)) fail('INVALID_RECORD_ID',400);
    if(seen.has(mutation.id)) fail('DUPLICATE_MUTATION',400); seen.add(mutation.id);
    const current=(await client.query('SELECT * FROM vault_records WHERE client_id=$1 AND id=$2 FOR UPDATE',[vault.id,mutation.id])).rows[0];
    if(mutation.kind==='create') {
      await requireClientPermission(vault.id,req.user,'add',client);
      if(current) fail('RECORD_ALREADY_EXISTS');
      validateRecords([mutation],vault.crypto_epoch);
      if(mutation.collection==='__config') await requireClientPermission(vault.id,req.user,'edit',client);
      if(mutation.revision!==1 || mutation.collection==='__history' || mutation.category==='__history') fail('INVALID_RECORD',400);
      await client.query('INSERT INTO vault_records(client_id,id,category,collection,entity_id,revision,epoch,envelope) VALUES($1,$2,$3,$4,$5,1,$6,$7)',[vault.id,mutation.id,mutation.category,mutation.collection,mutation.entity_id,vault.crypto_epoch,mutation.envelope]);
    } else if(mutation.kind==='update' || mutation.kind==='delete') {
      await requireClientPermission(vault.id,req.user,mutation.kind==='update'?'edit':'delete',client);
      if(!current || current.deleted || mutation.expectedRevision!==current.revision) fail('RECORD_VERSION_CONFLICT');
      if(current.category==='__history') fail('HISTORY_IMMUTABLE',403);
      await client.query('INSERT INTO vault_record_history(client_id,id,revision,epoch,category,collection,entity_id,envelope) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[vault.id,current.id,current.revision,current.epoch,current.category,current.collection,current.entity_id,current.envelope]);
      if(mutation.kind==='delete') await client.query('UPDATE vault_records SET deleted=true WHERE client_id=$1 AND id=$2',[vault.id,current.id]);
      else {
        if(!envelopeValid(mutation.envelope)) fail('INVALID_RECORD',400);
        await client.query('UPDATE vault_records SET revision=revision+1,envelope=$3 WHERE client_id=$1 AND id=$2',[vault.id,current.id,mutation.envelope]);
      }
    } else fail('INVALID_MUTATION',400);
  }
  // Count tombstones as well: rotation carries them, so allowing unlimited
  // creates/deletes would produce a vault that can no longer be rotated.
  const capacity=(await client.query(`SELECT count(*)::int AS count,
    COALESCE(sum(octet_length(envelope->>'ciphertext')),0)::bigint AS bytes
    FROM vault_records WHERE client_id=$1`,[vault.id])).rows[0];
  validateCapacity(capacity.count,Number(capacity.bytes));
  await client.query('UPDATE clients SET crypto_revision=crypto_revision+1 WHERE id=$1',[vault.id]);
  await audit(client,req,'vault_records_updated',{client_id:vault.id,epoch:vault.crypto_epoch,count:mutations.length});
  return {saved:mutations.length};
});
module.exports={getIdentity,saveIdentity,getState,getRecipients,stageEpoch,appendStage,activateEpoch,abortStage,mutateRecords,digest,validateCapacity};
