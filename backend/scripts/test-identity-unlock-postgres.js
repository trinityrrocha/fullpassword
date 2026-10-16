// Fresh process and native localhost PostgreSQL, never an existing database.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
async function run(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'fullpassword-unlock-test-'));
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const {default:EmbeddedPostgres}=await import('embedded-postgres');
  const password='SYNTHETIC_Login_!'+crypto.randomBytes(12).toString('hex'),dbPassword=crypto.randomBytes(32).toString('hex');
  const postgres=new EmbeddedPostgres({databaseDir:path.join(directory,'pgdata'),user:'postgres',password:dbPassword,port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  let database,server;
  const sockets=new Set();
  try{
    await postgres.initialise();await postgres.start();
    Object.assign(process.env,{DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_USER:'postgres',DB_PASSWORD:dbPassword,DB_NAME:'postgres',NODE_ENV:'test',JWT_SECRET:crypto.randomBytes(64).toString('hex'),CONFIG_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),ADMIN_BOOTSTRAP_TOKEN:crypto.randomBytes(64).toString('hex'),APP_ORIGIN:'http://127.0.0.1',SUPER_ADMIN_EMAIL:'synthetic-admin@example.invalid',BACKUP_TEMP_DIR:path.join(directory,'uploads')});
    database=require('../src/config/database');database.pool.on('connect',client=>{const ended=new Promise(resolve=>client.once('end',resolve));sockets.add(ended);ended.then(()=>sockets.delete(ended));});
    await require('./legacy-upgrade-fixture').prepareLegacySchema(database);
    await require('../src/config/securitySchema').ensureSecuritySchema();
    await database.query(await fs.readFile(path.join(__dirname,'../../database/migrations/21_stage_isolated_vault_crypto.sql'),'utf8'));
    const owner=crypto.randomUUID();await database.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin) VALUES($1,'SYNTHETIC_ADMIN','synthetic-admin@example.invalid',$2,'admin',true)",[owner,await require('argon2').hash(password)]);
    global.window=globalThis;
    const frontend=async file=>import(pathToFileURL(path.join(__dirname,'../../frontend/src/services',file)));
    const v2=await frontend('vaultCryptoV2.js');
    server=await new Promise(resolve=>{const http=require('../src/server').app.listen(0,'127.0.0.1',()=>resolve(http));});
    const base='http://127.0.0.1:'+server.address().port+'/api';
    function browserClient(){const cookies={},payloads=[];const call=async(method,url,data,noCsrf=false)=>{
      const headers={'Content-Type':'application/json',Cookie:Object.entries(cookies).map(([k,v])=>k+'='+v).join('; ')};
      if(cookies.fp_csrf&&!noCsrf)headers['x-csrf-token']=cookies.fp_csrf;
      if(data)payloads.push(JSON.stringify(data));const response=await fetch(base+url,{method,headers,body:data?JSON.stringify(data):undefined});
      for(const item of response.headers.getSetCookie()){const pair=item.split(';')[0],i=pair.indexOf('=');cookies[pair.slice(0,i)]=pair.slice(i+1);}
      const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.code||result.error),{response:{status:response.status,data:result}});return{data:result,status:response.status};
    };return{get:url=>call('GET',url),post:(url,data)=>call('POST',url,data),put:(url,data)=>call('PUT',url,data),putWithoutCsrf:(url,data)=>call('PUT',url,data,true),payloads};}
    const ownerApi=browserClient();await ownerApi.post('/auth/login',{email:'synthetic-admin@example.invalid',password});
    await ownerApi.post('/crypto/identity',{identity:await v2.createIndependentIdentity(owner,'SYNTHETIC_ADMIN_UNLOCK_ONLY'),current_password:password});
    await require('./identity-unlock-change-fixture')({database,browserClient,ownerApi,password,v2,frontend});
    await require('./password-policy-fixture')({database,browserClient,ownerApi,password,v2,frontend});
    console.log((await database.query('SELECT version()')).rows[0].version);console.log('PASS dedicated native PostgreSQL unlock-secret integration. Existing installations were not accessed.');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    if(database){await database.pool.end();await Promise.all([...sockets]);}
    await postgres.stop().catch(()=>{});
    if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(directory).startsWith('fullpassword-unlock-test-'))throw new Error('Unsafe temporary cleanup target');
    await fs.rm(directory,{recursive:true,force:true});
  }
}
// All HTTP/PG/filesystem cleanup above has completed before setting final status.
// embedded-postgres's async beforeExit hook must not turn a failed assertion into 0.
run().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
