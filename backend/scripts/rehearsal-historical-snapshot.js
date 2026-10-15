// Build infrastructure for immutable BASE d9a7a378 only. Never edits its context.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
// Observed in diagnostic run 38773651868: BASE backend passed with this base.
const LEGACY_NODE='node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293';
// Exact build toolchain already pinned by immutable BOOTSTRAP 821efb26.
// BASE has no locks; frontend's npm 10.8.2 crashes in npm install (null.edgesOut).
// Only its build stage uses the known Node 24/npm toolchain; no package edits.
const FRONTEND_BUILDER='node:24.21.0-alpine@sha256:4b2d7eef36889f0aec0d58d1b19778321176c67824b7c951352d86c5c7811d44';
// Exact nginx:alpine resolved by the same diagnostic run; static runtime unchanged.
const LEGACY_NGINX='nginx:alpine@sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d';
function prepareHistoricalBuildFiles(temporary){
 const root=fs.realpathSync(temporary),prefix=path.resolve(os.tmpdir())+path.sep+'fp-docker-rehearsal-';
 assert(root.startsWith(prefix),'historical build fixtures must be inside the disposable rehearsal directory');
 const output=path.join(root,'build-fixtures');
 assert(!fs.existsSync(output),'fixture directory must be newly created');
 const originals={};
 for(const service of ['backend','frontend']){
  const source=fs.realpathSync(path.join(root,'old',service,'Dockerfile'));
  assert(source.startsWith(path.join(root,'old')+path.sep),'historical context escaped rehearsal');
  originals[service]={source,bytes:fs.readFileSync(source)};
 }
 const backend=originals.backend.bytes.toString('utf8'),frontend=originals.frontend.bytes.toString('utf8');
 assert.equal((backend.match(/^FROM node:20-alpine\r?$/gm)||[]).length,1,'unexpected BASE backend Dockerfile');
 assert.equal((frontend.match(/^FROM node:20-alpine AS build\r?$/gm)||[]).length,1,'unexpected BASE frontend builder');
 assert.equal((frontend.match(/^FROM nginx:alpine\r?$/gm)||[]).length,1,'unexpected BASE frontend runtime');
 assert.equal((backend.match(/^RUN npm install\r?$/gm)||[]).length,1,'unexpected BASE backend installer');
 assert.equal((frontend.match(/^RUN if \[ -f package-lock.json \]; then npm ci; else npm install; fi\r?$/gm)||[]).length,1,'unexpected BASE frontend installer');
 const locks={};
 for(const service of ['backend','frontend']){
  locks[service]=path.join(__dirname,'fixtures','release-rehearsal','base-'+service);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'old',service,'package.json'),'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(locks[service],'package.json'),'utf8')),manifest,'fixture must retain the historical manifest');
  const lock=JSON.parse(fs.readFileSync(path.join(locks[service],'package-lock.json'),'utf8'));
  assert.equal(lock.lockfileVersion,3);assert.deepEqual(lock.packages[''].dependencies,manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies,manifest.devDependencies);
  for(const [name,pkg]of Object.entries(lock.packages))if(name){
   assert(/^https:\/\/registry.npmjs.org\//.test(pkg.resolved),'historical lock must use public integrity-checked packages');
   assert(/^sha512-/.test(pkg.integrity),'historical package integrity required');
  }
 }
 const install='COPY --from=rehearsal-locks package-lock.json ./package-lock.json\nRUN npm ci';
 const generated={
  backend:backend.replace(/^FROM node:20-alpine\r?$/m,'FROM '+LEGACY_NODE).replace(/^RUN npm install\r?$/m,install),
  frontend:frontend.replace(/^FROM node:20-alpine AS build\r?$/m,'FROM '+FRONTEND_BUILDER+' AS build').replace(/^FROM nginx:alpine\r?$/m,'FROM '+LEGACY_NGINX).replace(/^RUN if \[ -f package-lock.json \]; then npm ci; else npm install; fi\r?$/m,install)
 };
 fs.mkdirSync(output,{mode:0o700});
 const result={};
 for(const service of ['backend','frontend']){
  result[service]=path.join(output,'base-'+service+'.Dockerfile');
  fs.writeFileSync(result[service],generated[service],{flag:'wx',mode:0o600});
  assert(fs.readFileSync(originals[service].source).equals(originals[service].bytes),'historical Dockerfile was modified');
  result[service+'Locks']=locks[service];
 }
 return result;
}
module.exports={prepareHistoricalBuildFiles,LEGACY_NODE,FRONTEND_BUILDER,LEGACY_NGINX};
