// Operator-only release deployment. Never invoked from the API or an updater container.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const REPOSITORY='trinityrrocha/fullpassword';
const validateManifest=(bytes,signature,publicKey,policy)=>{
 if(!crypto.verify('sha256',bytes,publicKey,signature)) throw new Error('INVALID_RELEASE_SIGNATURE');
 const manifest=JSON.parse(bytes);
 if(manifest.repository!==REPOSITORY || !/^[a-f0-9]{40}$/.test(manifest.revision)) throw new Error('INVALID_RELEASE_ORIGIN');
 if(policy.approvedRevision!==manifest.revision) throw new Error('RELEASE_NOT_APPROVED');
 const registry=policy.registry==='loopback-test' && policy.origin==='https://audit.example.invalid'
  ? '127\\.0\\.0\\.1:5000' : 'ghcr\\.io';
 for(const service of ['backend','frontend']) {
  if(!new RegExp('^'+registry+'/trinityrrocha/fullpassword-'+service+'@sha256:[a-f0-9]{64}$').test(manifest[service])) throw new Error('UNPINNED_RELEASE_IMAGE');
 }
 if(policy.environment!=='test' || manifest.origin!==policy.origin || !/^https:\/\//.test(policy.origin)) throw new Error('TEST_ENVIRONMENT_REQUIRED');
 return manifest;
};
const protectedRead=file=>{
 if(!path.isAbsolute(file)) throw new Error('ABSOLUTE_OPERATOR_PATH_REQUIRED');
 for(let directory=path.dirname(file);;directory=path.dirname(directory)) {
  const parent=fs.lstatSync(directory);
  if(parent.isSymbolicLink() || parent.uid!==0 || (parent.mode&0o022)) throw new Error('UNTRUSTED_OPERATOR_DIRECTORY');
  if(directory===path.dirname(directory)) break;
 }
 const stat=fs.lstatSync(file);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==0 || (stat.mode&0o022)) throw new Error('UNTRUSTED_OPERATOR_FILE');
 return fs.readFileSync(file);
};
const run=(command,args,phase='metadata')=>{const result=spawnSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:600000,maxBuffer:4*1024*1024});if(result.status!==0)throw new Error('DEPLOY_COMMAND_FAILED: '+phase);return result.stdout.trim();};
const verifyInstalledRevision=(manifest,health,frontend)=>{
 if(health.commit!==manifest.revision || health.schema_ready!==true || frontend.revision!==manifest.revision) throw new Error('DEPLOY_REVISION_MISMATCH');
};
const verifyDeployment=(policy,manifest)=>{
 const compose=['compose','--project-directory',path.dirname(policy.composeFile),'-f',policy.composeFile];
 const health=JSON.parse(run('docker',[...compose,'exec','-T','backend','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"]));
 const frontend=JSON.parse(run('docker',[...compose,'exec','-T','frontend','cat','/usr/share/nginx/html/version.json']));
 verifyInstalledRevision(manifest,health,frontend);
 for(const service of ['backend','frontend']) {
  const id=run('docker',[...compose,'ps','-q',service]);
  const image=run('docker',['inspect','--format','{{.Image}}',id]);
  const expected=run('docker',['image','inspect','--format','{{.Id}}',manifest[service]]);
  const digests=JSON.parse(run('docker',['image','inspect','--format','{{json .RepoDigests}}',manifest[service]]));
  if(image!==expected || !digests?.includes(manifest[service])) throw new Error('DEPLOY_DIGEST_MISMATCH');
 }
};
const assertExpectedRelease=(policy,bytes,expected)=>{
 if(expected && (policy.approvalId!==expected.approvalId || policy.approvedRevision!==expected.revision ||
   crypto.createHash('sha256').update(bytes).digest('hex')!==expected.manifestHash)) throw new Error('APPROVAL_CHANGED_BEFORE_DEPLOY');
};
// Pure validation of the operator-resolved Compose; never logs credentials.
const validateReleaseCompose=(resolved,policy)=>{
 const services=resolved.services || {},backend=services.backend,owner=services.db?.environment || {};
 const runtime=backend?.environment || {},migration=services['schema-migrate'];
 if(runtime.APP_ORIGIN!==policy.origin) throw new Error('INSTALLED_ORIGIN_MISMATCH');
 if(runtime.DB_SCHEMA_MODE!=='verify') throw new Error('LEAST_PRIVILEGE_RUNTIME_REQUIRED');
 const ownerUser=owner.POSTGRES_USER || 'postgres';
 if(!runtime.DB_USER || !runtime.DB_PASSWORD || runtime.DB_USER===ownerUser ||
   !owner.POSTGRES_PASSWORD || runtime.DB_PASSWORD===owner.POSTGRES_PASSWORD) throw new Error('SEPARATE_RUNTIME_CREDENTIALS_REQUIRED');
 if(['DB_HOST','DB_PORT','DB_NAME'].some(key=>!runtime[key]) || runtime.DB_NAME!==(owner.POSTGRES_DB || ownerUser)) throw new Error('SHARED_DATABASE_CONFIG_REQUIRED');
 if(backend.read_only!==true || !backend.cap_drop?.includes('ALL') ||
   !backend.security_opt?.some(value=>/^no-new-privileges(?::true|=true)?$/.test(value)) ||
   !backend.tmpfs?.length) throw new Error('HARDENED_RUNTIME_REQUIRED');
 for(const service of ['backend','frontend','db','schema-migrate']) {
  for(const mount of services[service]?.volumes || []) {
   if(String(mount.source || '').includes('docker.sock') || String(mount.target || '').includes('docker.sock')) throw new Error('APPLICATION_DOCKER_SOCKET_FORBIDDEN');
  }
 }
 const publicMount=backend.volumes?.find(m=>m.target==='/var/lib/fullpassword-release-public');
 const queueMount=backend.volumes?.find(m=>m.target==='/var/lib/fullpassword-release-queue');
 if(publicMount?.type!=='bind' || publicMount.source!==publicMount.target || publicMount.read_only!==true ||
   queueMount?.type!=='bind' || queueMount.source!==queueMount.target || queueMount.read_only===true) throw new Error('RELEASE_AUTHORITY_MOUNTS_REQUIRED');
 if(policy.migrateSchema===true && !migration) throw new Error('SCHEMA_MIGRATION_SERVICE_REQUIRED');
 if(migration) {
  const ddl=migration.environment || {};
  if(JSON.stringify(migration.profiles)!==JSON.stringify(['operator']) || JSON.stringify(migration.command)!==JSON.stringify(['node','scripts/migrate-schema.js']) ||
    !['no',undefined].includes(migration.restart) || migration.ports?.length || migration.build) throw new Error('OPERATOR_MIGRATION_SERVICE_REQUIRED');
  if(!backend.image || migration.image!==backend.image || !/@sha256:[a-f0-9]{64}$/.test(backend.image)) throw new Error('SHARED_PINNED_BACKEND_IMAGE_REQUIRED');
  if(ddl.DB_USER!==ownerUser || ddl.DB_USER===runtime.DB_USER || !ddl.DB_PASSWORD ||
    ddl.DB_PASSWORD!==owner.POSTGRES_PASSWORD || ddl.DB_PASSWORD===runtime.DB_PASSWORD ||
    ['DB_HOST','DB_PORT','DB_NAME'].some(key=>String(ddl[key] || '')!==String(runtime[key] || ''))) throw new Error('SCHEMA_OWNER_CREDENTIALS_REQUIRED');
  const networks=service=>Object.keys(service?.networks || {});
  if(!networks(backend).some(name=>networks(migration).includes(name) && networks(services.db).includes(name))) throw new Error('SHARED_DATABASE_NETWORK_REQUIRED');
  if(migration.volumes?.some(m=>String(m.target || '').startsWith('/var/lib/fullpassword-release-'))) throw new Error('MIGRATION_AUTHORITY_MOUNT_FORBIDDEN');
 }
 return resolved;
};
const deploy=(manifestPath,signaturePath,expectedRelease)=>{
 if(process.platform==='win32' || process.getuid?.()!==0) throw new Error('OPERATOR_ROOT_REQUIRED');
 const policy=JSON.parse(protectedRead('/etc/fullpassword/release-policy.json'));
 const bytes=protectedRead(manifestPath);
 assertExpectedRelease(policy,bytes,expectedRelease);
 const manifest=validateManifest(bytes,protectedRead(signaturePath),protectedRead(policy.publicKeyFile),policy);
 protectedRead(policy.composeFile);
 // Recovery approval is external to this application. Check the exact protected archive, not merely existence.
 const recovery=protectedRead(policy.recoveryArchive);
 if(crypto.createHash('sha256').update(recovery).digest('hex')!==policy.recoverySha256 || policy.restoreVerified!==true) throw new Error('VERIFIED_RECOVERY_REQUIRED');
 const state='/var/lib/fullpassword-release';
 fs.mkdirSync(state,{recursive:true,mode:0o700});
 const stateStat=fs.lstatSync(state);
 if(stateStat.isSymbolicLink() || stateStat.uid!==0 || (stateStat.mode&0o077)) throw new Error('UNTRUSTED_RELEASE_STATE');
 const lock=path.join(state,'deployment.lock');
 const lockFd=fs.openSync(lock,'wx',0o600); // Stale locks require operator investigation, never automatic replay.
 try {
 const compose=['compose','--project-directory',path.dirname(policy.composeFile),'-f',policy.composeFile];
 const resolved=JSON.parse(run('docker',[...compose,'--profile','operator','config','--format','json'],'compose_config'));
 validateReleaseCompose(resolved,policy);
 const previous={services:{},'x-verified-image-ids':{}};
 for(const service of ['backend','frontend']){
  const id=run('docker',[...compose,'ps','--all','-q',service]);
  if(!id) throw new Error('CURRENT_SERVICE_UNIDENTIFIED');
  const imageId=run('docker',['inspect','--format','{{.Image}}',id]);
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('INVALID_PREVIOUS_IMAGE_ID');
  const rollbackTag='fullpassword-rollback-'+service+':'+imageId.slice(7);
  run('docker',['image','tag',imageId,rollbackTag],'capture_rollback_image');
  previous.services[service]={image:rollbackTag};
  previous['x-verified-image-ids'][service]=imageId;
 }
 const rollback=path.join(state,'rollback-'+Date.now()+'.json');
 fs.writeFileSync(rollback,JSON.stringify(previous),{mode:0o600,flag:'wx'});
 const override=path.join(state,'release-'+manifest.revision+'.json');
 fs.writeFileSync(override,JSON.stringify({services:{backend:{image:manifest.backend},frontend:{image:manifest.frontend}}}),{mode:0o600});
 try {
  run('docker',[...compose,'-f',override,'pull','backend','frontend'],'pull_images');
  if(policy.migrateSchema===true) {
   // A short-lived operator service holds DDL credentials; they never enter the runtime backend.
   fs.writeFileSync(override,JSON.stringify({services:{backend:{image:manifest.backend},frontend:{image:manifest.frontend},'schema-migrate':{image:manifest.backend}}}),{mode:0o600});
   run('docker',[...compose,'stop','backend'],'stop_writers');
   run('docker',[...compose,'-f',override,'run','--rm','--no-deps','schema-migrate','node','scripts/migrate-schema.js'],'schema_migrate');
  }
  run('docker',[...compose,'-f',override,'up','-d','--no-deps','--no-build','--wait','--wait-timeout','180','backend','frontend'],'start_services');
  verifyDeployment(policy,manifest);
  fs.writeFileSync(path.join(state,'installed.json'),JSON.stringify({revision:manifest.revision,backend:manifest.backend,frontend:manifest.frontend,rollback}),{mode:0o600});
 } catch(error) {
  try {
   run('docker',[...compose,'-f',rollback,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','180','backend','frontend'],'image_rollback');
   for(const service of ['backend','frontend']) {
    const id=run('docker',[...compose,'ps','-q',service]);
    if(run('docker',['inspect','--format','{{.Image}}',id])!==previous['x-verified-image-ids'][service]) throw new Error('ROLLBACK_IMAGE_MISMATCH');
   }
  }
  catch {throw new Error(error.message+'; IMAGE_ROLLBACK_FAILED');}
  throw error;
 }
 console.log('Verified test release installed: '+manifest.revision);
 } finally {fs.closeSync(lockFd);fs.unlinkSync(lock);}
};
if(require.main===module){
 try{if(process.argv.length!==4)throw new Error('Usage: node deploy-approved-release.js manifest.json manifest.sig');deploy(process.argv[2],process.argv[3]);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={validateManifest,verifyInstalledRevision,protectedRead,deploy,verifyDeployment,assertExpectedRelease,validateReleaseCompose};
