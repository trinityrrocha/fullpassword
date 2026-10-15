const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {prepareHistoricalBuildFiles,LEGACY_NODE,FRONTEND_BUILDER,LEGACY_NGINX}=require('./rehearsal-historical-snapshot');
const repo=path.resolve(__dirname,'../..'),revision='d9a7a3786143379df43ff1910263894df33449bf';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fp-docker-rehearsal-'));
const files=new Map();
try{
 for(const service of ['backend','frontend']){
  fs.mkdirSync(path.join(temp,'old',service),{recursive:true});
  for(const name of ['Dockerfile','package.json']){
   const value=execFileSync('git',['show',revision+':'+service+'/'+name],{cwd:repo,maxBuffer:4*1024*1024});
   const file=path.join(temp,'old',service,name);fs.writeFileSync(file,value);files.set(file,value);
  }
 }
 const built=prepareHistoricalBuildFiles(temp);
 for(const[file,value]of files)assert(fs.readFileSync(file).equals(value),'all source/lockfiles must remain unchanged');
 for(const service of ['backend','frontend']){
  const original=files.get(path.join(temp,'old',service,'Dockerfile')).toString('utf8');
  const actual=fs.readFileSync(built[service],'utf8');
  const install='COPY --from=rehearsal-locks package-lock.json ./package-lock.json\nRUN npm ci';
  const expected=service==='backend'?original.replace(/^FROM node:20-alpine\r?$/m,'FROM '+LEGACY_NODE).replace(/^RUN npm install\r?$/m,install):original.replace(/^FROM node:20-alpine AS build\r?$/m,'FROM '+FRONTEND_BUILDER+' AS build').replace(/^FROM nginx:alpine\r?$/m,'FROM '+LEGACY_NGINX).replace(/^RUN if \[ -f package-lock.json \]; then npm ci; else npm install; fi\r?$/m,install);
  assert.equal(actual,expected,'only base refs and frozen install infrastructure may change');
  assert(!built[service].startsWith(path.join(temp,'old')+path.sep),'generated Dockerfile must be outside archived build context');
  assert.equal((actual.match(/@sha256:[a-f0-9]{64}/g)||[]).length,service==='backend'?1:2);
 }
 assert.throws(()=>prepareHistoricalBuildFiles(temp),/newly created/);
 assert.throws(()=>prepareHistoricalBuildFiles(repo),/disposable rehearsal directory/);
 const harnessFile='backend/scripts/test-release-upgrade-docker.js';
 const baseline=execFileSync('git',['show','0322389607c974ce44ffbba1202a41330ba25d71:'+harnessFile],{cwd:repo,encoding:'utf8'}).replace(/\r\n/g,'\n');
 const current=fs.readFileSync(path.join(repo,harnessFile),'utf8').replace(/\r\n/g,'\n');
 const boundary='  for(const directory of [operator,publicDir,queue,state])';
 assert(baseline.includes(boundary)&&current.includes(boundary));
 assert.equal(current.slice(current.indexOf(boundary)),baseline.slice(baseline.indexOf(boundary)),'deployment, 60s stabilization, database continuity, replay, rollback and recovery assertions must remain unchanged');
 console.log('PASS historical snapshot fixture: immutable Git Dockerfiles/manifests, exact build-only substitutions, pinned digests and integrity-checked lock context, generated files outside source, fail-closed path/template guards.');
}finally{
 assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'fp-docker-rehearsal-'));
 fs.rmSync(temp,{recursive:true,force:true});
}
