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
    await database.query(await fs.readFile(path.join(__dirname, '../../database/init.sql'), 'utf8'));
    await require('../src/config/securitySchema').ensureSecuritySchema();
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
    const password='SYNTHETIC_Login_!'+crypto.randomBytes(12).toString('hex');
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
      await leastPrivilege.query('RESET ROLE');
      await database.query('GRANT CREATE ON SCHEMA public TO audit_runtime');
      await leastPrivilege.query('SET ROLE audit_runtime');
      await assert.rejects(verifyRuntimeSchema(leastPrivilege),/PRIVILEGED_RUNTIME_DATABASE_ROLE/);
      await leastPrivilege.query('RESET ROLE');
      await database.query('REVOKE CREATE ON SCHEMA public FROM audit_runtime');
      await leastPrivilege.query('SET ROLE audit_runtime');
      await assert.rejects(leastPrivilege.query('ALTER TABLE users ADD COLUMN forbidden_test TEXT'),e=>e.code==='42501');
    } finally {await leastPrivilege.query('RESET ROLE');leastPrivilege.release();}
    const owner=crypto.randomUUID();
    const oldKey=await legacy.generateMasterKey(), oldSalt=crypto.randomBytes(32).toString('hex');
    const oldWrapped=await legacy.wrapMasterKey(oldKey,await legacy.deriveMasterKey(password,oldSalt,legacy.KDF_PARAMS));
    await database.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin,wrapped_key,crypto_salt,kdf_version,kdf_name,kdf_hash,kdf_iterations) VALUES($1,'SYNTHETIC_OWNER','owner@example.invalid',$2,'admin',true,$3,$4,$5,$6,$7,$8)",[owner,await argon2.hash(password),oldWrapped,oldSalt,legacy.KDF_PARAMS.version,legacy.KDF_PARAMS.name,legacy.KDF_PARAMS.hash,legacy.KDF_PARAMS.iterations]);
    const {app}=require('../src/server');
    httpServer=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
    const base='http://127.0.0.1:'+httpServer.address().port+'/api';
    function browserClient() {
      const cookies={}; const payloads=[];
      const call=async(method,url,data,retries=0)=>{
        const headers={'Content-Type':'application/json',Cookie:Object.entries(cookies).map(([k,v])=>k+'='+v).join('; ')};
        if(cookies.fp_csrf) headers['x-csrf-token']=cookies.fp_csrf;
        if(data) payloads.push(JSON.stringify(data));
        const response=await fetch(base+url,{method,headers,body:data?JSON.stringify(data):undefined});
        for(const value of response.headers.getSetCookie()) { const pair=value.split(';')[0], index=pair.indexOf('=');cookies[pair.slice(0,index)]=pair.slice(index+1); }
        const body=await response.json();
        if(response.status===429 && body.code==='RATE_LIMIT_EXCEEDED' && retries<2) {
          console.log('Integration: honoring API rate-limit window.');
          await new Promise(resolve=>setTimeout(resolve,Math.min(60000,Math.max(1000,body.retry_after_seconds*1000+200))));
          return call(method,url,data,retries+1);
        }
        if(!response.ok) throw Object.assign(new Error(body.code || body.error),{response:{status:response.status,data:body}});
        return {data:body};
      };
      return {get:url=>call('GET',url),post:(url,data)=>call('POST',url,data),put:(url,data)=>call('PUT',url,data),delete:url=>call('DELETE',url),payloads};
    }
    const ownerApi=browserClient();
    let ownerUser=(await ownerApi.post('/auth/login',{email:'owner@example.invalid',password})).data.user;
    assert.equal(ownerUser.id,owner);
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

    const legacyVault=(await ownerApi.post('/clients',{name:'SYNTHETIC_LEGACY'})).data.id;
    const legacyData={servers:[{id:'old-server',name:'SYNTHETIC_LEGACY_RECORD'}],users:[]};
    const cipher=await legacy.encryptData(legacyData,oldKey);
    await database.query("INSERT INTO vault_items(client_id,category,encrypted_data,created_by) VALUES($1,'Servidor TS',$2,$3)",[legacyVault,cipher,owner]);
    const legacyItem=(await database.query('SELECT id FROM vault_items WHERE client_id=$1',[legacyVault])).rows[0].id;
    await database.query('INSERT INTO vault_shares(vault_item_id,user_id,encrypted_vault_key) VALUES($1,$2,$3)',[legacyItem,newAccount.id,'SYNTHETIC_LEGACY_ENVELOPE']);
    await assert.rejects(ownerApi.post('/crypto/vaults/'+legacyVault+'/recipients',{}),
      e=>e.response.status===409 && e.response.data.code==='LEGACY_DIRECT_SHARES_REQUIRE_REVIEW');
    assert.equal((await database.query('SELECT count(*)::int n FROM vault_shares WHERE vault_item_id=$1',[legacyItem])).rows[0].n,1,'direct item grants must not be silently deleted');
    // The test operator explicitly removes the synthetic grant; production migration must not do this automatically.
    await database.query('DELETE FROM vault_shares WHERE vault_item_id=$1',[legacyItem]);
    const interruptedApi={...ownerApi,post:async(url,payload)=>{if(url.endsWith('/activate'))throw new Error('SYNTHETIC_INTERRUPT');return ownerApi.post(url,payload);}};
    await assert.rejects(new VaultSession({api:interruptedApi,vaultId:legacyVault,user:ownerUser,keys:ownerKeys}).load(),/SYNTHETIC_INTERRUPT/);
    assert.equal((await ownerApi.get('/crypto/vaults/'+legacyVault)).data.epoch,0);
    await database.query('INSERT INTO vault_shares(vault_item_id,user_id,encrypted_vault_key) VALUES($1,$2,$3)',[legacyItem,newAccount.id,'SYNTHETIC_LATE_GRANT']);
    const blockedStage=(await ownerApi.get('/crypto/vaults/'+legacyVault)).data.stage;
    await assert.rejects(ownerApi.post('/crypto/vaults/'+legacyVault+'/stages/'+blockedStage.id+'/activate',{verifiedManifestHash:blockedStage.manifest_hash}),
      e=>e.response.data.code==='LEGACY_DIRECT_SHARES_REQUIRE_REVIEW');
    assert.equal((await database.query('SELECT crypto_epoch FROM clients WHERE id=$1',[legacyVault])).rows[0].crypto_epoch,0);
    await database.query('DELETE FROM vault_shares WHERE vault_item_id=$1',[legacyItem]);
    console.log('PASS legacy direct shares block staging/activation without widening grants or deleting originals.');
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
    assert.equal((await database.query('SELECT encrypted_data FROM vault_items WHERE client_id=$1',[legacyVault])).rows[0].encrypted_data,cipher);
    assert.ok(resumed.rows.some(r=>r.category==='__history'));
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
    await createRestoreUploadGuard()(afterCrash.req,afterCrash.res,()=>{passed=true;});
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
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
