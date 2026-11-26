// Disposable native PostgreSQL (not PGlite). Never accepts a remote database URL.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function run() {
  const poolSockets = new WeakMap();
  const trackPool = pool => {
    const pending = new Set(); poolSockets.set(pool,pending);
    pool.on('connect',client=>{
      const ended = new Promise(resolve=>client.once('end',resolve));
      pending.add(ended);ended.then(()=>pending.delete(ended));
    });
  };
  const drainPool = async pool => {
    await pool.end();
    // pg-pool can resolve end() before the clients' protocol/socket shutdown.
    // Wait for those end events before terminating the disposable server.
    await Promise.all([...(poolSockets.get(pool) || [])]);
  };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fullpassword-audit-test-'));
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  const databasePassword = crypto.randomBytes(32).toString('hex');
  const postgres = new EmbeddedPostgres({
    databaseDir: path.join(directory, 'pgdata'), user: 'postgres', password:databasePassword, port,
    persistent: true, authMethod: 'scram-sha-256',
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {}
  });
  let database; let httpServer;
  try {
    console.log('Integration: initializing isolated PostgreSQL.');
    await postgres.initialise();
    await postgres.start();
    console.log('Integration: PostgreSQL started.');
    Object.assign(process.env, {
      DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'postgres',
      DB_PASSWORD: databasePassword, DB_NAME: 'postgres', NODE_ENV: 'test',
      JWT_SECRET: crypto.randomBytes(64).toString('hex'),
      CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      ADMIN_BOOTSTRAP_TOKEN: crypto.randomBytes(64).toString('hex'),
      APP_ORIGIN: 'http://127.0.0.1', SUPER_ADMIN_EMAIL: 'audit@example.invalid',
      BACKUP_TEMP_DIR: path.join(directory, 'uploads')
    });
    database = require('../src/config/database');
    trackPool(database.pool);
    await require('./legacy-upgrade-fixture').prepareLegacySchema(database);
    global.window=globalThis;
    // Populate representative data BEFORE applying any new schema guards.
    const legacyService=await import(require('node:url').pathToFileURL(path.join(__dirname,'../../frontend/src/services/cryptoService.js')));
    const argonBefore=require('argon2');
    const password='SYNTHETIC_Login_!'+crypto.randomBytes(12).toString('hex');
    const owner=crypto.randomUUID(),legacyRecipient=crypto.randomUUID(),legacyVault=crypto.randomUUID();
    const oldKey=await legacyService.generateMasterKey(),oldSalt=crypto.randomBytes(32).toString('hex');
    const oldParams={version:1,name:'PBKDF2',hash:'SHA-256',iterations:100000};
    const oldWrapped=await legacyService.wrapMasterKey(oldKey,await legacyService.deriveMasterKey(password,oldSalt,oldParams));
    await database.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin,wrapped_key,crypto_salt,kdf_version,kdf_name,kdf_hash,kdf_iterations) VALUES($1,'SYNTHETIC_OWNER','owner@example.invalid',$2,'admin',true,$3,$4,1,'PBKDF2','SHA-256',100000)",[owner,await argonBefore.hash(password),oldWrapped,oldSalt]);
    await database.query("INSERT INTO users(id,name,email,hash_senha_login,role) VALUES($1,'SYNTHETIC_ITEM_RECIPIENT','item@example.invalid',$2,'user')",[legacyRecipient,await argonBefore.hash(password)]);
    await database.query("INSERT INTO clients(id,name,created_by) VALUES($1,'SYNTHETIC_LEGACY',$2)",[legacyVault,owner]);
    const legacyData={servers:[{id:'old-server',name:'SYNTHETIC_LEGACY_RECORD'}],users:[]};
    const cipher=await legacyService.encryptData(legacyData,oldKey);
    const attachment={filename:'synthetic.txt',content:'SYNTHETIC_ATTACHMENT_ONLY'};
    const attachmentCipher=await legacyService.encryptData(attachment,oldKey);
    const legacyItem=(await database.query("INSERT INTO vault_items(client_id,category,encrypted_data,encrypted_attachment,created_by) VALUES($1,'Servidor TS',$2,$3,$4) RETURNING id",[legacyVault,cipher,attachmentCipher,owner])).rows[0].id;
    const historicData={servers:[{id:'old-server',name:'SYNTHETIC_PREVIOUS_VERSION'}],users:[]};
    const historicItem=(await database.query("INSERT INTO vault_items(client_id,category,encrypted_data,created_by,created_at) VALUES($1,'Servidor TS',$2,$3,CURRENT_TIMESTAMP-INTERVAL '1 hour') RETURNING id",[legacyVault,await legacyService.encryptData(historicData,oldKey),owner])).rows[0].id;
    await database.query('INSERT INTO vault_shares(vault_item_id,user_id,encrypted_vault_key) VALUES($1,$2,$3)',[legacyItem,legacyRecipient,'SYNTHETIC_LEGACY_ENVELOPE']);
    const existingGroup=crypto.randomUUID();
    await database.query("INSERT INTO groups(id,name,can_view,can_edit,can_add,can_delete) VALUES($1,'SYNTHETIC_EXISTING_READER',true,false,false,false)",[existingGroup]);
    await database.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2)',[legacyRecipient,existingGroup]);
    // A distinct old vault for group access; direct access to legacyVault must stay item-only.
    const existingGroupVault=crypto.randomUUID();
    await database.query("INSERT INTO clients(id,name,created_by) VALUES($1,'SYNTHETIC_OLD_GROUP_VAULT',$2)",[existingGroupVault,owner]);
    await database.query('INSERT INTO client_group_access(client_id,group_id,can_view,can_edit,can_add,can_delete) VALUES($1,$2,true,false,false,false)',[existingGroupVault,existingGroup]);
    await require('../src/config/securitySchema').ensureSecuritySchema();
    await require('../src/config/securitySchema').ensureSecuritySchema();
    assert.equal((await database.query('SELECT encrypted_data FROM vault_items WHERE id=$1',[legacyItem])).rows[0].encrypted_data,cipher);
    assert.equal((await database.query('SELECT count(*)::int n FROM vault_shares WHERE vault_item_id=$1',[legacyItem])).rows[0].n,1);
    assert.equal((await database.query('SELECT can_edit FROM client_group_access WHERE client_id=$1',[existingGroupVault])).rows[0].can_edit,false);
    console.log('PASS d9a7a37 -> current schema: pre-existing users, group/item grants, limited permissions, snapshots and attachment preserved.');
    console.log('Integration: schema ready.');
    const stagingSql = await fs.readFile(path.join(__dirname, '../../database/migrations/21_stage_isolated_vault_crypto.sql'), 'utf8');
    await database.query(stagingSql);
    await database.query(stagingSql); // Additive migration must be idempotent.
    console.log((await database.query('SELECT version()')).rows[0].version);

    global.window=globalThis;
    const {pathToFileURL}=require('node:url');
    const frontend=async file=>import(pathToFileURL(path.join(__dirname,'../../frontend/src/services',file)));
    const {ensureUserCryptoIdentity,unlockUserIdentity}=await frontend('userCryptoIdentityService.js');
    const {VaultSession}=await frontend('vaultSessionService.js');
    const v2=await frontend('vaultCryptoV2.js');
    const legacy=await frontend('cryptoService.js');
    const argon2=require('argon2');
    await database.query("CREATE ROLE audit_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE");
    await database.query('GRANT USAGE ON SCHEMA public TO audit_runtime');
    await database.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO audit_runtime');
    await database.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO audit_runtime');
    const leastPrivilege=await database.pool.connect();
    try {
      await leastPrivilege.query('SET ROLE audit_runtime');
      await leastPrivilege.query('SELECT crypto_identity FROM users LIMIT 0');
      const verifyRuntimeSchema=require('../src/config/verifyRuntimeSchema').verifyRuntimeSchema;
      await verifyRuntimeSchema(leastPrivilege);
      for(const table of ['system_modules','spfbl_settings','spfbl_whm_servers','spfbl_domains','spfbl_user_access','spfbl_user_domains','spfbl_requests','spfbl_operations','spfbl_release_events','dm_settings','dm_domains','dm_snapshots','dm_changes','dm_alert_settings','dm_notifications_sent']) {
        assert.equal((await leastPrivilege.query("SELECT has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE,DELETE') AS ok",[table])).rows[0].ok,true,'runtime role must read and write '+table);
        await leastPrivilege.query(`SELECT * FROM ${table} LIMIT 0`);
      }
      await leastPrivilege.query('RESET ROLE');
      await database.query('GRANT CREATE ON SCHEMA public TO audit_runtime');
      await leastPrivilege.query('SET ROLE audit_runtime');
      await assert.rejects(verifyRuntimeSchema(leastPrivilege),/PRIVILEGED_RUNTIME_DATABASE_ROLE/);
      await leastPrivilege.query('RESET ROLE');
      await database.query('REVOKE CREATE ON SCHEMA public FROM audit_runtime');
      await leastPrivilege.query('SET ROLE audit_runtime');
      await assert.rejects(leastPrivilege.query('ALTER TABLE users ADD COLUMN forbidden_test TEXT'),e=>e.code==='42501');
    } finally {await leastPrivilege.query('RESET ROLE');leastPrivilege.release();}
    const {app}=require('../src/server');
    const releasePublic=path.join(directory,'release-public'),releaseQueue=path.join(directory,'release-queue');
    await fs.mkdir(releasePublic);await fs.mkdir(releaseQueue);
    const publicDiscovery={state:'available',release:{revision:'e'.repeat(40),changes:[{type:'security',title:'SYNTHETIC_PUBLIC_RELEASE'}]},stale:false};
    const releaseFixture=require('../src/controllers/releaseController').createController(releasePublic,releaseQueue,async()=>publicDiscovery);
    app.get('/api/release-test',require('../src/middleware/authMiddleware').verifyToken,releaseFixture.status);
    app.post('/api/release-test',require('../src/middleware/authMiddleware').verifyToken,(req,res,next)=>Promise.resolve(releaseFixture.request(req,res)).catch(next));
    // server.js ends /api with a JSON 404; fixture routes added after load must sit before it.
    const stack=app._router.stack,notFound=stack.findIndex(layer=>layer.name==='apiNotFound');
    assert.notEqual(notFound,-1,'apiNotFound layer missing');
    stack.push(...stack.splice(notFound,1));
    httpServer=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
    const base='http://127.0.0.1:'+httpServer.address().port+'/api';
    function browserClient() {
      const cookies={}; const payloads=[];
      const call=async(method,url,data,retries=0,withoutCsrf=false)=>{
        const headers={'Content-Type':'application/json',Cookie:Object.entries(cookies).map(([k,v])=>k+'='+v).join('; ')};
        if(cookies.fp_csrf && !withoutCsrf) headers['x-csrf-token']=cookies.fp_csrf;
        if(data) payloads.push(JSON.stringify(data));
        const response=await fetch(base+url,{method,headers,body:data?JSON.stringify(data):undefined});
        for(const value of response.headers.getSetCookie()) { const pair=value.split(';')[0], index=pair.indexOf('=');cookies[pair.slice(0,index)]=pair.slice(index+1); }
        const body=await response.json();
        if(response.status===429 && body.code==='RATE_LIMIT_EXCEEDED' && retries<2) {
          console.log('Integration: honoring API rate-limit window.');
          await new Promise(resolve=>setTimeout(resolve,Math.min(60000,Math.max(1000,body.retry_after_seconds*1000+200))));
          return call(method,url,data,retries+1,withoutCsrf);
        }
        if(!response.ok) throw Object.assign(new Error(body.code || body.error),{response:{status:response.status,data:body}});
        return {data:body,status:response.status};
      };
      return {get:url=>call('GET',url),post:(url,data)=>call('POST',url,data),postWithoutCsrf:(url,data)=>call('POST',url,data,0,true),put:(url,data)=>call('PUT',url,data),delete:(url,data)=>call('DELETE',url,data),payloads};
    }
    const ownerApi=browserClient();
    let ownerUser=(await ownerApi.post('/auth/login',{email:'owner@example.invalid',password})).data.user;
    assert.equal(ownerUser.id,owner);
    assert.equal(ownerUser.mfa_enabled,false);
    assert.equal((await ownerApi.get('/auth/me')).data.user.mfa_enabled,false);
    assert.ok(!('hash_senha_login' in ownerUser));
    const secret='SYNTHETIC_Unlock_'+crypto.randomBytes(24).toString('hex');
    ownerUser=(await ensureUserCryptoIdentity({user:ownerUser,password,unlockSecret:secret,saveIdentity:payload=>ownerApi.post('/crypto/identity',payload).then(r=>r.data)})).user;
    const ownerKeys=await unlockUserIdentity(ownerUser,secret);
    assert.ok(ownerKeys.legacyMasterKey);
    assert.ok(ownerApi.payloads.every(p=>!p.includes(secret)));
    await assert.rejects(unlockUserIdentity(ownerUser,password),'login password cannot open identity');
    await assert.rejects(ownerApi.post('/crypto/identity',{identity:ownerUser.crypto_identity,current_password:password}),e=>e.response.status===409);

    const newAccount=(await ownerApi.post('/users',{name:'SYNTHETIC_MEMBER',email:'member@example.invalid',password,role:'user'})).data;
    assert.equal((await database.query('SELECT wrapped_key FROM users WHERE id=$1',[newAccount.id])).rows[0].wrapped_key,null,'server must not generate identity');
    const memberApi=browserClient();
    let memberUser=(await memberApi.post('/auth/login',{email:'member@example.invalid',password})).data.user;
    const memberSecret='SYNTHETIC_Independent_'+crypto.randomBytes(24).toString('hex');
    memberUser=(await ensureUserCryptoIdentity({user:memberUser,password,unlockSecret:memberSecret,saveIdentity:p=>memberApi.post('/crypto/identity',p).then(r=>r.data)})).user;
    const memberKeys=await unlockUserIdentity(memberUser,memberSecret);
    const vaultA=(await ownerApi.post('/clients',{name:'SYNTHETIC_A'})).data.id;
    const vaultB=(await ownerApi.post('/clients',{name:'SYNTHETIC_B'})).data.id;
    const sessionA=new VaultSession({api:ownerApi,vaultId:vaultA,user:ownerUser,keys:ownerKeys});
    const sessionB=new VaultSession({api:ownerApi,vaultId:vaultB,user:ownerUser,keys:ownerKeys});
    await sessionA.load(); await sessionB.load();
    await sessionA.saveCategory('Dispositivos',{devices:[{id:'deviceA',name:'SYNTHETIC_ROUTER'}],deviceLogins:[]});
    await sessionB.saveCategory('Dispositivos',{devices:[{id:'deviceB',name:'SYNTHETIC_NAS'}],deviceLogins:[]});
    const rowB=sessionB.rows[0];
    await assert.rejects(v2.decryptVaultRecord(sessionA.key,{vaultId:vaultB,recordId:rowB.id,category:rowB.category+'/'+rowB.collection+'/'+rowB.entity_id,epoch:rowB.epoch,revision:rowB.revision},rowB.envelope));
    const group=crypto.randomUUID();
    await database.query("INSERT INTO groups(id,name,can_view,can_add,can_edit,can_delete) VALUES($1,'SYNTHETIC_LIMITED',true,true,false,false)",[group]);
    await database.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2)',[newAccount.id,group]);
    await sessionA.migrateOrRotate([{group_id:group,can_view:true,can_add:true,can_edit:true,can_delete:true}]);
    const member=new VaultSession({api:memberApi,vaultId:vaultA,user:memberUser,keys:memberKeys});
    await member.load();
    assert.equal(member.categories()[0].decrypted.devices[0].name,'SYNTHETIC_ROUTER');
    await member.saveCategory('Dispositivos',{devices:[...member.categories()[0].decrypted.devices,{id:'device2',name:'SYNTHETIC_ADD_ONLY'}],deviceLogins:[]});
    assert.equal(member.categories()[0].decrypted.devices.length,2);
    await assert.rejects(member.saveCategory('Dispositivos',{devices:[],deviceLogins:[]}),e=>e.response.status===403);
    await assert.rejects(member.saveCategory('Dispositivos',{devices:member.categories()[0].decrypted.devices.map(r=>({...r,name:'FORBIDDEN'})),deviceLogins:[]}),e=>e.response.status===403);
    await database.query('UPDATE groups SET can_add=false,can_edit=true WHERE id=$1',[group]);
    await member.load();
    await member.saveCategory('Dispositivos',{devices:member.categories()[0].decrypted.devices.map(r=>({...r,name:'SYNTHETIC_EDIT'})),deviceLogins:[]});
    await assert.rejects(member.saveCategory('Dispositivos',{devices:[],deviceLogins:[]}),e=>e.response.status===403);
    await database.query('UPDATE groups SET can_edit=false WHERE id=$1',[group]);
    await member.load();
    await assert.rejects(member.saveCategory('Dispositivos',{devices:[...member.categories()[0].decrypted.devices,{id:'device3',name:'NO'}]}),e=>e.response.status===403);
    assert.equal((await memberApi.get('/auth/me')).data.user.id,newAccount.id,'valid session, not auth failure');
    const revokedKey=member.key;
    const independentGroup=crypto.randomUUID();
    await database.query("INSERT INTO groups(id,name,can_view) VALUES($1,'SYNTHETIC_INDEPENDENT',true)",[independentGroup]);
    await database.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2)',[newAccount.id,independentGroup]);
    await database.query('INSERT INTO client_group_access(client_id,group_id,can_view) VALUES($1,$2,true)',[vaultA,independentGroup]);
    await database.query('DELETE FROM user_groups WHERE user_id=$1 AND group_id=$2',[newAccount.id,group]);
    assert.ok((await memberApi.get('/crypto/vaults/'+vaultA)).data.envelope,'independent authorized path preserves access');
    await database.query('DELETE FROM user_groups WHERE user_id=$1 AND group_id=$2',[newAccount.id,independentGroup]);
    await assert.rejects(memberApi.get('/crypto/vaults/'+vaultA),e=>e.response.status===404);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM vault_crypto_envelopes WHERE client_id=$1 AND user_id=$2',[vaultA,newAccount.id])).rows[0].n,0);
    await sessionA.load(); // owner rotates before further writes
    const future=sessionA.rows[0];
    await assert.rejects(v2.decryptVaultRecord(revokedKey,{vaultId:vaultA,recordId:future.id,category:future.category+'/'+future.collection+'/'+future.entity_id,epoch:future.epoch,revision:future.revision},future.envelope));
    const stale=new VaultSession({api:ownerApi,vaultId:vaultB,user:ownerUser,keys:ownerKeys});
    await stale.load();
    await sessionB.saveCategory('Dispositivos',{devices:[{id:'deviceB',name:'NEW_REVISION'}]});
    await assert.rejects(stale.saveCategory('Dispositivos',{devices:[{id:'deviceB',name:'LOST_UPDATE'}]}),e=>e.response.status===409);
    await stale.load();
    const race=await Promise.allSettled([
      stale.saveCategory('Dispositivos',{devices:[{id:'deviceB',name:'SYNTHETIC_RACE_A'}]}),
      sessionB.saveCategory('Dispositivos',{devices:[{id:'deviceB',name:'SYNTHETIC_RACE_B'}]})
    ]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(race.find(r=>r.status==='rejected').reason.response.status,409);
    const currentB=(await ownerApi.get('/crypto/vaults/'+vaultB)).data;
    await assert.rejects(ownerApi.post('/crypto/vaults/'+vaultB+'/records',{
      epoch:currentB.epoch,revision:currentB.revision,mutations:[{kind:'delete',id:'-'.repeat(36),expectedRevision:1}]
    }),e=>e.response.status===400 && e.response.data.code==='INVALID_RECORD_ID');
    const capacityGuard=require('../src/controllers/vaultCryptoController').validateCapacity;
    capacityGuard(20000,64*1024*1024);
    assert.throws(()=>capacityGuard(20001,0),e=>e.code==='VAULT_CAPACITY_EXCEEDED');
    assert.throws(()=>capacityGuard(1,64*1024*1024+1),e=>e.code==='VAULT_CAPACITY_EXCEEDED');
    const quotaVault=(await ownerApi.post('/clients',{name:'SYNTHETIC_QUOTA'})).data.id;
    const quotaSession=new VaultSession({api:ownerApi,vaultId:quotaVault,user:ownerUser,keys:ownerKeys});
    await quotaSession.load();
    await database.query(`INSERT INTO vault_records(client_id,id,category,collection,entity_id,revision,epoch,envelope,deleted)
      SELECT $1,uuid_generate_v4(),'Dispositivos','devices','quota-'||n,1,1,$2,true FROM generate_series(1,20000) n`,
      [quotaVault,{version:2,iv:Buffer.alloc(12).toString('base64'),ciphertext:'A'.repeat(24)}]);
    await assert.rejects(quotaSession.saveCategory('Dispositivos',{devices:[{id:'over-quota',name:'SYNTHETIC'}]}),
      e=>e.response.status===413 && e.response.data.code==='VAULT_CAPACITY_EXCEEDED');
    assert.equal((await database.query('SELECT count(*)::int n FROM vault_records WHERE client_id=$1',[quotaVault])).rows[0].n,20000,'quota failure rolls back inserted record');
    assert.equal((await database.query('SELECT crypto_revision FROM clients WHERE id=$1',[quotaVault])).rows[0].crypto_revision,quotaSession.state.revision,'quota failure preserves revision');
    // Remove only this synthetic quota fixture before backup; fake tombstones are not cryptographic test data.
    await database.query('DELETE FROM clients WHERE id=$1',[quotaVault]);
    console.log('PASS malformed UUID rejected and cumulative vault quota includes tombstones with transactional rollback.');

    const uninitialized=crypto.randomUUID(),missingGroup=crypto.randomUUID();
    await database.query("INSERT INTO users(id,name,email,hash_senha_login,role) VALUES($1,'SYNTHETIC_MISSING','missing@example.invalid',$2,'user')",[uninitialized,await argon2.hash(password)]);
    await database.query("INSERT INTO groups(id,name,can_view) VALUES($1,'SYNTHETIC_MISSING',true)",[missingGroup]);
    await database.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2)',[uninitialized,missingGroup]);
    await assert.rejects(ownerApi.post('/crypto/vaults/'+legacyVault+'/recipients',{shares:[{group_id:missingGroup,can_view:true}]}),
      e=>e.response.data.code==='RECIPIENT_IDENTITY_MIGRATION_REQUIRED');
    // Absent direct-recipient identity is a non-destructive blocker, resolved by that holder.
    await assert.rejects(ownerApi.post('/crypto/vaults/'+legacyVault+'/recipients',{}),
      e=>e.response.status===409 && e.response.data.code==='RECIPIENT_IDENTITY_MIGRATION_REQUIRED');
    assert.equal((await database.query('SELECT count(*)::int n FROM vault_shares WHERE vault_item_id=$1',[legacyItem])).rows[0].n,1,'direct item grants must not be silently deleted');
    const directApi=browserClient();
    let directUser=(await directApi.post('/auth/login',{email:'item@example.invalid',password})).data.user;
    const directSecret='SYNTHETIC_Direct_Unlock_'+crypto.randomBytes(24).toString('hex');
    directUser=(await ensureUserCryptoIdentity({user:directUser,password,unlockSecret:directSecret,saveIdentity:p=>directApi.post('/crypto/identity',p).then(r=>r.data)})).user;
    const directKeys=await unlockUserIdentity(directUser,directSecret);
    const interruptedApi={...ownerApi,post:async(url,payload)=>{if(url.endsWith('/activate'))throw new Error('SYNTHETIC_INTERRUPT');return ownerApi.post(url,payload);}};
    await assert.rejects(new VaultSession({api:interruptedApi,vaultId:legacyVault,user:ownerUser,keys:ownerKeys}).load(),/SYNTHETIC_INTERRUPT/);
    assert.equal((await ownerApi.get('/crypto/vaults/'+legacyVault)).data.epoch,0);
    // A new grant invalidates staging, but neither old nor new grants are deleted to resume.
    await database.query('INSERT INTO vault_shares(vault_item_id,user_id,encrypted_vault_key) VALUES($1,$2,$3)',[legacyItem,newAccount.id,'SYNTHETIC_LATE_GRANT']);
    const blockedStage=(await ownerApi.get('/crypto/vaults/'+legacyVault)).data.stage;
    await assert.rejects(ownerApi.post('/crypto/vaults/'+legacyVault+'/stages/'+blockedStage.id+'/activate',{verifiedManifestHash:blockedStage.manifest_hash}),
      e=>e.response.data.code==='SOURCE_CHANGED');
    assert.equal((await database.query('SELECT crypto_epoch FROM clients WHERE id=$1',[legacyVault])).rows[0].crypto_epoch,0);
    await ownerApi.delete('/crypto/vaults/'+legacyVault+'/stages/'+blockedStage.id);
    console.log('PASS changed item grants invalidate staging; resume restages without deleting any grant.');
    const resumed=new VaultSession({api:ownerApi,vaultId:legacyVault,user:ownerUser,keys:ownerKeys});
    await database.query("CREATE FUNCTION audit_fail_activation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_ACTIVATION_FAILURE'; END $$");
    await database.query('CREATE TRIGGER audit_fail_activation BEFORE INSERT ON vault_records FOR EACH ROW EXECUTE FUNCTION audit_fail_activation()');
    await assert.rejects(resumed.load(),e=>e.response.status===500);
    assert.equal((await ownerApi.get('/crypto/vaults/'+legacyVault)).data.epoch,0,'failed activation rolls back epoch');
    assert.equal((await database.query('SELECT count(*)::int n FROM vault_crypto_epochs WHERE client_id=$1',[legacyVault])).rows[0].n,0);
    await database.query('DROP TRIGGER audit_fail_activation ON vault_records');
    await database.query('DROP FUNCTION audit_fail_activation()');
    await resumed.load(); await resumed.load();
    assert.equal(resumed.state.epoch,1);
    assert.equal(resumed.categories()[0].decrypted.servers[0].name,'SYNTHETIC_LEGACY_RECORD');
    assert.equal((await database.query('SELECT encrypted_data FROM vault_items WHERE id=$1',[legacyItem])).rows[0].encrypted_data,cipher);
    assert.equal((await database.query('SELECT encrypted_attachment FROM vault_items WHERE id=$1',[legacyItem])).rows[0].encrypted_attachment,attachmentCipher);
    const migratedHistory=resumed.rows.filter(r=>r.category==='__history');
    assert.equal(migratedHistory.length,2);
    assert.deepEqual(migratedHistory.find(r=>r.entity_id===legacyItem).data.attachment,attachment);
    assert.ok(migratedHistory.some(r=>r.data.data.servers[0].name==='SYNTHETIC_PREVIOUS_VERSION'));
    const {openSharedItem}=await frontend('sharedItemService.js');
    const directSnapshot=await openSharedItem({api:directApi,itemId:legacyItem,user:directUser,keys:directKeys});
    assert.deepEqual(directSnapshot.data,legacyData);
    assert.deepEqual(directSnapshot.attachment,attachment);
    assert.equal((await directApi.get('/crypto/shared-items')).data.items.length,1);
    await assert.rejects(directApi.get('/crypto/shared-items/'+historicItem),e=>e.response.status===404);
    await assert.rejects(directApi.get('/crypto/vaults/'+legacyVault),e=>e.response.status===404);
    assert.equal((await database.query('SELECT count(*)::int n FROM vault_crypto_envelopes WHERE client_id=$1 AND user_id=$2',[legacyVault,legacyRecipient])).rows[0].n,0);
    assert.equal((await database.query('SELECT count(*)::int n FROM vault_shares WHERE vault_item_id=$1',[legacyItem])).rows[0].n,2);
    const itemKeyEnvelope=(await directApi.get('/crypto/shared-items/'+legacyItem)).data.key_envelope;
    const itemKey=await v2.openVaultEnvelope(directKeys.privateKey,itemKeyEnvelope,{vaultId:legacyItem,epoch:1,userId:directUser.id,fingerprint:directUser.crypto_identity.fingerprint});
    await assert.rejects(v2.decryptVaultRecord(itemKey,{vaultId:legacyVault,recordId:resumed.rows[0].id,category:resumed.rows[0].category+'/'+resumed.rows[0].collection+'/'+resumed.rows[0].entity_id,epoch:1,revision:1},resumed.rows[0].envelope));
    await database.query('DELETE FROM vault_shares WHERE vault_item_id=$1 AND user_id=$2',[legacyItem,newAccount.id]);
    await assert.rejects(memberApi.get('/crypto/shared-items/'+legacyItem),e=>e.response.status===404);
    assert.deepEqual((await openSharedItem({api:directApi,itemId:legacyItem,user:directUser,keys:directKeys})).data,legacyData,'revoking another recipient must not revoke this grant');
    const groupSession=new VaultSession({api:ownerApi,vaultId:existingGroupVault,user:ownerUser,keys:ownerKeys});
    await groupSession.load();
    await new VaultSession({api:directApi,vaultId:existingGroupVault,user:directUser,keys:directKeys}).load();
    console.log('PASS pre-existing direct grant: independent item key, exact snapshot/attachment, no history/vault access, no vault DEK, preserved grants and selective revocation; old group path still opens.');
    console.log('PASS missing recipient identity is blocked; legacy history and attachment decrypt identically, original ciphertexts preserved.');
    // Approved release request: real session/CSRF/PostgreSQL; no reauth endpoint or grant.
    const releaseAction={approvalId:crypto.randomUUID(),revision:'a'.repeat(40),manifestHash:'b'.repeat(64)};
    const publicOnly=(await ownerApi.get('/release-test')).data;
    assert.equal(publicOnly.release,null);
    assert.deepEqual(publicOnly.publicRelease,publicDiscovery,'public release visible without local approval');
    await assert.rejects(directApi.get('/release-test'),e=>e.response.status===403);
    await assert.rejects(ownerApi.post('/release-test',{...releaseAction,revision:publicDiscovery.release.revision}),e=>e.response.status===503);
    assert.deepEqual(await fs.readdir(releaseQueue),[],'public discovery must not create an approval/request');
    await fs.writeFile(path.join(releasePublic,'catalog.json'),JSON.stringify({...releaseAction,expiresAt:new Date(Date.now()+3600000).toISOString()}));
    assert.equal((await ownerApi.get('/release-test')).data.release.changes,undefined,'old catalogs without changes remain valid');
    const releaseChanges=[{type:'fix',title:'Restore interface'},{type:'feat',title:'Show signed notes'}];
    const catalogWithNotes={...releaseAction,changes:releaseChanges,expiresAt:new Date(Date.now()+3600000).toISOString()};
    await fs.writeFile(path.join(releasePublic,'catalog.json'),JSON.stringify(catalogWithNotes));
    assert.deepEqual((await ownerApi.get('/release-test')).data.release.changes,releaseChanges);
    await fs.writeFile(path.join(releasePublic,'installed-release.json'),JSON.stringify(catalogWithNotes));
    await fs.writeFile(path.join(releasePublic,'catalog.json'),JSON.stringify({...catalogWithNotes,expiresAt:'2000-01-01T00:00:00Z'}));
    const expiredNotes=(await ownerApi.get('/release-test')).data;
    assert.equal(expiredNotes.release,null);
    assert.deepEqual(expiredNotes.publicRelease,publicDiscovery,'local expiry does not hide public release');
    assert.deepEqual(expiredNotes.installedRelease.changes,releaseChanges,'installed notes survive expired catalog');
    assert.equal(expiredNotes.installedRelease.revision,releaseAction.revision);
    await fs.writeFile(path.join(releasePublic,'catalog.json'),JSON.stringify(catalogWithNotes));
    await assert.rejects(ownerApi.post('/release-test',{...releaseAction,changes:releaseChanges}),e=>e.response.status===400);
    await assert.rejects(directApi.post('/release-test',releaseAction),e=>e.response.status===403);
    await assert.rejects(ownerApi.post('/release-test',{...releaseAction,url:'https://evil.example.invalid'}),e=>e.response.status===400);
    const ordinaryAdmin=crypto.randomUUID(),ordinaryAdminApi=browserClient();
    await database.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin) VALUES($1,'SYNTHETIC_ADMIN','normal-admin@example.invalid',$2,'admin',false)",[ordinaryAdmin,await argon2.hash(password)]);
    await ordinaryAdminApi.post('/auth/login',{email:'normal-admin@example.invalid',password});
    await assert.rejects(ordinaryAdminApi.post('/release-test',releaseAction),e=>e.response.status===403);
    // ---- SPFBL module through the REAL router: session, CSRF, module gate, Super Admin, reauthentication bound to the target ----
    // Reauthentication is limited to 5 per 15 minutes per account, so the work is split between two Super Admins.
    const makeSuperAdmin=async label=>{
      const id=crypto.randomUUID(),api=browserClient(),email=`sa-${label}@example.invalid`;
      await database.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin) VALUES($1,$2,$3,$4,'admin',true)",[id,'SYNTHETIC_SA_'+label,email,await argon2.hash(password)]);
      await api.post('/auth/login',{email,password});
      return {id,api};
    };
    const sa1=await makeSuperAdmin('one'),sa2=await makeSuperAdmin('two');
    {
      const denies=(promise,status,code,purpose)=>assert.rejects(promise,e=>e.response.status===status&&(!code||e.response.data.code===code)&&(!purpose||e.response.data.purpose===purpose));
      const reauthToken=async(api,purpose,action)=>(await api.post('/auth/reauth',{purpose,action,current_password:password})).data.token;
      const leaked=value=>JSON.stringify(value).includes('SENTINEL');
      const anonymous=browserClient();
      await denies(anonymous.get('/spfbl/overview'),401);
      // Module off: nobody gets in, not even the Super Admin; the toggle itself is Super Admin only.
      await denies(sa1.api.get('/spfbl/whm-servers'),404,'MODULE_DISABLED');
      await denies(directApi.get('/spfbl/overview'),404,'MODULE_DISABLED');
      assert.deepEqual((await sa1.api.get('/system/modules/menu')).data,{modules:{spfbl:false,domain_manager:false}});
      assert.deepEqual((await sa1.api.get('/system/modules')).data.modules.map(m=>[m.key,m.enabled]),[['spfbl',false],['domain_manager',false]]);
      await denies(ordinaryAdminApi.get('/system/modules'),403,'SUPER_ADMIN_REQUIRED');
      await denies(directApi.get('/system/modules'),403);
      await denies(ordinaryAdminApi.put('/system/modules/spfbl',{enabled:true}),403,'SUPER_ADMIN_REQUIRED');
      await denies(sa1.api.put('/system/modules/spfbl',{enabled:true}),403,'REAUTH_REQUIRED',undefined);
      const toggleDenied=await sa1.api.put('/system/modules/spfbl',{enabled:true}).catch(e=>e);
      assert.equal(toggleDenied.response.data.purpose,'modules_settings:spfbl','the grant is bound to the module in the URL');
      // A grant is for one exact action: another state or another module is refused, and it is single-use.
      const onToken=await reauthToken(sa1.api,'modules_settings:spfbl',{enabled:true});
      await denies(sa1.api.put('/system/modules/spfbl',{enabled:false,_reauth_token:onToken}),403,'REAUTH_REQUIRED');
      await denies(sa1.api.put('/system/modules/nope',{enabled:true,_reauth_token:onToken}),403,'REAUTH_REQUIRED');
      assert.equal((await sa1.api.put('/system/modules/spfbl',{enabled:true,_reauth_token:onToken})).data.module.enabled,true);
      await denies(sa1.api.put('/system/modules/spfbl',{enabled:true,_reauth_token:onToken}),403,'REAUTH_REQUIRED');
      assert.deepEqual((await sa1.api.get('/system/modules/menu')).data,{modules:{spfbl:true,domain_manager:false}});
      assert.deepEqual((await ordinaryAdminApi.get('/system/modules/menu')).data,{modules:{spfbl:false,domain_manager:false}},'an admin who is not Super Admin has no implicit access');
      assert.deepEqual((await directApi.get('/system/modules/menu')).data,{modules:{spfbl:false,domain_manager:false}});

      // Configuration: Super Admin only, secrets encrypted and never returned.
      await denies(ordinaryAdminApi.get('/spfbl/whm-servers'),403,'SUPER_ADMIN_REQUIRED');
      await denies(directApi.get('/spfbl/whm-servers'),403,'SUPER_ADMIN_REQUIRED');
      assert.deepEqual((await sa1.api.get('/spfbl/whm-servers')).data.servers,[]);
      const zeroServer='00000000-0000-0000-0000-00000000dead';
      await denies(sa1.api.post('/spfbl/whm-servers/'+zeroServer+'/matrix/test',{}),404,'SPFBL_SERVER_NOT_FOUND');
      await denies(sa1.api.post('/spfbl/whm-servers/'+zeroServer+'/test',{}),404,'SPFBL_SERVER_NOT_FOUND');
      const serverBody={name:'Servidor 1',host:'srv.example.com',whm_user:'root',token:'WHMTOKENSENTINEL0123456789ABCDEF',matrix_user:'ops@example.com',matrix_password:'MATRIX_SENTINEL_pw'};
      const serverDenied=await sa1.api.post('/spfbl/whm-servers',serverBody).catch(e=>e);
      assert.equal(serverDenied.response.data.code,'REAUTH_REQUIRED'); assert.equal(serverDenied.response.data.purpose,'spfbl_settings');
      await denies(ordinaryAdminApi.post('/spfbl/whm-servers',serverBody),403,'SUPER_ADMIN_REQUIRED');
      const serverToken=await reauthToken(sa1.api,'spfbl_settings',serverBody);
      await denies(sa1.api.post('/spfbl/whm-servers',{...serverBody,host:'attacker.example.net',_reauth_token:serverToken}),403,'REAUTH_REQUIRED');
      const saved=(await sa1.api.post('/spfbl/whm-servers',{...serverBody,_reauth_token:serverToken})).data.server;
      assert.deepEqual([saved.name,saved.host,saved.has_token,saved.matrix_user,saved.has_matrix_password],['Servidor 1','srv.example.com',true,'ops@example.com',true]);
      assert.equal(leaked(saved),false); assert.equal(leaked((await sa1.api.get('/spfbl/whm-servers')).data),false);
      const row=(await database.query('SELECT * FROM spfbl_whm_servers WHERE id=$1',[saved.id])).rows[0];
      assert.equal(leaked(row),false,'secrets are stored encrypted'); assert.match(row.encrypted_token,/^[^:]+:[^:]+:[^:]+:[^:]+$/);
      await denies(sa1.api.put('/spfbl/whm-servers/'+saved.id,{host:'other.example.com',_reauth_token:await reauthToken(sa1.api,'spfbl_settings',{host:'other.example.com'})}),400,'SPFBL_SECRET_REENTRY_REQUIRED');
      // removing needs an explicit answer about the domains
      await denies(sa1.api.delete('/spfbl/whm-servers/'+saved.id,{_reauth_token:await reauthToken(sa1.api,'spfbl_settings',{})}),422,'SPFBL_REMOVE_CHOICE_REQUIRED');

      // Domain catalogue: Super Admin only.
      await denies(ordinaryAdminApi.post('/spfbl/domains',{name:'x.example.com'}),403,'SUPER_ADMIN_REQUIRED');
      await denies(directApi.get('/spfbl/domains'),403);
      await denies(sa1.api.post('/spfbl/domains',{name:'bad domain'}),400,'SPFBL_DOMAIN_INVALID');
      const domainOne=(await sa1.api.post('/spfbl/domains',{name:'one.example.com'})).data.domain, domainTwo=(await sa1.api.post('/spfbl/domains',{name:'two.example.com'})).data.domain;
      await denies(sa1.api.post('/spfbl/domains',{name:'ONE.example.com'}),409,'SPFBL_DOMAIN_EXISTS');
      assert.deepEqual((await sa1.api.get('/spfbl/domains')).data.domains.map(d=>d.name),['one.example.com','two.example.com']);
      await denies(sa1.api.delete('/spfbl/domains/not-a-uuid'),404);

      // Access grants: reauthentication is bound to the TARGET account, single-use, Super Admin only.
      const grant={unlock_mode:'review',domain_ids:[domainOne.id]};
      const grantDenied=await sa2.api.put('/spfbl/access/'+directUser.id,grant).catch(e=>e);
      assert.equal(grantDenied.response.data.code,'REAUTH_REQUIRED'); assert.equal(grantDenied.response.data.purpose,'spfbl_access:'+directUser.id);
      await denies(ordinaryAdminApi.put('/spfbl/access/'+directUser.id,grant),403,'SUPER_ADMIN_REQUIRED');
      const grantToken=await reauthToken(sa2.api,'spfbl_access:'+directUser.id,grant);
      await denies(sa2.api.put('/spfbl/access/'+ordinaryAdmin,{...grant,_reauth_token:grantToken}),403,'REAUTH_REQUIRED');
      await denies(sa2.api.put('/spfbl/access/'+directUser.id,{...grant,domain_ids:[domainOne.id,domainTwo.id],_reauth_token:grantToken}),403,'REAUTH_REQUIRED');
      const granted=(await sa2.api.put('/spfbl/access/'+directUser.id,{...grant,_reauth_token:grantToken})).data.access;
      assert.deepEqual([granted.unlock_mode,granted.domains.map(d=>d.name)],['review',['one.example.com']]);
      await denies(sa2.api.put('/spfbl/access/'+directUser.id,{...grant,_reauth_token:grantToken}),403,'REAUTH_REQUIRED');
      const selfGrant={unlock_mode:'review',domain_ids:[domainOne.id]};
      await denies(sa2.api.put('/spfbl/access/'+sa1.id,{...selfGrant,_reauth_token:await reauthToken(sa2.api,'spfbl_access:'+sa1.id,selfGrant)}),409,'SPFBL_ACCESS_SUPER_ADMIN');

      // The granted account: its own scope only, never configuration, domains or other grants.
      assert.deepEqual((await directApi.get('/system/modules/menu')).data,{modules:{spfbl:true,domain_manager:false}});
      const own=(await directApi.get('/spfbl/overview')).data;
      assert.deepEqual([own.role,own.unlock_mode,own.domains.map(d=>d.name)],['user','review',['one.example.com']]);
      assert.equal(JSON.stringify(own).includes('two.example.com'),false);
      for(const url of ['/spfbl/whm-servers','/spfbl/domains','/spfbl/access']) await denies(directApi.get(url),403,'SUPER_ADMIN_REQUIRED');
      await denies(directApi.post('/spfbl/domains',{name:'mine.example.com'}),403,'SUPER_ADMIN_REQUIRED');
      await denies(directApi.put('/spfbl/whm-servers/'+zeroServer,{name:'x'}),403,'SUPER_ADMIN_REQUIRED');
      await denies(directApi.put('/system/modules/spfbl',{enabled:false}),403,'SUPER_ADMIN_REQUIRED');
      await denies(ordinaryAdminApi.get('/spfbl/overview'),403,'SPFBL_ACCESS_DENIED');
      // Phase 2 routes through the real router (nothing here reaches the provider: every request is refused before any Matrix call).
      const zeroUuid='00000000-0000-4000-8000-000000000000';
      await denies(ordinaryAdminApi.get('/spfbl/requests'),403,'SPFBL_ACCESS_DENIED');
      await denies(ordinaryAdminApi.get('/spfbl/history?domain='+domainOne.name),403,'SPFBL_ACCESS_DENIED');
      await denies(directApi.get('/spfbl/history?domain=other.example.com'),403,'SPFBL_DOMAIN_FORBIDDEN');
      await denies(directApi.get('/spfbl/records/'+'a'.repeat(64)+'?domain='+domainOne.name),404,'SPFBL_RECORD_NOT_FOUND');
      await denies(directApi.get('/spfbl/records/'+'a'.repeat(64)+'?domain=other.example.com'),403,'SPFBL_DOMAIN_FORBIDDEN');
      await denies(directApi.get('/spfbl/requests/'+zeroUuid),403,'SUPER_ADMIN_REQUIRED');
      for(const action of ['keep','release','block']) await denies(directApi.post('/spfbl/requests/'+zeroUuid+'/'+action,{revision:0}),403,'SUPER_ADMIN_REQUIRED');
      assert.deepEqual((await directApi.get('/spfbl/requests')).data,{requests:[],is_admin:false});
      const adminView=(await sa2.api.get('/spfbl/overview')).data;
      assert.deepEqual([adminView.role,adminView.matrix_configured,adminView.whm_configured,adminView.domains,adminView.users_with_access],['super_admin',true,true,{total:2,active:2,without_server:0},1]);
      assert.equal(leaked(adminView),false);

      // Revoking takes effect at once; the DELETE token is bound to the target as well.
      await denies(sa2.api.delete('/spfbl/access/'+directUser.id),403,'REAUTH_REQUIRED');
      const revokeToken=await reauthToken(sa2.api,'spfbl_access:'+directUser.id,{});
      await denies(sa2.api.delete('/spfbl/access/'+ordinaryAdmin,{_reauth_token:revokeToken}),403,'REAUTH_REQUIRED');
      assert.equal((await sa2.api.delete('/spfbl/access/'+directUser.id,{_reauth_token:revokeToken})).data.revoked,true);
      await denies(directApi.get('/spfbl/overview'),403,'SPFBL_ACCESS_DENIED');
      assert.deepEqual((await directApi.get('/system/modules/menu')).data,{modules:{spfbl:false,domain_manager:false}});
      // A grant never outlives the module: switch it off and even the granted routes disappear.
      const regrant=await reauthToken(sa2.api,'spfbl_access:'+directUser.id,grant);
      await sa2.api.put('/spfbl/access/'+directUser.id,{...grant,_reauth_token:regrant});
      assert.equal((await directApi.get('/spfbl/overview')).status,200);
      const offToken=await reauthToken(sa1.api,'modules_settings:spfbl',{enabled:false});
      assert.equal((await sa1.api.put('/system/modules/spfbl',{enabled:false,_reauth_token:offToken})).data.module.enabled,false);
      await denies(directApi.get('/spfbl/overview'),404,'MODULE_DISABLED');
      await denies(sa1.api.get('/spfbl/whm-servers'),404,'MODULE_DISABLED');
      assert.deepEqual((await directApi.get('/system/modules/menu')).data,{modules:{spfbl:false,domain_manager:false}});
      for(const url of ['/spfbl/dashboard','/spfbl/history','/spfbl/requests','/spfbl/records/'+'a'.repeat(64)]) await denies(directApi.get(url),404,'MODULE_DISABLED');
      await denies(sa1.api.get('/spfbl/requests'),404,'MODULE_DISABLED');
      // Audit trail: what happened, never secrets.
      const audit=(await database.query("SELECT action,status,metadata FROM system_audit_events WHERE action LIKE 'spfbl_%' OR action='system_module_toggled' ORDER BY created_at,id")).rows;
      assert.ok(audit.some(e=>e.action==='system_module_toggled'&&e.status==='success'&&e.metadata.enabled===true));
      assert.ok(audit.some(e=>e.action==='spfbl_whm_server_added'&&e.status==='success'&&e.metadata.whm_token_changed===true));
      assert.ok(audit.some(e=>e.action==='spfbl_access_revoked'&&e.status==='success'));
      assert.equal(leaked(audit),false,'no secrets in the audit trail');
      assert.equal(audit.some(e=>JSON.stringify(e.metadata).includes('srv.example.com')),false,'no WHM host in the audit trail');
      // The backup invariant is exactly one Super Admin: remove the two helper accounts (the protection trigger is
      // bypassed for this cleanup only). Their grants and sessions go with them; the SPFBL rows stay in the backup scope.
      await database.query('ALTER TABLE users DISABLE TRIGGER trg_protect_super_admin_user');
      try { await database.query('DELETE FROM users WHERE id = ANY($1::uuid[])',[[sa1.id,sa2.id]]); } finally { await database.query('ALTER TABLE users ENABLE TRIGGER trg_protect_super_admin_user'); }
      assert.equal((await database.query('SELECT count(*)::int AS n FROM users WHERE is_super_admin=TRUE')).rows[0].n,1);
      console.log('PASS spfbl module through the real router: module gate, Super Admin only, reauthentication bound to action and target (single-use), scoped grants, immediate revocation, no secrets stored or returned, audited.');
    }
    // Real group creation: account enrollment, not a UI flag, decides whether MFA is required.
    const groupAction={name:'SYNTHETIC_GROUP_NO_MFA',description:'Disposable regression',userIds:[],can_view:true,can_edit:false,can_add:false,can_delete:false};
    assert.equal((await ordinaryAdminApi.get('/auth/me')).data.user.mfa_enabled,false);
    await assert.rejects(ordinaryAdminApi.post('/groups',groupAction),e=>e.response.status===403&&e.response.data.code==='REAUTH_REQUIRED');
    const noMfaGrant=(await ordinaryAdminApi.post('/auth/reauth',{purpose:'group_create',action:groupAction,current_password:password})).data.token;
    const noMfaGroup=await ordinaryAdminApi.post('/groups',{...groupAction,_reauth_token:noMfaGrant});
    assert.equal(noMfaGroup.status,201);
    await assert.rejects(ordinaryAdminApi.post('/groups',{...groupAction,_reauth_token:noMfaGrant}),e=>e.response.status===403);
    const groupMfa=require('../src/services/mfaService'),groupAuthenticator=require('otplib').authenticator;
    const groupTotp=groupAuthenticator.generateSecret();
    await database.query('INSERT INTO user_mfa_settings(user_id,totp_secret_encrypted,enabled) VALUES($1,$2,false)',[ordinaryAdmin,groupMfa.encryptSecret(groupTotp)]);
    assert.equal((await ordinaryAdminApi.get('/auth/me')).data.user.mfa_enabled,false);
    const disabledAction={...groupAction,name:'SYNTHETIC_GROUP_DISABLED_MFA'};
    const disabledGrant=(await ordinaryAdminApi.post('/auth/reauth',{purpose:'group_create',action:disabledAction,current_password:password})).data.token;
    const disabledGroup=await ordinaryAdminApi.post('/groups',{...disabledAction,_reauth_token:disabledGrant});
    assert.equal(disabledGroup.status,201);
    await database.query('UPDATE user_mfa_settings SET enabled=true WHERE user_id=$1',[ordinaryAdmin]);
    assert.equal((await ordinaryAdminApi.get('/auth/me')).data.user.mfa_enabled,true);
    const activeAction={...groupAction,name:'SYNTHETIC_GROUP_ACTIVE_MFA'};
    await assert.rejects(ordinaryAdminApi.post('/auth/reauth',{purpose:'group_create',action:activeAction,current_password:password}),e=>e.response.status===403&&e.response.data.code==='FRESH_MFA_REQUIRED');
    const groupCode=groupAuthenticator.generate(groupTotp);
    const activeGrant=(await ordinaryAdminApi.post('/auth/reauth',{purpose:'group_create',action:activeAction,current_password:password,mfa_code:groupCode})).data.token;
    const activeGroup=await ordinaryAdminApi.post('/groups',{...activeAction,_reauth_token:activeGrant});
    assert.equal(activeGroup.status,201);
    await assert.rejects(ordinaryAdminApi.post('/auth/reauth',{purpose:'group_create',action:activeAction,current_password:password,mfa_code:groupCode}),e=>e.response.status===403&&e.response.data.code==='FRESH_MFA_REQUIRED');
    await database.query('DELETE FROM groups WHERE id=ANY($1::uuid[])',[[noMfaGroup.data.group.id,disabledGroup.data.group.id,activeGroup.data.group.id]]);
    await database.query('DELETE FROM user_mfa_settings WHERE user_id=$1',[ordinaryAdmin]);
    console.log('PASS group creation HTTP/PostgreSQL: no enrollment and disabled MFA need only login password; active MFA needs fresh TOTP; grant and TOTP replay denied.');
    await assert.rejects(ownerApi.postWithoutCsrf('/release-test',releaseAction),e=>e.response.status===403);
    for(const key of ['approvalId','revision','manifestHash']) {
      const tampered={...releaseAction,[key]:key==='approvalId'?crypto.randomUUID():key==='revision'?'c'.repeat(40):'c'.repeat(64)};
      await assert.rejects(ownerApi.post('/release-test',tampered),e=>e.response.status===409 && e.response.data.code==='APPROVAL_CHANGED');
    }
    await assert.rejects(ownerApi.post('/release-test',{...releaseAction,_reauth_token:'SYNTHETIC_UNUSED'}),e=>e.response.status===400);
    const releaseMfa=require('../src/services/mfaService'),authenticatorRelease=require('otplib').authenticator;
    const releaseTotp=authenticatorRelease.generateSecret();
    await database.query('INSERT INTO user_mfa_settings(user_id,totp_secret_encrypted,enabled) VALUES($1,$2,true)',[owner,releaseMfa.encryptSecret(releaseTotp)]);
    assert.equal((await ownerApi.get('/auth/me')).data.user.mfa_enabled,true);
    const mfaLoginApi=browserClient();
    const challenge=(await mfaLoginApi.post('/auth/login',{email:'owner@example.invalid',password})).data;
    assert.equal(challenge.mfa_required,true);
    const mfaLogin=(await mfaLoginApi.post('/auth/mfa/verify-login',{challenge_token:challenge.challenge_token,code:authenticatorRelease.generate(releaseTotp)})).data.user;
    assert.equal(mfaLogin.mfa_enabled,true);
    assert.equal((await mfaLoginApi.get('/auth/me')).data.user.mfa_enabled,true);
    const grantsBefore=(await database.query("SELECT count(*)::int n FROM sensitive_auth_grants WHERE purpose='system_release'")).rows[0].n;
    const accepted=await ownerApi.post('/release-test',releaseAction);
    assert.equal(accepted.status,202);assert.equal(accepted.data.state,'requested');
    await assert.rejects(ownerApi.post('/release-test',releaseAction),e=>e.response.status===409 && e.response.data.code==='ALREADY_REQUESTED');
    assert.equal((await database.query("SELECT count(*)::int n FROM sensitive_auth_grants WHERE purpose='system_release'")).rows[0].n,grantsBefore);
    const queued=JSON.parse(await fs.readFile(path.join(releaseQueue,releaseAction.approvalId+'.json'),'utf8'));
    assert.deepEqual(Object.keys(queued).sort(),['approvalId','manifestHash','requestId','revision']);
    assert.equal(queued.revision,releaseAction.revision);
    await database.query('DELETE FROM user_mfa_settings WHERE user_id=$1',[owner]);
    const releaseAudit=(await database.query("SELECT user_id,status,metadata FROM system_audit_events WHERE action='signed_release_requested' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(releaseAudit.user_id,owner);assert.equal(releaseAudit.status,'success');
    assert.equal(releaseAudit.metadata.revision,releaseAction.revision);assert.equal(releaseAudit.metadata.approval_id,releaseAction.approvalId);
    console.log('PASS approved release API: normal user/admin denied, CSRF required, exact catalog IDs, no reauth/MFA grant, 202 direct, duplicate rejected, transactional audit and bounded queue.');
    console.log('PASS mfa_enabled serialization: ordinary login/me false; genuine MFA login/me true; no password hash returned.');
    const setupMfaApi=browserClient();
    const setupUser=(await setupMfaApi.post('/auth/login',{email:'missing@example.invalid',password})).data.user;
    assert.equal(setupUser.mfa_enabled,false);
    const setupTotp=authenticatorRelease.generateSecret();
    await database.query('INSERT INTO user_mfa_settings(user_id,totp_secret_encrypted,enabled) VALUES($1,$2,true)',[uninitialized,releaseMfa.encryptSecret(setupTotp)]);
    const setupIdentity=await v2.createIndependentIdentity(uninitialized,'SYNTHETIC_Setup_Unlock_'+crypto.randomBytes(24).toString('hex'));
    await assert.rejects(setupMfaApi.post('/crypto/identity',{identity:setupIdentity,current_password:password}),e=>e.response.status===403);
    assert.equal((await setupMfaApi.post('/crypto/identity',{identity:setupIdentity,current_password:password,mfa_code:authenticatorRelease.generate(setupTotp)})).data.identity.version,2);
    console.log('PASS identity save still requires current TOTP from real PostgreSQL when enabled; non-MFA identity setup already succeeded without a code.');
    // Reauth is session-, purpose- and exact-action-bound and single use.
    const profile={name:'SYNTHETIC_OWNER',email:'new-owner@example.invalid'};
    await assert.rejects(ownerApi.put('/users/profile',profile),e=>e.response.data.code==='REAUTH_REQUIRED');
    const grant=(await ownerApi.post('/auth/reauth',{purpose:'profile_change',action:profile,current_password:password})).data.token;
    await assert.rejects(ownerApi.put('/users/profile',{...profile,email:'tampered@example.invalid',_reauth_token:grant}),e=>e.response.data.code==='REAUTH_REQUIRED');
    const emailService=require('../src/services/emailService');
    const originalSend=emailService.sendEmail, deliveries=[];
    emailService.sendEmail=async message=>{assert.match(message.to,/@example.invalid$/);deliveries.push(message);};
    try {
      await ownerApi.put('/users/profile',{...profile,_reauth_token:grant});
      assert.equal(deliveries.length,2);
      assert.equal((await ownerApi.get('/auth/me')).data.user.email,'owner@example.invalid','pending address must not be active');
      await assert.rejects(ownerApi.put('/users/profile',{...profile,_reauth_token:grant}),e=>e.response.data.code==='REAUTH_REQUIRED');
      const token=deliveries[0].text.match(/[a-f0-9]{64}/)[0];
      await ownerApi.post('/auth/confirm-email',{token});
      await assert.rejects(ownerApi.get('/auth/me'),e=>e.response.status===401);
      await ownerApi.post('/auth/login',{email:'new-owner@example.invalid',password});
      assert.equal((await ownerApi.get('/crypto/identity')).data.identity.fingerprint,ownerUser.crypto_identity.fingerprint);
      // Restore the fixture's public email through another validated request, not SQL.
      const revert={name:'SYNTHETIC_OWNER',email:'owner@example.invalid'};
      const revertGrant=(await ownerApi.post('/auth/reauth',{purpose:'profile_change',action:revert,current_password:password})).data.token;
      await ownerApi.put('/users/profile',{...revert,_reauth_token:revertGrant});
      await ownerApi.post('/auth/confirm-email',{token:deliveries[2].text.match(/[a-f0-9]{64}/)[0]});
      await ownerApi.post('/auth/login',{email:'owner@example.invalid',password});
    } finally {emailService.sendEmail=originalSend;}
    console.log('PASS central recent/purpose/action/session-bound reauth, one-time use, pending email confirmation, old-email notice and session revocation (dedicated captured messages).');
    // Test the shared account budget independently of the stricter HTTP/IP limiter.
    const attempts=await Promise.all(Array.from({length:9},async()=>{
      const result=response();await require('../src/services/reauthService').attemptLimit({user:{id:newAccount.id}},result,()=>{});return result;
    }));
    assert.equal(attempts.filter(result=>result.code===429).length,2);
    assert.ok(attempts.filter(result=>result.code===429).every(result=>result.body.code==='REAUTH_ATTEMPT_LIMIT'));
    assert.equal((await database.query('SELECT attempts FROM sensitive_auth_attempts WHERE user_id=$1',[newAccount.id])).rows[0].attempts,10);
    // Controlled upload resource tests: real PG lease, no remote exhaustion.
    const {createRestoreUploadGuard,LOCK_NAMESPACE,LOCK_RESOURCE}=require('../src/middleware/restoreUploadGuard');
    const {EventEmitter}=require('events');
    const makePair=()=>{const req=new EventEmitter(),res=new EventEmitter();req.destroy=()=>{req.emit('aborted');};res.status=function(code){this.code=code;return this;};res.json=function(data){this.body=data;return this;};return{req,res};};
    const deniedPair=makePair();let passed=false;
    await createRestoreUploadGuard({statfs:async()=>({bavail:0,bsize:4096})})(deniedPair.req,deniedPair.res,()=>{passed=true;});
    assert.equal(deniedPair.res.code,507);assert.equal(passed,false);
    const timeoutPair=makePair();
    await createRestoreUploadGuard({timeoutMs:30})(timeoutPair.req,timeoutPair.res,()=>{});
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(timeoutPair.res.code,408);
    const abortPair=makePair();
    await createRestoreUploadGuard()(abortPair.req,abortPair.res,()=>{});
    const uploadPath=path.join(process.env.BACKUP_TEMP_DIR,'uploads',crypto.randomUUID()+'.upload');
    await fs.writeFile(uploadPath,'SYNTHETIC_PARTIAL');abortPair.req.restoreUploadPath=uploadPath;
    abortPair.req.emit('aborted');await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(await fs.stat(uploadPath).then(()=>true,()=>false),false);
    const crashed=new (require('pg').Client)({host:'127.0.0.1',port,user:'postgres',password:databasePassword,database:'postgres'});
    await crashed.connect();
    await crashed.query('SELECT pg_advisory_lock($1,$2)',[LOCK_NAMESPACE,LOCK_RESOURCE]);
    const pid=(await crashed.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // Simulates abrupt owner-connection loss; terminate only this synthetic backend.
    crashed.on('error',()=>{});
    await database.query('SELECT pg_terminate_backend($1)',[pid]);await crashed.end();
    const orphan=path.join(process.env.BACKUP_TEMP_DIR,'uploads',crypto.randomUUID()+'.upload');
    await fs.writeFile(orphan,'SYNTHETIC_CRASH_LEFTOVER');
    const recoveredPair=makePair();passed=false;
    await createRestoreUploadGuard()(recoveredPair.req,recoveredPair.res,()=>{passed=true;});
    assert.equal(passed,true);assert.equal(await fs.stat(orphan).then(()=>true,()=>false),false);
    await recoveredPair.req.releaseRestoreLease();
    const child=require('node:child_process').fork(path.join(__dirname,'test-restore-crash-worker.js'),[],{stdio:['ignore','ignore','ignore','ipc'],env:process.env});
    const childState=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('Crash worker timeout'));},15000);
      child.once('message',message=>{clearTimeout(timer);resolve(message);});
      child.once('error',reject);
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('Crash worker exited early: '+code));});
    });
    assert.equal(childState.ready,true);
    const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
    const afterCrash=makePair();passed=false;
    // OS exit precedes PostgreSQL processing the socket EOF; bound the observation,
    // never forcibly release another worker's lock to make this assertion pass.
    for(let attempt=0;attempt<25 && !passed;attempt++) {
      await createRestoreUploadGuard()(afterCrash.req,afterCrash.res,()=>{passed=true;});
      if(!passed) await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.equal(passed,true,'new instance acquires lease after worker process death');
    assert.equal(await fs.stat(childState.upload).then(()=>true,()=>false),false,'orphan removed after real process death');
    await afterCrash.req.releaseRestoreLease();
    console.log('PASS restore guard: controlled space exhaustion, timeout, aborted cleanup, failed connection lease recovery and crash leftovers.');
    const backup=require('../src/services/backupPackageV2Service');
    const mfa=require('../src/services/mfaService'),{authenticator}=require('otplib');
    const restoredTotpSecret=authenticator.generateSecret();
    await database.query('INSERT INTO user_mfa_settings(user_id,totp_secret_encrypted,enabled) VALUES($1,$2,true)',[newAccount.id,mfa.encryptSecret(restoredTotpSecret)]);
    const configCrypto=require('../src/services/configSecretCrypto');
    const syntheticOperational='SYNTHETIC_OPERATIONAL_'+crypto.randomBytes(16).toString('hex');
    await database.query('UPDATE smtp_settings SET encrypted_password=$1 WHERE id=1',[configCrypto.encryptConfigSecret(syntheticOperational)]);
    const phrase='SYNTHETIC_BACKUP_'+crypto.randomBytes(20).toString('hex');
    const archive=await backup.createBackupPackageV2({generatedBy:'audit@example.invalid',passphrase:phrase});
    assert.equal(archive.manifest.kdf.params.N,131072);
    const inspected=await backup.inspectBackupPackageV2(archive.packagePath,phrase);
    await database.query('CREATE DATABASE audit_restore');
    const {Pool}=require('pg');
    const restorePool=new Pool({host:'127.0.0.1',port,user:'postgres',password:databasePassword,database:'audit_restore'});
    trackPool(restorePool);
    const originalPool=database.pool, originalQuery=database.query;
    try {
      database.pool=restorePool; database.query=(sql,values)=>restorePool.query(sql,values);
      await database.query(await fs.readFile(path.join(__dirname,'../../database/init.sql'),'utf8'));
      await require('../src/config/securitySchema').ensureSecuritySchema();
      await backup.restoreBackupPackageV2({packageContext:inspected.packageContext,passphrase:phrase});
      const restoredApi=browserClient();
      const restoredUser=(await restoredApi.post('/auth/login',{email:'owner@example.invalid',password})).data.user;
      const restoredKeys=await unlockUserIdentity(restoredUser,secret);
      const restored=new VaultSession({api:restoredApi,vaultId:legacyVault,user:restoredUser,keys:restoredKeys});
      await restored.load();
      assert.equal(restored.categories()[0].decrypted.servers[0].name,'SYNTHETIC_LEGACY_RECORD');
      assert.equal((await database.query('SELECT count(*)::int AS n FROM user_sessions')).rows[0].n,1,'only new restored login session');
      const restoredMfa=(await database.query('SELECT * FROM user_mfa_settings WHERE user_id=$1',[newAccount.id])).rows[0];
      assert.equal(mfa.verifyTotp(restoredMfa,authenticator.generate(restoredTotpSecret)),true,'MFA encryption survives isolated restore');
      const restoredMemberApi=browserClient();
      const challenge=(await restoredMemberApi.post('/auth/login',{email:'member@example.invalid',password})).data;
      const verifiedLogin=(await restoredMemberApi.post('/auth/mfa/verify-login',{challenge_token:challenge.challenge_token,code:authenticator.generate(restoredTotpSecret)})).data;
      assert.equal(verifiedLogin.user.id,newAccount.id,'MFA login works after restore');
      assert.equal(configCrypto.decryptConfigSecret((await database.query('SELECT encrypted_password FROM smtp_settings WHERE id=1')).rows[0].encrypted_password),syntheticOperational);
    } finally {
      database.pool=originalPool; database.query=originalQuery;
      await drainPool(restorePool);
      await backup.cleanupBackupWorkspace(inspected.workspace);
      await backup.cleanupBackupWorkspace(archive.workspace);
    }
    console.log('PASS backup v2 N=131072 and restore into SECOND isolated PostgreSQL database, fresh login and client-side vault opening.');
    await require('./password-reset-preservation-fixture')({ database, ownerApi, ownerUser, secret, legacyVault, VaultSession, unlockUserIdentity, password });
    console.log('PASS integrated HTTP + PostgreSQL: independent identity, new users, per-vault keys, per-record add/edit/read restrictions, CSRF/session, revocation rotation, stale revision, legacy migration interruption/resume/idempotence and preserved originals.');
  } finally {
    console.log('Integration: closing HTTP server.');
    if(httpServer) {
      const closed=new Promise(resolve=>httpServer.close(resolve));
      // All assertions completed; close lingering clients from aborted-upload
      // scenarios before draining PostgreSQL. They must not hang the test runner.
      httpServer.closeAllConnections();
      await closed;
    }
    console.log('Integration: draining database connections.');
    if(database) await drainPool(database.pool);
    console.log('Integration: stopping isolated PostgreSQL.');
    await postgres.stop().catch(()=>{});
    // Only the random directory created above may be removed.
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fullpassword-audit-test-'));
    await fs.rm(directory,{recursive:true,force:true});
  }
}
// Fail closed: embedded-postgres's exit hook calls process.exit(0) on beforeExit when a start/stop promise never settles.
let completed=false;process.on('beforeExit',()=>{if(!completed){console.error('PostgreSQL test did not complete: embedded PostgreSQL failed to start or cleanup hung.');process.exit(1);}});
run().then(() => { completed = true; process.exit(0); }).catch(error => { console.error(error); process.exit(1); });
