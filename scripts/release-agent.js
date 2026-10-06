// Runs on the host, never in the backend. All authority comes from root-owned files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { protectedRead, validateManifest, deploy, verifyDeployment } = require('./deploy-approved-release');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const syncDirectory = directory => {
  if(process.platform==='win32') return; // test-only; the agent CLI requires Linux
  const fd=fs.openSync(directory,'r');
  try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
};
const atomic = (file, value, mode = 0o600) => {
  const temporary = file + '.' + crypto.randomUUID();
  const fd = fs.openSync(temporary, 'wx', mode);
  try { fs.fchmodSync(fd,mode); fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  syncDirectory(path.dirname(file));
};
const readRequest = file => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 || stat.nlink !== 1) throw new Error('INVALID_REQUEST_FILE');
    const request = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (Object.keys(request).sort().join(',') !== 'approvalId,manifestHash,requestId,revision' ||
      !UUID.test(request.approvalId) || !UUID.test(request.requestId) ||
      !/^[a-f0-9]{40}$/.test(request.revision) || !/^[a-f0-9]{64}$/.test(request.manifestHash)) throw new Error('INVALID_REQUEST');
    return request;
  } finally { fs.closeSync(fd); }
};
const approval = (policy, read = protectedRead, now = Date.now()) => {
  if (!UUID.test(policy.approvalId)) throw new Error('INVALID_APPROVAL');
  const expiry = Date.parse(policy.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 7 * 86400000) throw new Error('APPROVAL_EXPIRED');
  const bytes = read(policy.manifestFile);
  const manifest = validateManifest(bytes, read(policy.signatureFile), read(policy.publicKeyFile), policy);
  return { approvalId: policy.approvalId, revision: manifest.revision, manifestHash: sha(bytes),
    backend: manifest.backend, frontend: manifest.frontend, origin: manifest.origin, expiresAt: policy.expiresAt };
};
// Injectable dependencies are for isolated tests. The CLI has no injection/configuration from the queue.
const processRequest = async ({ policy, request, state, status, read = protectedRead,
  performDeploy = deploy, verify = verifyDeployment, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
  const release = approval(policy, read);
  if (request.approvalId !== release.approvalId || request.revision !== release.revision || request.manifestHash !== release.manifestHash) throw new Error('REQUEST_NOT_APPROVED');
  const consumed = path.join(state, release.approvalId + '.consumed');
  const fd = fs.openSync(consumed, 'wx', 0o600); // consume BEFORE effects; replay never resumes deployment
  try { fs.writeFileSync(fd, JSON.stringify(request)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(state);
  const base = { ...request, backend: release.backend, frontend: release.frontend, startedAt: new Date().toISOString() };
  const publish = phase => atomic(path.join(status, 'status.json'), { ...base, ...phase }, 0o644);
  try {
    publish({ state: 'deploying' });
    performDeploy(policy.manifestFile, policy.signatureFile, release);
    publish({ state: 'stabilizing', healthyAt: new Date().toISOString() });
    await wait(60000); // no cosmetic countdown: recheck the real installation after the minimum window
    verify(policy, release);
    publish({ state: 'completed', finishedAt: new Date().toISOString() });
  } catch {
    publish({ state: 'recovery_required', errorCode: 'DEPLOYMENT_FAILED', finishedAt: new Date().toISOString() });
    throw new Error('DEPLOYMENT_FAILED');
  }
};
const main = async () => {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('OPERATOR_ROOT_REQUIRED');
  const policy = JSON.parse(protectedRead('/etc/fullpassword/release-policy.json'));
  for (const directory of [policy.stateDirectory, policy.publicDirectory]) {
    protectedRead(path.join(directory, '.operator-owned'));
  }
  const queueStat = fs.lstatSync(policy.queueDirectory);
  if (!queueStat.isDirectory() || queueStat.isSymbolicLink() || queueStat.uid !== 0 || (queueStat.mode & 0o002)) throw new Error('UNTRUSTED_QUEUE_DIRECTORY');
  const lock = path.join(policy.stateDirectory, 'agent.lock');
  let fd;
  try {
    fd=fs.openSync(lock,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.fsyncSync(fd);syncDirectory(policy.stateDirectory);
  } catch(error) {
    if(error.code==='EEXIST') {
      const previous=JSON.parse(protectedRead(lock));
      let alive=true;
      try {process.kill(previous.pid,0);} catch(failure) {if(failure.code==='ESRCH')alive=false;}
      if(!alive) {
        let progress={};
        try {progress=JSON.parse(protectedRead(path.join(policy.publicDirectory,'status.json')));} catch {}
        atomic(path.join(policy.publicDirectory,'status.json'),{...progress,state:'recovery_required',errorCode:'AGENT_INTERRUPTED'},0o644);
      }
    }
    throw error; // even a stale lock requires reconciliation; never remove it automatically
  }
  try {
    const release = approval(policy);
    atomic(path.join(policy.publicDirectory, 'catalog.json'), release, 0o644);
    const files = fs.readdirSync(policy.queueDirectory);
    if (files.length > 100) throw new Error('REQUEST_QUEUE_LIMIT');
    for (const name of files) {
      if (name !== release.approvalId + '.json') continue;
      const request = readRequest(path.join(policy.queueDirectory, name));
      if (fs.existsSync(path.join(policy.stateDirectory, release.approvalId + '.consumed'))) {
        let previous={...request};
        try {previous=JSON.parse(protectedRead(path.join(policy.publicDirectory,'status.json')));} catch {}
        if (!['completed','recovery_required'].includes(previous.state)) atomic(path.join(policy.publicDirectory, 'status.json'), { ...previous, state: 'recovery_required', errorCode: 'AGENT_INTERRUPTED' }, 0o644);
        continue;
      }
      await processRequest({ policy, request, state: policy.stateDirectory, status: policy.publicDirectory });
    }
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
};
if (require.main === module) main().catch(() => { console.error('RELEASE_AGENT_FAILED: verificar status e recuperação antes de nova aprovação.'); process.exitCode = 1; });
module.exports = { approval, readRequest, processRequest, atomic };
