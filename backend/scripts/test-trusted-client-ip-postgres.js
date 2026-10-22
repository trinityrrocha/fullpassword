// Real disposable PostgreSQL + actual HTTP application. No remote DB accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fullpassword-client-ip-'));
  const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const password = crypto.randomBytes(32).toString('hex');
  const postgres = new EmbeddedPostgres({ databaseDir:path.join(directory,'pgdata'),user:'postgres',password,port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{} });
  let db, server;
  try {
    await postgres.initialise(); await postgres.start();
    Object.assign(process.env, { DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_USER:'postgres',DB_PASSWORD:password,DB_NAME:'postgres',NODE_ENV:'test',JWT_SECRET:crypto.randomBytes(64).toString('hex'),ADMIN_BOOTSTRAP_TOKEN:crypto.randomBytes(64).toString('hex'),APP_ORIGIN:'http://127.0.0.1',SUPER_ADMIN_EMAIL:'ip-admin@example.invalid',BACKUP_TEMP_DIR:path.join(directory,'uploads'),CLIENT_IP_MODE:'direct',TRUSTED_COUNTRY_HEADER_ENABLED:'true' });
    db = require('../src/config/database');
    await db.query(await fs.readFile(path.join(__dirname,'../../database/init.sql'),'utf8'));
    await require('../src/config/securitySchema').ensureSecuritySchema();
    const argon2 = require('argon2'); const loginPassword = crypto.randomBytes(32).toString('hex') + 'Aa1!';
    const id=crypto.randomUUID();
    await db.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin,must_change_password) VALUES($1,'IP TEST','ip-admin@example.invalid',$2,'admin',true,false)",[id,await argon2.hash(loginPassword)]);
    await db.query('UPDATE login_security_policy SET auto_block_enabled=true,failed_attempts_threshold=5,observation_window_minutes=15,block_duration_minutes=30 WHERE id=1');
    const {app} = require('../src/server');
    server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
    const origin='http://127.0.0.1:'+server.address().port;
    const request=async(mode,ip,url,body,cookie)=>{
      const headers={'x-forwarded-for':ip,'Content-Type':'application/json'};
      if(mode!=='direct') Object.assign(headers,{'cf-connecting-ip':ip,'x-fullpassword-cloudflare':'1','x-fullpassword-client-ip-mode':mode,'cf-ray':'0123456789abcdef-GRU','cf-ipcountry':'BR'});
      if(cookie)headers.cookie=cookie;
      const response=await fetch(origin+url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
      return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};
    };
    let index=0;
    for(const mode of ['direct','cloudflare_proxy','cloudflare_tunnel']) {
      process.env.CLIENT_IP_MODE=mode;
      await db.query('DELETE FROM ip_security_rules');
      await db.query('DELETE FROM system_audit_events');
      const a='203.0.113.'+(10+index),b='198.51.100.'+(20+index);index++;
      for(let n=0;n<5;n++) assert.equal((await request(mode,a,'/api/auth/login',{email:'ip-admin@example.invalid',password:'SYNTHETIC_WRONG_PASSWORD'})).status,401);
      const block=await db.query("SELECT ip_address,expires_at FROM ip_security_rules WHERE rule_type='temporary_block' AND is_active=true");
      assert.deepEqual(block.rows.map(r=>r.ip_address),[a]);
      assert(new Date(block.rows[0].expires_at)-Date.now()>29*60000 && new Date(block.rows[0].expires_at)-Date.now()<=30*60000);
      assert.equal((await request(mode,a,'/api/auth/login',{email:'ip-admin@example.invalid',password:loginPassword})).status,403);
      const login=await request(mode,b,'/api/auth/login',{email:'ip-admin@example.invalid',password:loginPassword});assert.equal(login.status,200,JSON.stringify(login.body));
      const session=await db.query('SELECT ip_address FROM user_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[id]);assert.equal(session.rows[0].ip_address,b);
      const audit=await db.query("SELECT ip_address,metadata FROM system_audit_events WHERE action='login_success' ORDER BY created_at DESC LIMIT 1");assert.equal(audit.rows[0].ip_address,b);
      assert.equal(audit.rows[0].metadata.country,mode==='direct'?null:'BR');
      if(mode!=='direct')assert.equal(audit.rows[0].metadata.cloudflare_ray_id,'0123456789abcdef-GRU');
      else assert.equal(audit.rows[0].metadata.cloudflare_ray_id,undefined);
      const status=await request(mode,b,'/api/system/client-ip-status',null,login.cookie);assert.equal(status.status,200);assert.equal(status.body.client_ip,b);assert.equal(status.body.mode,mode);
      assert.equal((await request(mode,b,'/api/system/client-ip-status')).status,401);
      if(mode==='direct') {
        const ordinaryId=crypto.randomUUID();
        await db.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin) VALUES($1,'IP ADMIN TEST','ip-ordinary@example.invalid','SYNTHETIC_HASH','admin',false)",[ordinaryId]);
        const ordinary=await require('../src/services/sessionService').createUserSession({ip:b,get:()=>''},{id:ordinaryId,token_version:0});
        assert.equal((await request(mode,b,'/api/system/client-ip-status',null,'fp_session='+ordinary.token)).status,403);
      }
      // Manual block and whitelist precedence operate on each canonical IP only.
      await db.query("INSERT INTO ip_security_rules(ip_address,rule_type,reason) VALUES($1,'allow','SYNTHETIC'),($2,'block','SYNTHETIC')",[a,b]);
      assert.equal((await request(mode,a,'/api/auth/bootstrap/status')).status,200);
      assert.equal((await request(mode,b,'/api/auth/bootstrap/status')).status,403);
      await db.query('DELETE FROM ip_security_rules');
      for(let n=0;n<3;n++) assert.notEqual((await request(mode,a,'/api/auth/password-reset/request',{email:`absent-${mode}-${n}@example.invalid`})).status,429);
      assert.equal((await request(mode,a,'/api/auth/password-reset/request',{email:`absent-extra-${mode}@example.invalid`})).status,429);
      assert.notEqual((await request(mode,b,'/api/auth/password-reset/request',{email:`other-${mode}@example.invalid`})).status,429);
      await db.query('UPDATE login_security_policy SET auto_block_enabled=false WHERE id=1');
      const limiterA='192.0.2.'+(30+index),limiterB='192.0.2.'+(60+index);
      for(let n=0;n<100;n++) assert.equal((await request(mode,limiterA,'/api/auth/login',{email:'absent@example.invalid',password:'SYNTHETIC_WRONG_PASSWORD'})).status,401);
      assert.equal((await request(mode,limiterA,'/api/auth/login',{email:'absent@example.invalid',password:'SYNTHETIC_WRONG_PASSWORD'})).status,429);
      assert.equal((await request(mode,limiterB,'/api/auth/login',{email:'absent@example.invalid',password:'SYNTHETIC_WRONG_PASSWORD'})).status,401);
      for(let n=0;n<10;n++) assert.notEqual((await request(mode,limiterA,'/api/auth/mfa/verify-login',{challenge_id:'SYNTHETIC_INVALID'})).status,429);
      assert.equal((await request(mode,limiterA,'/api/auth/mfa/verify-login',{challenge_id:'SYNTHETIC_INVALID'})).status,429);
      assert.notEqual((await request(mode,limiterB,'/api/auth/mfa/verify-login',{challenge_id:'SYNTHETIC_INVALID'})).status,429);
      await db.query('UPDATE login_security_policy SET auto_block_enabled=true WHERE id=1');
      console.log(mode+': PASS real PostgreSQL/HTTP automatic block A5/B unaffected, sessions/audit, whitelist/manual block, reset limiter, Super Admin diagnostics.');
    }
    const gateway=await db.query("SELECT count(*)::int AS n FROM system_audit_events WHERE ip_address='172.18.0.1'");assert.equal(gateway.rows[0].n,0);
    assert((await db.query('SELECT count(DISTINCT ip_address)::int AS n FROM user_sessions WHERE user_id=$1',[id])).rows[0].n>=3,'simultaneous sessions preserve distinct client IPs');
    console.log('Trusted Client IP PostgreSQL integration: PASS. Synthetic data only; disposable database.');
  } finally {
    if(server)await new Promise(r=>server.close(r));
    if(db)await db.pool.end();
    await postgres.stop().catch(()=>{});
    await fs.rm(directory,{recursive:true,force:true});
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
