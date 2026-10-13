// Execute the real deploy module with in-memory authority and a fake child process.
// No root/filesystem/Docker effects; assert the actual forward AND rollback argv.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../scripts/deploy-approved-release.js'),'utf8');
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
const revision='a'.repeat(40),origin='https://audit.example.invalid';
const manifest={repository:'trinityrrocha/fullpassword',revision,origin,
 backend:'ghcr.io/trinityrrocha/fullpassword-backend@sha256:'+'b'.repeat(64),
 frontend:'ghcr.io/trinityrrocha/fullpassword-frontend@sha256:'+'c'.repeat(64)};
const bytes=Buffer.from(JSON.stringify(manifest)),recovery=Buffer.from('SYNTHETIC_RECOVERY');
const policy={environment:'test',origin,approvedRevision:revision,publicKeyFile:'/authority/public.pem',composeFile:'/authority/compose.json',
 recoveryArchive:'/authority/recovery',recoverySha256:crypto.createHash('sha256').update(recovery).digest('hex'),restoreVerified:true,migrateSchema:true};
const shared={db:{}};
const resolved={services:{db:{environment:{POSTGRES_USER:'owner',POSTGRES_PASSWORD:'SYNTHETIC_OWNER',POSTGRES_DB:'test'},networks:shared},
 frontend:{image:manifest.frontend},backend:{image:manifest.backend,environment:{APP_ORIGIN:origin,DB_HOST:'db',DB_PORT:'5432',DB_NAME:'test',DB_USER:'runtime',DB_PASSWORD:'SYNTHETIC_RUNTIME',DB_SCHEMA_MODE:'verify'},
 read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],tmpfs:['/tmp'],networks:shared,
 volumes:[{type:'bind',source:'/var/lib/fullpassword-release-public',target:'/var/lib/fullpassword-release-public',read_only:true},
 {type:'bind',source:'/var/lib/fullpassword-release-queue',target:'/var/lib/fullpassword-release-queue',read_only:false}]},
 'schema-migrate':{image:manifest.backend,profiles:['operator'],restart:'no',command:['node','scripts/migrate-schema.js'],networks:shared,
 environment:{DB_HOST:'db',DB_PORT:'5432',DB_NAME:'test',DB_USER:'owner',DB_PASSWORD:'SYNTHETIC_OWNER'}}}};
function exercise(failRevision,script=source){
 const files=new Map([['/etc/fullpassword/release-policy.json',Buffer.from(JSON.stringify(policy))],['/authority/manifest',bytes],
 ['/authority/signature',crypto.sign('sha256',bytes,keys.privateKey)],['/authority/public.pem',keys.publicKey.export({type:'spki',format:'pem'})],
 ['/authority/recovery',recovery],['/authority/compose.json',Buffer.from(JSON.stringify(resolved))]]);
 const calls=[];const previous={backend:'sha256:'+'e'.repeat(64),frontend:'sha256:'+'f'.repeat(64)};
 let installed={...previous},rolledBack=false;
 const fakeFs={lstatSync:()=>({uid:0,mode:0o700,isFile:()=>true,isSymbolicLink:()=>false}),readFileSync:file=>{assert(files.has(file));return files.get(file);},
 mkdirSync:()=>{},openSync:()=>10,closeSync:()=>{},unlinkSync:file=>files.delete(file),
 writeFileSync:(file,data)=>files.set(file,Buffer.from(data))};
 const fakeSpawn=(command,args)=>{
  assert.equal(command,'docker');calls.push([...args]);let out='';
  if(args.includes('config'))out=JSON.stringify(resolved);
  else if(args.includes('up')){
   const rollback=args.includes('never');rolledBack=rollback;
   installed=rollback?{...previous}:{backend:'sha256:'+'b'.repeat(64),frontend:'sha256:'+'c'.repeat(64)};
  } else if(args.includes('exec'))out=args.includes('backend')?JSON.stringify({commit:revision,schema_ready:true}):JSON.stringify({revision:failRevision&&!rolledBack?'d'.repeat(40):revision});
  else if(args.includes('ps'))out=args.at(-1);
  else if(args[0]==='inspect')out=installed[args.at(-1)];
  else if(args[0]==='image'&&args[1]==='inspect')out=args.includes('{{.Id}}')?'sha256:'+args.at(-1).split('@sha256:')[1]:JSON.stringify([args.at(-1)]);
  return {status:0,stdout:out};
 };
 const sandbox={module:{exports:{}},require:name=>name==='node:fs'?fakeFs:name==='node:child_process'?{spawnSync:fakeSpawn}:require(name),
 process:{platform:'linux',getuid:()=>0},Buffer,console:{log:()=>{}}};
 vm.runInNewContext(script,sandbox,{filename:'real-deploy-under-test.js'});
 if(failRevision)assert.throws(()=>sandbox.module.exports.deploy('/authority/manifest','/authority/signature'),/DEPLOY_REVISION_MISMATCH/);
 else sandbox.module.exports.deploy('/authority/manifest','/authority/signature');
 const ups=calls.filter(args=>args.includes('up'));
 assert.equal(ups.length,failRevision?2:1);
 for(const args of ups){
  assert(args.includes('--no-deps'),'deployment must not recreate database dependency: missing --no-deps');
  assert(args.includes('--no-build')&&args.includes('--wait')&&args.includes('--wait-timeout'));
  assert.deepEqual(args.slice(-2),['backend','frontend']);
 }
 if(failRevision){assert(ups[1].includes('--pull')&&ups[1].includes('never'));assert.deepEqual(installed,previous);}
 const stop=calls.findIndex(args=>args.includes('stop'));
 const migrate=calls.findIndex(args=>args.includes('run'));
 const forward=calls.findIndex(args=>args.includes('up'));
 assert(stop>=0&&stop<migrate&&migrate<forward,'writer stop -> isolated migration -> app reconciliation order');
 assert.deepEqual(calls[migrate].slice(-3),['schema-migrate','node','scripts/migrate-schema.js']);
 assert(calls[migrate].includes('--no-deps'));assert.equal(calls.filter(args=>args.includes('run')).length,1,'no automatic migration retry');
}
exercise(false);exercise(true);
// Mutation checks prove either path losing the dependency flag is detected independently.
const unprotectedForward=source.replace("'up','-d','--no-deps','--no-build','--wait'","'up','-d','--no-build','--wait'");
const unprotectedRollback=source.replace("'up','-d','--no-deps','--no-build','--pull'","'up','-d','--no-build','--pull'");
assert.notEqual(unprotectedForward,source);assert.notEqual(unprotectedRollback,source);
assert.throws(()=>exercise(false,unprotectedForward),/missing --no-deps/);
assert.throws(()=>exercise(true,unprotectedRollback),/missing --no-deps/);
console.log('PASS deployment must not recreate database dependency: real forward/rollback argv use --no-deps, only backend/frontend; separate migration once; wait/digest/revision checks preserved.');
