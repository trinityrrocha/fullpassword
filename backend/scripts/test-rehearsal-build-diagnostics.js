const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {historicalBuild}=require('./rehearsal-historical-build');
const revision='d9a7a3786143379df43ff1910263894df33449bf';
const args=['build','--build-arg','BACKEND_APP_COMMIT='+revision,'-t','synthetic-image','synthetic-context'];
for(const step of ['historical-base-backend','historical-base-frontend','bootstrap-backend','bootstrap-frontend']){
 const logs=[];let called=false;
 historicalBuild({step,revision,args},{cwd:'synthetic-root',log:line=>logs.push(line),spawn:(command,actual,options)=>{
  called=true;assert.equal(command,'docker');assert.deepEqual(actual,['build','--progress=plain',...args.slice(1)]);assert.equal(options.cwd,'synthetic-root');return{status:0,stdout:'not dumped',stderr:''};
 }});
 assert(called);assert(logs[0].includes(step));assert(!logs.join('\n').includes('not dumped'));
}
const logs=[],secrets=['SYNTHETIC_DB_PASSWORD','SYNTHETIC_JWT_SECRET','SYNTHETIC_CONFIG_KEY','SYNTHETIC_TOKEN','SYNTHETIC_COOKIE','SYNTHETIC_RECOVERY','SYNTHETIC_PRIVATE_KEY','SYNTHETIC_URL_PASSWORD'];
const stderr=['#1 FROM node:20-alpine','#9 RUN npm run build','npm ERR! package build failed',
 'DB_PASSWORD='+secrets[0],'JWT_SECRET='+secrets[1],'CONFIG_ENCRYPTION_KEY='+secrets[2],
 'Authorization: Bearer '+secrets[3],'Cookie: fp_session='+secrets[4],'recovery_code: '+secrets[5],
 '-----BEGIN PRIVATE KEY-----\n'+secrets[6]+'\n-----END PRIVATE KEY-----',
 'https://synthetic:'+secrets[7]+'@registry.example.invalid/path'].join('\n');
assert.throws(()=>historicalBuild({step:'bootstrap-frontend',revision,args},{log:line=>logs.push(line),spawn:()=>({status:17,stdout:'build output',stderr})}),/REHEARSAL_COMMAND_FAILED: bootstrap-frontend exit=17/);
const output=logs.join('\n');for(const secret of secrets)assert(!output.includes(secret));
for(const expected of ['step: bootstrap-frontend','exit: 17','stdout:','stderr:','node:20-alpine','RUN npm run build','package build failed'])assert(output.includes(expected));
assert(!output.includes('BACKEND_APP_COMMIT='),'no argv dump');
const timeout=[];assert.throws(()=>historicalBuild({step:'historical-base-backend',revision,args},{log:line=>timeout.push(line),spawn:()=>({status:null,signal:'SIGTERM',error:{code:'ETIMEDOUT'},stderr:'x'.repeat(50000)})}),/exit=none/);
assert(timeout.join('\n').includes('spawn_error: ETIMEDOUT'));assert(timeout.join('\n').length<17000);
assert.throws(()=>historicalBuild({step:'runtime-with-credentials',revision,args}),/INVALID_HISTORICAL_BUILD_STEP/);
const harness=fs.readFileSync(path.join(__dirname,'test-release-upgrade-docker.js'),'utf8');
assert.equal((harness.match(/historicalBuild\(/g)||[]).length,3);
assert(harness.includes("run('docker',['run'"),'runtime commands keep original non-dumping helper');
console.log('PASS historical-build diagnostics: four phases, plain progress, bounded useful output, secret redaction, timeout/exit propagation, no runtime argv logging.');
