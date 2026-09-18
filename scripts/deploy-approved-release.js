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
 for(const service of ['backend','frontend']) {
  if(!new RegExp('^ghcr\\.io/trinityrrocha/fullpassword-'+service+'@sha256:[a-f0-9]{64}$').test(manifest[service])) throw new Error('UNPINNED_RELEASE_IMAGE');
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
 if(stat.isSymbolicLink() || stat.uid!==0 || (stat.mode&0o022)) throw new Error('UNTRUSTED_OPERATOR_FILE');
 return fs.readFileSync(file);
};
const run=(command,args)=>{const result=spawnSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true});if(result.status!==0)throw new Error('DEPLOY_COMMAND_FAILED: '+command);return result.stdout.trim();};
const deploy=(manifestPath,signaturePath)=>{
 if(process.platform==='win32' || process.getuid?.()!==0) throw new Error('OPERATOR_ROOT_REQUIRED');
 const policy=JSON.parse(protectedRead('/etc/fullpassword/release-policy.json'));
 const manifest=validateManifest(fs.readFileSync(manifestPath),fs.readFileSync(signaturePath),protectedRead(policy.publicKeyFile),policy);
 protectedRead(policy.composeFile);
 // Recovery approval is external to this application. Check the exact protected archive, not merely existence.
 const recovery=protectedRead(policy.recoveryArchive);
 if(crypto.createHash('sha256').update(recovery).digest('hex')!==policy.recoverySha256 || policy.restoreVerified!==true) throw new Error('VERIFIED_RECOVERY_REQUIRED');
 const state='/var/lib/fullpassword-release';
 fs.mkdirSync(state,{recursive:true,mode:0o700});
 const stateStat=fs.lstatSync(state);
 if(stateStat.isSymbolicLink() || stateStat.uid!==0 || (stateStat.mode&0o077)) throw new Error('UNTRUSTED_RELEASE_STATE');
 const compose=['compose','--project-directory',path.dirname(policy.composeFile),'-f',policy.composeFile];
 const resolved=JSON.parse(run('docker',[...compose,'config','--format','json']));
 if(resolved.services?.backend?.environment?.APP_ORIGIN!==policy.origin) throw new Error('INSTALLED_ORIGIN_MISMATCH');
 const previous={services:{}};
 for(const service of ['backend','frontend']){
  const id=run('docker',[...compose,'ps','-q',service]);
  if(!id) throw new Error('CURRENT_SERVICE_UNIDENTIFIED');
  previous.services[service]={image:run('docker',['inspect','--format','{{.Image}}',id])};
 }
 const rollback=path.join(state,'rollback-'+Date.now()+'.json');
 fs.writeFileSync(rollback,JSON.stringify(previous),{mode:0o600,flag:'wx'});
 const override=path.join(state,'release-'+manifest.revision+'.json');
 fs.writeFileSync(override,JSON.stringify({services:{backend:{image:manifest.backend},frontend:{image:manifest.frontend}}}),{mode:0o600});
 try {
  run('docker',[...compose,'-f',override,'pull','backend','frontend']);
  run('docker',[...compose,'-f',override,'up','-d','--no-build','--wait','--wait-timeout','180','backend','frontend']);
  const health=JSON.parse(run('docker',[...compose,'exec','-T','backend','node','-e',"fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"]));
  if(health.commit!==manifest.revision || !health.schema_ready) throw new Error('DEPLOY_REVISION_MISMATCH');
  fs.writeFileSync(path.join(state,'installed.json'),JSON.stringify({revision:manifest.revision,backend:manifest.backend,frontend:manifest.frontend,rollback}),{mode:0o600});
 } catch(error) {
  run('docker',[...compose,'-f',rollback,'up','-d','--no-build','--wait','--wait-timeout','180','backend','frontend']);
  throw error;
 }
 console.log('Verified test release installed: '+manifest.revision);
};
if(require.main===module){
 try{if(process.argv.length!==4)throw new Error('Usage: node deploy-approved-release.js manifest.json manifest.sig');deploy(process.argv[2],process.argv[3]);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={validateManifest};
