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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fullpassword-audit-test-'));
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  const password = crypto.randomBytes(32).toString('hex');
  const postgres = new EmbeddedPostgres({
    databaseDir: path.join(directory, 'pgdata'), user: 'postgres', password, port,
    persistent: true, authMethod: 'scram-sha-256',
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {}
  });
  let database; let httpServer;
  try {
    await postgres.initialise();
    await postgres.start();
    Object.assign(process.env, {
      DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'postgres',
      DB_PASSWORD: password, DB_NAME: 'postgres', NODE_ENV: 'test',
      JWT_SECRET: crypto.randomBytes(64).toString('hex'),
      ADMIN_BOOTSTRAP_TOKEN: crypto.randomBytes(64).toString('hex'),
      APP_ORIGIN: 'http://127.0.0.1', SUPER_ADMIN_EMAIL: 'audit@example.invalid',
      BACKUP_TEMP_DIR: path.join(directory, 'uploads')
    });
    database = require('../src/config/database');
    await database.query(await fs.readFile(path.join(__dirname, '../../database/init.sql'), 'utf8'));
    await require('../src/config/securitySchema').ensureSecuritySchema();
    const stagingSql = await fs.readFile(path.join(__dirname, '../../database/migrations/21_stage_isolated_vault_crypto.sql'), 'utf8');
    await database.query(stagingSql);
    await database.query(stagingSql); // Additive migration must be idempotent.
    console.log((await database.query('SELECT version()')).rows[0].version);
    const [owner, member, vaultA, vaultB, groupA, groupB] = Array.from({ length: 6 }, () => crypto.randomUUID());
    await database.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt) VALUES ($1,'AUDIT_TEST_OWNER','owner@example.invalid','TEST_HASH','TEST_WRAPPED','TEST_SALT'),($2,'AUDIT_TEST_MEMBER','member@example.invalid','TEST_HASH','TEST_WRAPPED','TEST_SALT')", [owner, member]);
    await database.query("INSERT INTO clients(id,name,created_by) VALUES ($1,'AUDIT_TEST_A',$3),($2,'AUDIT_TEST_B',$3)", [vaultA, vaultB, owner]);
    await database.query("INSERT INTO groups(id,name,can_view,can_add,can_edit,can_delete) VALUES ($1,'AUDIT_TEST_GROUP_A',true,true,true,false),($2,'AUDIT_TEST_GROUP_B',true,true,true,true)", [groupA, groupB]);
    await database.query('INSERT INTO user_groups(user_id,group_id) VALUES ($1,$2),($1,$3)', [member, groupA, groupB]);
    await database.query('INSERT INTO client_group_access(client_id,group_id,can_view,can_add,can_edit,can_delete) VALUES ($1,$3,true,true,false,true),($2,$3,true,true,false,true)', [vaultA,vaultB,groupA]);
    const { getClientPermissions } = require('../src/services/accessControlService');
    const actor = { id: member, role: 'user', groups: [groupA,groupB] };
    let permissions = await getClientPermissions(vaultA, actor);
    assert.equal(permissions.can_add, true);
    assert.equal(permissions.can_edit, false);
    assert.equal(permissions.can_delete, false, 'stale cga delete cannot override group restriction');
    await database.query('INSERT INTO client_group_access(client_id,group_id,can_view,can_add,can_edit,can_delete) VALUES ($1,$2,true,false,true,true)', [vaultA,groupB]);
    permissions = await getClientPermissions(vaultA,actor);
    assert.equal(permissions.can_edit, true); assert.equal(permissions.can_delete,true);
    await database.query('DELETE FROM user_groups WHERE user_id=$1 AND group_id=$2',[member,groupB]);
    assert.equal((await getClientPermissions(vaultA,actor)).can_delete,false,'stale request groups must not authorize');
    await database.query('DELETE FROM client_group_access WHERE client_id=$1 AND group_id=$2',[vaultA,groupB]);
    const vaultController = require('../src/controllers/vaultController');
    let res = response();
    await vaultController.createVaultItem({ params:{clientId:vaultA}, user:actor, body:{category:'Servidor TS',encrypted_data:'TEST_ONLY'} },res);
    assert.equal(res.code,403,'add-only cannot replace legacy category');
    await database.query('UPDATE groups SET can_add=false WHERE id=$1',[groupA]);
    res=response();
    await vaultController.createVaultItem({ params:{clientId:vaultA}, user:actor, body:{category:'Servidor TS',encrypted_data:'TEST_ONLY'} },res);
    assert.equal(res.code,403,'reader negative control');

    // Real concurrent transactions, separate pooled connections, failure AFTER DELETE.
    const connect = database.pool.connect.bind(database.pool);
    const pids = new Set();
    let deleted; let permitFailure;
    const deletionReached = new Promise(resolve => { deleted=resolve; });
    const failAfterOtherCommit = new Promise(resolve => { permitFailure=resolve; });
    database.pool.connect = (callback) => {
      if (callback) return connect(callback);
      return (async () => {
      const client = await connect(); pids.add(client.processID);
      return { release: () => client.release(), query: async (sql, values) => {
        const result = await client.query(sql, values);
        if (sql.startsWith('DELETE FROM client_group_access') && values[0] === vaultA) {
          deleted(); await failAfterOtherCommit;
          throw Object.assign(new Error('AUDIT_TEST injected failure'), { code:'AUDIT_TEST_INJECTED' });
        }
        return result;
      } };
      })();
    };
    const ownerActor = {id:owner,role:'user'};
    const request = id => ({params:{clientId:id},user:ownerActor,body:{shares:[{group_id:groupB,can_view:true}]}});
    const failed=response(); const succeeded=response();
    const failing = vaultController.updateClientShares(request(vaultA),failed);
    await deletionReached;
    await vaultController.updateClientShares(request(vaultB),succeeded);
    permitFailure(); await failing;
    database.pool.connect=connect;
    assert.equal(failed.code,500); assert.equal(succeeded.code,200); assert.ok(pids.size>=2);
    assert.equal((await database.query('SELECT group_id FROM client_group_access WHERE client_id=$1',[vaultA])).rows[0].group_id,groupA);
    assert.equal((await database.query('SELECT group_id FROM client_group_access WHERE client_id=$1',[vaultB])).rows[0].group_id,groupB);

    // HTTP through REAL cookie authentication and CSRF; no multipart parsing for common user.
    let multipartInvocations = 0;
    const multerModule = require.resolve('multer');
    const realMulter = require(multerModule);
    require.cache[multerModule].exports = Object.assign((options) => {
      const upload = realMulter(options);
      const single = upload.single.bind(upload);
      upload.single = (...args) => {
        const middleware = single(...args);
        return (req, res, next) => { multipartInvocations += 1; return middleware(req, res, next); };
      };
      return upload;
    }, realMulter);
    const { app } = require('../src/server');
    require.cache[multerModule].exports = realMulter;
    const { createUserSession } = require('../src/services/sessionService');
    const session = await createUserSession({ip:'127.0.0.1',get:()=>''},{id:member,token_version:0,email:'member@example.invalid',role:'user'});
    const csrf = require('../src/services/csrfService').createCsrfToken();
    httpServer = await new Promise(resolve => { const server=app.listen(0,'127.0.0.1',()=>resolve(server)); });
    const base = 'http://127.0.0.1:' + httpServer.address().port;
    const commonHeaders = {Cookie:'fp_session='+session.token+'; fp_csrf='+csrf,'x-csrf-token':csrf};
    const authenticationCheck=await fetch(base+'/api/auth/me',{headers:commonHeaders});
    assert.equal(authenticationCheck.status,200,'session must be valid before negative authorization test');
    const before = await fs.readdir(path.join(process.env.BACKUP_TEMP_DIR,'uploads'));
    const body=new FormData(); body.append('backup',new Blob(['AUDIT_TEST_MINIMUM']),'audit.enc.json');
    const uploaded=await fetch(base+'/api/system/backup/restore/dry-run',{method:'POST',headers:commonHeaders,body});
    assert.equal(uploaded.status,403);
    assert.equal((await uploaded.json()).code,'SUPER_ADMIN_REQUIRED','refusal must not be masked by invalid CSRF/session');
    assert.deepEqual(await fs.readdir(path.join(process.env.BACKUP_TEMP_DIR,'uploads')),before);
    assert.equal(multipartInvocations, 0, 'ordinary user must not enter multipart middleware');
    await database.query("UPDATE users SET role='admin', is_super_admin=true WHERE id=$1", [owner]);
    const adminSession = await createUserSession({ip:'127.0.0.1',get:()=>''},{id:owner,token_version:0,email:'owner@example.invalid',role:'admin',is_super_admin:true});
    const adminHeaders = {Cookie:'fp_session='+adminSession.token+'; fp_csrf='+csrf,'x-csrf-token':csrf};
    const changedEmail = await fetch(base+'/api/users/'+owner, {method:'PUT',headers:{...adminHeaders,'Content-Type':'application/json'},body:JSON.stringify({email:'changed@example.invalid'})});
    assert.equal(changedEmail.status,409);
    assert.equal((await changedEmail.json()).code,'SELF_EMAIL_CHANGE_REQUIRES_PROFILE');
    assert.equal((await database.query('SELECT email FROM users WHERE id=$1',[owner])).rows[0].email,'owner@example.invalid');
    const { LOCK_NAMESPACE, LOCK_RESOURCE } = require('../src/middleware/restoreUploadGuard');
    const occupied = await database.pool.connect();
    try {
      await occupied.query('SELECT pg_advisory_lock($1,$2)',[LOCK_NAMESPACE,LOCK_RESOURCE]);
      const busyBody = new FormData(); busyBody.append('backup',new Blob(['AUDIT_TEST']),'audit.enc.json');
      const busy=await fetch(base+'/api/system/backup/restore/dry-run',{method:'POST',headers:adminHeaders,body:busyBody});
      assert.equal(busy.status,429);
      assert.equal((await busy.json()).code,'RESTORE_BUSY');
      assert.equal(multipartInvocations,0);
    } finally { await occupied.query('SELECT pg_advisory_unlock($1,$2)',[LOCK_NAMESPACE,LOCK_RESOURCE]); occupied.release(); }
    const mfa = require('../src/services/mfaService');
    const { authenticator } = require('otplib');
    const secret = authenticator.generateSecret();
    await database.query('INSERT INTO user_mfa_settings(user_id,totp_secret_encrypted,enabled) VALUES ($1,$2,true)',[member,mfa.encryptSecret(secret)]);
    const token = await mfa.createChallengeToken({id:member,token_version:0},'login');
    const code = authenticator.generate(secret);
    const login = challenge => fetch(base+'/api/auth/mfa/verify-login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({challenge_token:challenge,code})
    });
    const responses=await Promise.all([login(token),login(token)]);
    assert.deepEqual(responses.map(result=>result.status).sort(),[200,401]);
    const another = await mfa.createChallengeToken({id:member,token_version:0},'login');
    assert.equal((await login(another)).status,401,'TOTP step cannot be reused in another challenge');
    const {consumeChallenge}=require('../src/services/mfaChallengeService');
    const invalidToken=await mfa.createChallengeToken({id:member,token_version:0},'login');
    const payload=mfa.verifyChallengeToken(invalidToken,'login');
    for(let i=0;i<6;i++) await assert.rejects(consumeChallenge(payload,{code:'invalid'}));
    assert.equal((await database.query('SELECT attempts FROM mfa_login_challenges WHERE challenge_hash=$1',[crypto.createHash('sha256').update(payload.jti).digest('hex')])).rows[0].attempts,5);
    await database.query("UPDATE mfa_login_challenges SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second'");
    await assert.rejects(consumeChallenge(mfa.verifyChallengeToken(another,'login'),{code}));
    const setupSecret=authenticator.generateSecret();
    await database.query('INSERT INTO user_mfa_settings(user_id,totp_secret_encrypted,enabled) VALUES ($1,$2,false)',[owner,mfa.encryptSecret(setupSecret)]);
    const setupToken=await mfa.createChallengeToken({id:owner,token_version:0},'setup');
    const setup=()=>fetch(base+'/api/auth/mfa/setup/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setup_token:setupToken,code:authenticator.generate(setupSecret)})});
    const setupResponses=await Promise.all([setup(),setup()]);
    assert.deepEqual(setupResponses.map(result=>result.status).sort(),[200,401]);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM user_mfa_recovery_codes WHERE user_id=$1',[owner])).rows[0].count,10);
    console.log('PASS FP-04 ACL; FP-06 pool concurrency/rollback; FP-03/05 containment; FP-13 HTTP auth+CSRF before multipart/disk and cross-connection lease; FP-08 concurrent login/setup, replay, expiry, persistent attempts; additive migration idempotence.');
  } finally {
    if(httpServer) await new Promise(resolve=>httpServer.close(resolve));
    if(database) await database.pool.end();
    await postgres.stop().catch(()=>{});
    // Only the random directory created above may be removed.
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fullpassword-audit-test-'));
    await fs.rm(directory,{recursive:true,force:true});
  }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
