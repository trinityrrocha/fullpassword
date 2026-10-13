// Synthetic contract tests; --docker resolves the real versioned Compose without starting services.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {validateReleaseCompose}=require('../../scripts/deploy-approved-release');
const root=path.resolve(__dirname,'../..');
const image='ghcr.io/trinityrrocha/fullpassword-backend@sha256:'+'b'.repeat(64);
const origin='https://audit.example.invalid';
const owner={POSTGRES_USER:'owner_test',POSTGRES_PASSWORD:'SYNTHETIC_OWNER_PASSWORD',POSTGRES_DB:'database_test'};
const runtime={DB_USER:'fullpassword_runtime',DB_PASSWORD:'SYNTHETIC_RUNTIME_PASSWORD',DB_SCHEMA_MODE:'verify',DB_HOST:'db',DB_PORT:'5432',DB_NAME:'database_test',APP_ORIGIN:origin};
const hardening={read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],tmpfs:['/tmp:rw,noexec,nosuid,size=512m']};
const networks={fullpassword_network:{}};
const mounts=[{type:'bind',source:'/var/lib/fullpassword-release-public',target:'/var/lib/fullpassword-release-public',read_only:true},
 {type:'bind',source:'/var/lib/fullpassword-release-queue',target:'/var/lib/fullpassword-release-queue',read_only:false}];
const fixture={services:{db:{environment:owner,networks},frontend:{},backend:{image,environment:runtime,...hardening,volumes:mounts,networks},
 'schema-migrate':{image,profiles:['operator'],restart:'no',command:['node','scripts/migrate-schema.js'],environment:{...runtime,DB_USER:owner.POSTGRES_USER,DB_PASSWORD:owner.POSTGRES_PASSWORD},networks}}};
const policy={origin,migrateSchema:true};
validateReleaseCompose(fixture,policy);
const negative=(mutate,code)=>{const value=structuredClone(fixture);mutate(value.services);assert.throws(()=>validateReleaseCompose(value,policy),new RegExp(code));};
negative(s=>delete s['schema-migrate'],'SCHEMA_MIGRATION_SERVICE_REQUIRED');
for(const mode of ['migrate',undefined])negative(s=>s.backend.environment.DB_SCHEMA_MODE=mode,'LEAST_PRIVILEGE_RUNTIME_REQUIRED');
negative(s=>s.backend.environment.DB_USER=owner.POSTGRES_USER,'SEPARATE_RUNTIME_CREDENTIALS_REQUIRED');
negative(s=>s.backend.environment.DB_PASSWORD=owner.POSTGRES_PASSWORD,'SEPARATE_RUNTIME_CREDENTIALS_REQUIRED');
negative(s=>delete s.backend.environment.DB_NAME,'SHARED_DATABASE_CONFIG_REQUIRED');
negative(s=>s.backend.environment.DB_NAME='other-db','SHARED_DATABASE_CONFIG_REQUIRED');
for(const [field,value] of [['read_only',false],['cap_drop',[]],['security_opt',[]],['tmpfs',[]]])negative(s=>s.backend[field]=value,'HARDENED_RUNTIME_REQUIRED');
for(const service of ['backend','frontend','db','schema-migrate'])negative(s=>(s[service].volumes ||= []).push({source:'/var/run/docker.sock',target:'/var/run/docker.sock'}),'APPLICATION_DOCKER_SOCKET_FORBIDDEN');
negative(s=>s.backend.volumes[0].read_only=false,'RELEASE_AUTHORITY_MOUNTS_REQUIRED');
negative(s=>s.backend.volumes[1].read_only=true,'RELEASE_AUTHORITY_MOUNTS_REQUIRED');
negative(s=>s['schema-migrate'].profiles=[],'OPERATOR_MIGRATION_SERVICE_REQUIRED');
negative(s=>s['schema-migrate'].profiles=['operator','default'],'OPERATOR_MIGRATION_SERVICE_REQUIRED');
negative(s=>s['schema-migrate'].command=['node','src/server.js'],'OPERATOR_MIGRATION_SERVICE_REQUIRED');
negative(s=>s['schema-migrate'].restart='always','OPERATOR_MIGRATION_SERVICE_REQUIRED');
negative(s=>s['schema-migrate'].ports=['3000:3000'],'OPERATOR_MIGRATION_SERVICE_REQUIRED');
negative(s=>s['schema-migrate'].build={context:'./backend'},'OPERATOR_MIGRATION_SERVICE_REQUIRED');
negative(s=>s['schema-migrate'].image=image.replace('b'.repeat(64),'c'.repeat(64)),'SHARED_PINNED_BACKEND_IMAGE_REQUIRED');
negative(s=>s.backend.image=s['schema-migrate'].image='backend:latest','SHARED_PINNED_BACKEND_IMAGE_REQUIRED');
negative(s=>s['schema-migrate'].environment.DB_USER=runtime.DB_USER,'SCHEMA_OWNER_CREDENTIALS_REQUIRED');
negative(s=>s['schema-migrate'].environment.DB_PASSWORD=runtime.DB_PASSWORD,'SCHEMA_OWNER_CREDENTIALS_REQUIRED');
negative(s=>s['schema-migrate'].environment.DB_HOST='other-db','SCHEMA_OWNER_CREDENTIALS_REQUIRED');
negative(s=>s['schema-migrate'].networks={other:{}},'SHARED_DATABASE_NETWORK_REQUIRED');
negative(s=>s['schema-migrate'].volumes=mounts,'MIGRATION_AUTHORITY_MOUNT_FORBIDDEN');
console.log('PASS release Compose validator: runtime/owner separation, verify, migration, hardening, mounts, network and socket negatives.');

if(process.argv.includes('--docker')) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fp-compose-contract-'));
 try {
  const envFile=path.join(directory,'empty.env');fs.writeFileSync(envFile,'');
  const env={...process.env,DB_USER:owner.POSTGRES_USER,DB_PASSWORD:owner.POSTGRES_PASSWORD,DB_NAME:runtime.DB_NAME,
   RUNTIME_DB_USER:runtime.DB_USER,RUNTIME_DB_PASSWORD:runtime.DB_PASSWORD,DB_SCHEMA_MODE:'migrate',
   RELEASE_BACKEND_IMAGE:image,RELEASE_FRONTEND_IMAGE:'ghcr.io/trinityrrocha/fullpassword-frontend@sha256:'+'c'.repeat(64),
   JWT_SECRET:'SYNTHETIC_JWT_'.repeat(8),ADMIN_BOOTSTRAP_TOKEN:'SYNTHETIC_BOOTSTRAP_'.repeat(5),
   SUPER_ADMIN_EMAIL:'audit@example.invalid',APP_ORIGIN:origin};
  for(const key of Object.keys(env))if(key.startsWith('COMPOSE_'))delete env[key];
  const config=(overlay,extra={})=>spawnSync('docker',['compose','--project-directory',root,'--env-file',envFile,'-p','fp-contract-test',
    '-f',path.join(root,'docker-compose.yml'),...(overlay?['-f',path.join(root,'docker-compose.release-agent.yml')]:[]),
    '--profile','operator','config','--format','json'],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:30000});
  const conventional=config(false);assert.equal(conventional.status,0,'Conventional Compose resolution failed');
  const base=JSON.parse(conventional.stdout);
  assert.equal(base.services.backend.environment.DB_USER,owner.POSTGRES_USER);
  assert.equal(base.services.backend.environment.DB_SCHEMA_MODE,'migrate');
  const result=config(true);assert.equal(result.status,0,'Release Compose resolution failed');
  const resolved=JSON.parse(result.stdout);validateReleaseCompose(resolved,policy);
  assert.equal(resolved.services.backend.image,resolved.services['schema-migrate'].image);
  assert.equal(resolved.services.db.environment.POSTGRES_USER,owner.POSTGRES_USER);
  assert.equal(resolved.services.backend.environment.DB_PASSWORD,runtime.DB_PASSWORD);
  assert.equal(resolved.services['schema-migrate'].environment.DB_PASSWORD,owner.POSTGRES_PASSWORD);
  assert.equal(resolved.services['schema-migrate'].volumes,undefined);
  assert.equal(resolved.services['schema-migrate'].ports,undefined);
  assert.equal(resolved.volumes.pgdata.name,base.volumes.pgdata.name);
  for(const missing of ['RUNTIME_DB_PASSWORD','RELEASE_BACKEND_IMAGE','RELEASE_FRONTEND_IMAGE'])assert.notEqual(config(true,{[missing]:''}).status,0,'Missing release variable must fail closed');
  console.log('PASS actual Docker Compose: conventional install preserved; release overlay resolves least privilege, same image, owner DB and operator service; missing variables rejected.');
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
} else console.log('Actual Compose resolution not run here; CI must invoke --docker.');
