// Dedicated GitHub-hosted rehearsal only. Never accepts an existing installation/DB.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync,spawn}=require('node:child_process');
const {Client}=require('pg');
const {deploy,verifyDeployment}=require('../../scripts/deploy-approved-release');
const {atomic}=require('../../scripts/release-agent');
const {historicalBuild}=require('./rehearsal-historical-build');
const BASE='d9a7a3786143379df43ff1910263894df33449bf';
const ROOT=path.resolve(__dirname,'../..');
const run=(command,args,options={})=>{
 const result=spawnSync(command,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:1200000,maxBuffer:64*1024*1024,...options});
 if(result.status!==0) throw new Error('REHEARSAL_COMMAND_FAILED: '+command+' '+args.slice(0,2).join(' '));
 return result.stdout?.trim();
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitFor=async predicate=>{for(let n=0;n<90;n++){try{if(await predicate())return;}catch{}await pause(2000);}throw Error('REHEARSAL_TIMEOUT');};
const archive=(revision,directory)=>{
 fs.mkdirSync(directory,{recursive:true});
 const result=spawnSync('git',['archive','--format=tar',revision],{cwd:ROOT,maxBuffer:64*1024*1024});
 assert.equal(result.status,0);
 run('tar',['-x','-C',directory],{input:result.stdout});
};
const jsonLines=file=>fs.readFileSync(file,'utf8').split('\n').slice(0,-1).filter(Boolean).map(line=>JSON.parse(line));
// Monitor outside this Node process: deploy/agent use spawnSync and block its event loop.
const monitorDatabase=(project,connection,directory)=>{
 const events=path.join(directory,'db-events.jsonl'),probes=path.join(directory,'db-probes.jsonl');
 const eventFd=fs.openSync(events,'wx',0o600),probeFd=fs.openSync(probes,'wx',0o600);
 const watcher=spawn('docker',['events','--filter','type=container','--filter','label=com.docker.compose.project='+project,
  '--filter','label=com.docker.compose.service=db','--format','{{json .}}'],{stdio:['ignore',eventFd,'ignore']});
 const code=`const {Pool}=require(${JSON.stringify(require.resolve('pg'))});let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const pool=new Pool({...JSON.parse(s),connectionTimeoutMillis:2000,query_timeout:2000});let stopped=false;const record=ok=>console.log(JSON.stringify({ok,at:Date.now()}));pool.on('error',()=>record(false));async function tick(){if(stopped)return;try{const r=await pool.query('SELECT 1 AS value');record(r.rows[0].value===1)}catch{record(false)}if(!stopped)setTimeout(tick,250)}process.once('SIGTERM',async()=>{stopped=true;await pool.end();process.exit(0)});tick()});`;
 const probe=spawn(process.execPath,['-e',code],{stdio:['pipe',probeFd,'ignore']});
 probe.stdin.end(JSON.stringify(connection));
 return {events,probes,async stop(){for(const child of [probe,watcher]){
  if(child.exitCode!==null)continue;
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
 }fs.closeSync(eventFd);fs.closeSync(probeFd);}};
};
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
 assert.equal(fs.existsSync('/etc/fullpassword/release-policy.json'),false,'never overwrite an existing operator policy');
 const target=run('git',['rev-parse','HEAD']);
 const bootstrap=run('git',['rev-list','-1','--grep=^security: implement approved releases and scoped legacy shares',target]);
 assert.match(bootstrap,/^[a-f0-9]{40}$/);assert.notEqual(target,bootstrap,'rehearsal needs two actual application revisions');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fp-docker-rehearsal-'));
 const project='fp-rehearsal-'+crypto.randomBytes(5).toString('hex');
 const registry='fp-registry-'+crypto.randomBytes(5).toString('hex');
 const operator='/etc/fullpassword',publicDir='/var/lib/fullpassword-release-public',queue='/var/lib/fullpassword-release-queue',state='/var/lib/fullpassword-release-agent';
 const old=path.join(temporary,'old'),boot=path.join(temporary,'bootstrap');
 const pgPassword=crypto.randomBytes(32).toString('hex'),runtimePassword=crypto.randomBytes(32).toString('hex');
 const loginPassword='SYNTHETIC_Login_!'+crypto.randomBytes(20).toString('hex');
 let database,restoredDatabase,databaseMonitor;
 const databaseDependencyChecks=[];
 let compose;
 const dockerCompose=args=>run('docker',['compose','-p',project,'-f',compose,...args]);
 try {
  archive(BASE,old);archive(bootstrap,boot);
  run('docker',['run','-d','--name',registry,'-p','127.0.0.1:5000:5000','registry:2']);
  console.log('Building old installation '+BASE+' and bootstrap application '+bootstrap);
  historicalBuild({step:'historical-base-backend',revision:BASE,args:['build','--label','org.opencontainers.image.revision='+BASE,'--build-arg','BACKEND_APP_COMMIT='+BASE,'-t','fp-rehearsal-old-backend',path.join(old,'backend')]},{cwd:ROOT});
  historicalBuild({step:'historical-base-frontend',revision:BASE,args:['build','--build-arg','VITE_APP_COMMIT='+BASE,'-t','fp-rehearsal-old-frontend',path.join(old,'frontend')]},{cwd:ROOT});
  const images={};
  for(const [revision,source] of [[bootstrap,boot],[target,ROOT]]) {
   images[revision]={};
   for(const service of ['backend','frontend']) {
    const tag='127.0.0.1:5000/trinityrrocha/fullpassword-'+service+':'+revision;
    if(revision===target)run('docker',['tag','fullpassword-audit-'+service,tag]);
    else historicalBuild({step:'bootstrap-'+service,revision,args:['build','--build-arg',(service==='backend'?'BACKEND_APP_COMMIT=':'VITE_APP_COMMIT=')+revision,'-t',tag,path.join(source,service)]},{cwd:ROOT});
    run('docker',['push',tag]);
    images[revision][service]=JSON.parse(run('docker',['image','inspect','--format','{{json .RepoDigests}}',tag])).find(value=>value.startsWith('127.0.0.1:5000/'));
    assert.match(images[revision][service],/@sha256:[a-f0-9]{64}$/);
   }
  }
  for(const directory of [operator,publicDir,queue,state])fs.mkdirSync(directory,{recursive:true,mode:directory===state?0o700:0o755});
  fs.chownSync(queue,0,1000);fs.chmodSync(queue,0o770);
  fs.writeFileSync(path.join(publicDir,'.operator-owned'),'');fs.writeFileSync(path.join(state,'.operator-owned'),'');
  const environment={PORT:'3000',DB_HOST:'db',DB_PORT:'5432',DB_NAME:'postgres',DB_USER:'postgres',DB_PASSWORD:pgPassword,NODE_ENV:'production',APP_ORIGIN:'https://audit.example.invalid',SUPER_ADMIN_EMAIL:'audit@example.invalid',JWT_SECRET:crypto.randomBytes(64).toString('hex'),ADMIN_BOOTSTRAP_TOKEN:crypto.randomBytes(64).toString('hex'),CONFIG_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),BACKUP_ARCHIVE_DIR:'/tmp/backups'};
  compose=path.join(operator,'compose.json');
  const config={name:project,services:{
   db:{image:'postgres:15-alpine',environment:{POSTGRES_PASSWORD:pgPassword},ports:['127.0.0.1:55432:5432'],volumes:['data:/var/lib/postgresql/data',path.join(old,'database/init.sql')+':/docker-entrypoint-initdb.d/init.sql:ro'],healthcheck:{test:['CMD-SHELL','pg_isready -U postgres'],interval:'2s',timeout:'2s',retries:60}},
   backend:{image:'fp-rehearsal-old-backend',environment,ports:['127.0.0.1:53000:3000'],depends_on:{db:{condition:'service_healthy'}},healthcheck:{test:['CMD','node','scripts/check-health.js'],interval:'2s',timeout:'5s',retries:90,start_period:'20s'},volumes:[publicDir+':'+publicDir+':ro',queue+':'+queue]},
   frontend:{image:'fp-rehearsal-old-frontend'},
   'schema-migrate':{image:images[target].backend,profiles:['operator'],command:['node','scripts/migrate-schema.js'],restart:'no',environment,depends_on:{db:{condition:'service_healthy'}}}
  },volumes:{data:{}}};
  fs.writeFileSync(compose,JSON.stringify(config),{mode:0o600});
  dockerCompose(['up','-d','--wait','--wait-timeout','180','db','backend','frontend']);
  const base='http://127.0.0.1:53000/api';
  await waitFor(async()=>{const response=await fetch(base+'/health');return response.ok;});
  const oldHealth=await (await fetch(base+'/health')).json();assert.equal(oldHealth.commit,BASE);
  database=new Client({host:'127.0.0.1',port:55432,user:'postgres',password:pgPassword,database:'postgres'});await database.connect();
  const owner=crypto.randomUUID(),recipient=crypto.randomUUID(),vault=crypto.randomUUID(),group=crypto.randomUUID();
  const hash=await require('argon2').hash(loginPassword);
  await database.query("INSERT INTO users(id,name,email,hash_senha_login,role,is_super_admin) VALUES($1,'SYNTHETIC_OPERATOR','audit@example.invalid',$2,'admin',true),($3,'SYNTHETIC_READER','reader@example.invalid',$2,'user',false)",[owner,hash,recipient]);
  await database.query("INSERT INTO clients(id,name,created_by) VALUES($1,'SYNTHETIC_EXISTING_VAULT',$2)",[vault,owner]);
  await database.query("INSERT INTO groups(id,name,can_view,can_edit,can_add,can_delete) VALUES($1,'SYNTHETIC_GROUP',true,false,false,false)",[group]);
  await database.query('INSERT INTO user_groups(user_id,group_id) VALUES($1,$2)',[recipient,group]);
  await database.query('INSERT INTO client_group_access(client_id,group_id,can_view,can_edit,can_add,can_delete) VALUES($1,$2,true,false,false,false)',[vault,group]);
  const fixtureCipher=crypto.randomBytes(80).toString('base64'); // preservation fixture; crypto validity covered by the native upgrade suite
  const item=(await database.query("INSERT INTO vault_items(client_id,category,encrypted_data,encrypted_attachment,created_by) VALUES($1,'VPN',$2,$3,$4) RETURNING id",[vault,fixtureCipher,fixtureCipher,owner])).rows[0].id;
  await database.query('INSERT INTO vault_shares(vault_item_id,user_id,encrypted_vault_key) VALUES($1,$2,$3)',[item,recipient,fixtureCipher]);
  const snapshot=async client=>(await client.query('SELECT vi.id,vi.encrypted_data,vi.encrypted_attachment,vs.user_id FROM vault_items vi JOIN vault_shares vs ON vs.vault_item_id=vi.id ORDER BY vi.id')).rows;
  const before=await snapshot(database);
  dockerCompose(['stop','backend']);
  const dump=run('docker',['compose','-p',project,'-f',compose,'exec','-T','db','pg_dump','-U','postgres','--clean','--if-exists','postgres']);
  const recovery=path.join(operator,'synthetic-recovery.sql');fs.writeFileSync(recovery,dump,{mode:0o600});
  const recoveryContainer=project+'-recovery-db';
  run('docker',['run','-d','--name',recoveryContainer,'--network',project+'_default','-p','127.0.0.1:55433:5432','-e','POSTGRES_PASSWORD='+pgPassword,'-v',project+'_recovery_data:/var/lib/postgresql/data','postgres:15-alpine']);
  await waitFor(()=>run('docker',['exec',recoveryContainer,'pg_isready','-U','postgres']).includes('accepting connections'));
  restoredDatabase=new Client({host:'127.0.0.1',port:55433,user:'postgres',password:pgPassword,database:'postgres'});await restoredDatabase.connect();
  run('docker',['exec','-i',recoveryContainer,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:dump});
  assert.deepEqual(await snapshot(restoredDatabase),before);
  console.log('PASS old image/schema + data, stopped writers, recovery restored into a SECOND PostgreSQL container/volume.');
  const dbSnapshot=()=>{
   const id=dockerCompose(['ps','-q','db']);
   const inspected=JSON.parse(run('docker',['inspect','--format','{"id":{{json .Id}},"restartCount":{{json .RestartCount}},"imageId":{{json .Image}},"startedAt":{{json .State.StartedAt}},"status":{{json .State.Status}},"health":{{json .State.Health.Status}},"mounts":{{json .Mounts}}}',id]));
   const mount=inspected.mounts.find(value=>value.Destination==='/var/lib/postgresql/data');assert(mount&&mount.Type==='volume');
   const volume=JSON.parse(run('docker',['volume','inspect','--format','{"name":{{json .Name}},"mountpoint":{{json .Mountpoint}},"createdAt":{{json .CreatedAt}}}',mount.Name]));
   return {id:inspected.id,restartCount:inspected.restartCount,imageId:inspected.imageId,startedAt:inspected.startedAt,
    status:inspected.status,health:inspected.health,volume:{...volume,source:mount.Source,target:mount.Destination},
    projectVolumes:run('docker',['volume','ls','--filter','name='+project+'_','--format','{{.Name}}']).split('\n').filter(Boolean).sort()};
  };
  const applicationSnapshot=()=>Object.fromEntries(['backend','frontend'].map(service=>{
   const id=dockerCompose(['ps','--all','-q',service]);return [service,{id,imageId:run('docker',['inspect','--format','{{.Image}}',id])}];
  }));
  const originalDb=dbSnapshot();const originalApps=applicationSnapshot();
  databaseMonitor=monitorDatabase(project,{host:'127.0.0.1',port:55432,user:'postgres',password:pgPassword,database:'postgres'},temporary);
  await waitFor(()=>jsonLines(databaseMonitor.probes).some(row=>row.ok));
  const assertDatabaseUntouched=async phase=>{
   const after=dbSnapshot();assert.deepEqual(after,originalDb,'deployment must not recreate database dependency: '+phase);
   const lifecycle=jsonLines(databaseMonitor.events).filter(event=>['create','start','restart','stop','kill','die','destroy','pause','unpause'].includes(event.Action));
   assert.deepEqual(lifecycle,[],'database lifecycle changed during forward/rollback');
   const observations=jsonLines(databaseMonitor.probes);assert(observations.length>0);assert(observations.every(row=>row.ok),'SELECT 1 availability interrupted');
   assert.equal((await database.query('SELECT 1 AS value')).rows[0].value,1);assert.equal(after.health,'healthy');
   const result={phase,before:originalDb,after,unwantedLifecycleEvents:0,select1Samples:observations.length,availabilityErrors:0};
   databaseDependencyChecks.push(result);console.log('PASS deployment must not recreate database dependency: '+JSON.stringify(result));
  };
  await database.query("CREATE ROLE fp_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+runtimePassword+"'");
  await database.query('GRANT CONNECT ON DATABASE postgres TO fp_runtime; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO fp_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO fp_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO fp_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO fp_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO fp_runtime;');
  config.services.backend.environment={...environment,DB_USER:'fp_runtime',DB_PASSWORD:runtimePassword,DB_SCHEMA_MODE:'verify'};
  config.services.backend.image=images[bootstrap].backend;
  config.services['schema-migrate'].image=images[bootstrap].backend;
  // Deliberate fixture-only drift makes the old dependency-reconciling up fail this test.
  // --no-deps must leave this desired db label unapplied; never modify the production db service.
  config.services.db.labels={'io.fullpassword.synthetic.desired-db-change':'must-not-be-applied-by-app-release'};
  Object.assign(config.services.backend,{read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],tmpfs:['/tmp:rw,noexec,nosuid,size=512m']});
  fs.writeFileSync(compose,JSON.stringify(config),{mode:0o600});
  const signing=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
  const publicKey=path.join(operator,'release-public.pem');fs.writeFileSync(publicKey,signing.publicKey.export({type:'spki',format:'pem'}),{mode:0o644});
  const policy={environment:'test',registry:'loopback-test',origin:environment.APP_ORIGIN,publicKeyFile:publicKey,composeFile:compose,recoveryArchive:recovery,recoverySha256:crypto.createHash('sha256').update(dump).digest('hex'),restoreVerified:true,migrateSchema:true,queueDirectory:queue,publicDirectory:publicDir,stateDirectory:state};
  const approve=revision=>{
   const manifest=Buffer.from(JSON.stringify({repository:'trinityrrocha/fullpassword',revision,origin:environment.APP_ORIGIN,...images[revision]}));
   Object.assign(policy,{approvedRevision:revision,approvalId:crypto.randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),manifestFile:path.join(operator,'manifest.json'),signatureFile:path.join(operator,'manifest.sig')});
   fs.writeFileSync(policy.manifestFile,manifest,{mode:0o600});fs.writeFileSync(policy.signatureFile,crypto.sign('sha256',manifest,signing.privateKey),{mode:0o600});
   fs.writeFileSync(path.join(operator,'release-policy.json'),JSON.stringify(policy),{mode:0o600});
  };
  // Initial operator bootstrap from old installation; no old web-main button is used.
  approve(bootstrap);
  run('bash',[path.join(ROOT,'scripts/bootstrap-release-agent.sh'),ROOT,'1000'],{env:{...process.env,PATH:path.dirname(process.execPath)+':'+process.env.PATH}});
  const agentPath='/usr/local/lib/fullpassword-release/release-agent.js';
  assert.equal(fs.readFileSync(agentPath,'utf8'),fs.readFileSync(path.join(ROOT,'scripts/release-agent.js'),'utf8'));
  deploy(policy.manifestFile,policy.signatureFile);
  await assertDatabaseUntouched('operator-forward');
  const bootstrapApps=applicationSnapshot();
  for(const service of ['backend','frontend']){assert.notEqual(bootstrapApps[service].id,originalApps[service].id);assert.notEqual(bootstrapApps[service].imageId,originalApps[service].imageId);}
  assert.deepEqual(await snapshot(database),before);
  verifyDeployment(policy,{revision:bootstrap,...images[bootstrap]});
  const bootstrapDump=dockerCompose(['exec','-T','db','pg_dump','-U','postgres','--clean','--if-exists','postgres']);
  approve(target);
  run(process.execPath,[agentPath]); // installed host agent publishes catalog, no request yet
  const cookies={};
  const api=async(method,url,body)=>{
   const headers={'Content-Type':'application/json',Cookie:Object.entries(cookies).map(([name,value])=>name+'='+value).join('; ')};
   if(cookies.fp_csrf)headers['x-csrf-token']=cookies.fp_csrf;
   const response=await fetch(base+url,{method,headers,body:body?JSON.stringify(body):undefined});
   for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],index=pair.indexOf('=');cookies[pair.slice(0,index)]=pair.slice(index+1);}
   return {status:response.status,data:await response.json()};
  };
  assert.equal((await api('POST','/auth/login',{email:'audit@example.invalid',password:loginPassword})).status,200);
  const release=(await api('GET','/system/update/status')).data.release;
  const action={approvalId:release.approvalId,revision:release.revision,manifestHash:release.manifestHash};
  // The immutable historical bootstrap image predates this UX change. Its one-time
  // transition keeps its historical authentication contract; never use this adapter
  // against the current candidate. All requests served by target below are direct 202.
  assert.equal((await api('GET','/health')).data.commit,bootstrap);
  const bootstrapRequest=await api('POST','/system/update',action);
  if(bootstrapRequest.data.code==='REAUTH_REQUIRED') {
   const legacyGrant=(await api('POST','/auth/reauth',{purpose:'system_release',action,current_password:loginPassword})).data.token;
   assert.equal((await api('POST','/system/update',{...action,_reauth_token:legacyGrant})).status,202);
  } else assert.equal(bootstrapRequest.status,202);
  const requestStarted=Date.now();
  run(process.execPath,[agentPath]);
  assert.ok(Date.now()-requestStarted>=60000);
  const completed=JSON.parse(fs.readFileSync(path.join(publicDir,'status.json')));
  assert.equal(completed.state,'completed');assert.equal(completed.revision,target);
  verifyDeployment(policy,{revision:target,...images[target]});
  await assertDatabaseUntouched('agent-forward');
  const targetApps=applicationSnapshot();
  for(const service of ['backend','frontend']){assert.notEqual(targetApps[service].id,bootstrapApps[service].id);assert.notEqual(targetApps[service].imageId,bootstrapApps[service].imageId);}
  assert.deepEqual(await snapshot(database),before);
  assert.equal((await database.query('SELECT can_edit FROM client_group_access WHERE client_id=$1',[vault])).rows[0].can_edit,false);
  // Replay is ignored and cannot trigger another rollout.
  const originalFinished=completed.finishedAt;
  run(process.execPath,[agentPath]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(publicDir,'status.json'))).finishedAt,originalFinished);
  // A correctly signed but internally inconsistent release must fail and request recovery.
  approve(target);
  const broken=Buffer.from(JSON.stringify({repository:'trinityrrocha/fullpassword',revision:target,origin:environment.APP_ORIGIN,backend:images[bootstrap].backend,frontend:images[bootstrap].frontend}));
  fs.writeFileSync(policy.manifestFile,broken,{mode:0o600});fs.writeFileSync(policy.signatureFile,crypto.sign('sha256',broken,signing.privateKey),{mode:0o600});
  run(process.execPath,[agentPath]);
  const brokenRelease=(await api('GET','/system/update/status')).data.release;
  const brokenAction={approvalId:brokenRelease.approvalId,revision:brokenRelease.revision,manifestHash:brokenRelease.manifestHash};
  assert.equal((await api('GET','/health')).data.commit,target);
  assert.equal((await api('POST','/system/update',brokenAction)).status,202);
  const failed=spawnSync(process.execPath,[agentPath],{cwd:ROOT,encoding:'utf8',timeout:1200000});
  assert.equal(failed.status,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(publicDir,'status.json'))).state,'recovery_required');
  verifyDeployment(policy,{revision:target,...images[target]}); // image rollback actually restored the prior healthy services
  await assertDatabaseUntouched('image-rollback');
  const rollbackApps=applicationSnapshot();
  for(const service of ['backend','frontend']){assert.equal(rollbackApps[service].imageId,targetApps[service].imageId);assert.notEqual(rollbackApps[service].id,targetApps[service].id);}
  assert.deepEqual(await snapshot(database),before);
  // Recovery is MORE than image rollback: restore the saved bootstrap DB into the second
  // PostgreSQL volume, with preserved operational config/secrets and compatible backend.
  await restoredDatabase.query("CREATE ROLE fp_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+runtimePassword+"'");
  run('docker',['exec','-i',recoveryContainer,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:bootstrapDump});
  assert.deepEqual(await snapshot(restoredDatabase),before);
  const recoveryApi=project+'-recovery-api';
  const recoveryEnvironment={...config.services.backend.environment,DB_HOST:recoveryContainer};
  const envArgs=Object.entries(recoveryEnvironment).flatMap(([name,value])=>['-e',name+'='+value]);
  run('docker',['run','-d','--name',recoveryApi,'--network',project+'_default','-p','127.0.0.1:53001:3000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=512m',...envArgs,images[bootstrap].backend]);
  await waitFor(async()=>{const response=await fetch('http://127.0.0.1:53001/api/health');return response.ok;});
  assert.equal((await (await fetch('http://127.0.0.1:53001/api/health')).json()).commit,bootstrap);
  const recoveredLogin=await fetch('http://127.0.0.1:53001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'audit@example.invalid',password:loginPassword})});
  assert.equal(recoveredLogin.status,200);
  console.log(JSON.stringify({passed:true,base:BASE,bootstrap,target,agentRevision:target,agentBootstrapped:true,images,webRequest:true,minimumStabilityMs:60000,restoredRecovery:true,secondPostgresVolume:true,failureAndImageRollback:true,recoveredLogin:true,preservedOldData:true,replayBlocked:true,databaseDependencyChecks},null,2));
 } finally {
  await databaseMonitor?.stop();
  await database?.end().catch(()=>{});
  await restoredDatabase?.end().catch(()=>{});
  for(const name of [project+'-recovery-api',project+'-recovery-db'])try{run('docker',['rm','-f',name]);}catch{}
  if(compose && fs.existsSync(compose)) {
   // Only this uniquely named disposable CI project; never the host installation.
   try {dockerCompose(['rm','-s','-f']);}catch{}
   try {run('docker',['volume','rm',project+'_data']);}catch{}
   try {run('docker',['volume','rm',project+'_recovery_data']);}catch{}
  }
  try {run('docker',['rm','-f',registry]);}catch{}
  fs.rmSync(temporary,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
