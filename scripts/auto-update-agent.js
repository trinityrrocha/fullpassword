// Host-side automatic updater. Runs as root from a systemd timer; never inside the application containers.
// Authority comes ONLY from (1) the signed public channel verified with a root-owned public key and
// (2) root-owned configuration. The web app can only drop a request file naming the release it was shown.
// A click starts: pull by digest -> stop writers -> verified pg_dump -> schema migration -> start -> verify -> stabilize.
// Any failure restores the previous images. If the backup fails the update is refused.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { protectedRead, validateReleaseCompose, verifyInstalledRevision } = require('./deploy-approved-release');

const REPOSITORY = 'trinityrrocha/fullpassword';
const DEFAULT_CHANNEL = 'https://raw.githubusercontent.com/trinityrrocha/fullpassword/main/releases/stable.json';
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LIMIT = 512 * 1024;
const CHANNEL_TTL = 15 * 60 * 1000;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const approvalIdFor = (hash) => `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;

const syncDirectory = (directory) => { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const atomic = (file, value, mode = 0o600) => {
  const temporary = `${file}.${crypto.randomUUID()}`;
  const fd = fs.openSync(temporary, 'wx', mode);
  try { fs.fchmodSync(fd, mode); fs.writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  syncDirectory(path.dirname(file));
};
const readJsonIfPresent = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// ---- signed channel ----------------------------------------------------------------------------------------------
const verifyChannel = (envelope, publicKey, { registry = 'ghcr.io', now = Date.now() } = {}) => {
  if (!exact(envelope, ['payload', 'signature']) || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' ||
      envelope.payload.length > LIMIT || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) ||
      envelope.signature.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature)) throw new Error('INVALID_CHANNEL');
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!crypto.verify('sha256', bytes, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('INVALID_CHANNEL_SIGNATURE');
  const value = JSON.parse(bytes);
  if (!exact(value, ['schemaVersion', 'repository', 'channel', 'revision', 'publishedAt', 'expiresAt', 'backend', 'frontend', 'ancestors', 'changes']) ||
      value.schemaVersion !== 1 || value.repository !== REPOSITORY || value.channel !== 'stable' || !SHA.test(value.revision)) throw new Error('INVALID_CHANNEL');
  const published = Date.parse(value.publishedAt); const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(published) || !Number.isFinite(expiry) || published > now + 300000 || expiry <= now || expiry <= published || expiry - published > 90 * 86400000) throw new Error('CHANNEL_EXPIRED');
  const escaped = registry.replace(/[.:]/g, '\\$&');
  for (const service of ['backend', 'frontend']) {
    if (!new RegExp(`^${escaped}/trinityrrocha/fullpassword-${service}@sha256:[a-f0-9]{64}$`).test(value[service])) throw new Error('UNPINNED_RELEASE_IMAGE');
  }
  if (!Array.isArray(value.ancestors) || value.ancestors.length > 5000 || value.ancestors.some((item) => !SHA.test(item) || item === value.revision) || new Set(value.ancestors).size !== value.ancestors.length) throw new Error('INVALID_CHANNEL_HISTORY');
  if (!Array.isArray(value.changes) || value.changes.length > 50 || value.changes.some((item) => !exact(item, ['type', 'title']) ||
      !['fix', 'feat', 'security', 'perf', 'release', 'change'].includes(item.type) || typeof item.title !== 'string' || !item.title.trim() ||
      item.title.length > 200 || /[<>\x00-\x1f\x7f]/u.test(item.title))) throw new Error('INVALID_CHANNEL_NOTES');
  return { release: value, hash: sha256(bytes) };
};

const downloadChannel = async (url, fetcher = global.fetch) => {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('CHANNEL_UNAVAILABLE');
  const text = await response.text();
  if (text.length > LIMIT) throw new Error('CHANNEL_TOO_LARGE');
  return JSON.parse(text);
};

// ---- docker plumbing ---------------------------------------------------------------------------------------------
const defaultRun = (command, args, { phase = 'command', env, input, stdoutFile, timeout = 900000 } = {}) => {
  let out = 'pipe';
  let fd;
  if (stdoutFile) { fd = fs.openSync(stdoutFile, 'wx', 0o600); out = fd; }
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', out, 'pipe'], env: { ...process.env, ...env },
      timeout, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`COMMAND_FAILED:${phase}`);
    return (result.stdout || '').trim();
  } finally { if (fd !== undefined) fs.closeSync(fd); }
};

const createContext = (config, deps = {}) => ({
  config,
  run: deps.run || defaultRun,
  read: deps.read || protectedRead,
  now: deps.now || (() => Date.now()),
  wait: deps.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  fetcher: deps.fetcher || global.fetch,
  stabilizeMs: deps.stabilizeMs ?? 60000
});

const releaseEnvPath = (config) => path.join(config.stateDirectory, 'release.env');
const parseEnv = (text) => Object.fromEntries(String(text || '').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const writeReleaseEnv = (config, values) => atomic(releaseEnvPath(config), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', 0o600);

// files: compose files in effect; env: release.env present? target images are provided through the process env so that
// the very same resolution is validated before it is applied.
const composeBase = (ctx, { files, imageEnv }) => ({
  args: (extra) => ['compose', '--project-directory', ctx.config.projectDir, '--env-file', ctx.config.envFile,
    '--env-file', releaseEnvPath(ctx.config), ...files.flatMap((file) => ['-f', file]), ...extra],
  env: imageEnv || {}
});
const dc = (ctx, mode, extra, phase, options = {}) => ctx.run('docker', mode.args(extra), { phase, env: mode.env, ...options });

const targetMode = (ctx, release) => composeBase(ctx, { files: [...ctx.config.baseFiles, ctx.config.overlayFile],
  imageEnv: { RELEASE_BACKEND_IMAGE: release.backend, RELEASE_FRONTEND_IMAGE: release.frontend } });
// release.env always exists (written by setup with the runtime DB credentials); it carries image pins only once adopted.
const readReleaseEnv = (ctx) => parseEnv(fs.readFileSync(releaseEnvPath(ctx.config), 'utf8'));
const isAdopted = (env) => Boolean(env.RELEASE_BACKEND_IMAGE && env.RELEASE_FRONTEND_IMAGE);
const currentMode = (ctx) => composeBase(ctx, { files: isAdopted(readReleaseEnv(ctx)) ? [...ctx.config.baseFiles, ctx.config.overlayFile] : ctx.config.baseFiles });

const readHealth = (ctx, mode) => {
  const health = JSON.parse(dc(ctx, mode, ['exec', '-T', 'backend', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"], 'health'));
  const frontend = JSON.parse(dc(ctx, mode, ['exec', '-T', 'frontend', 'cat', '/usr/share/nginx/html/version.json'], 'frontend_version'));
  return { health, frontend };
};
const runningRevision = (ctx, mode) => {
  try { const { health, frontend } = readHealth(ctx, mode); return health.commit === frontend.revision && SHA.test(health.commit) ? health.commit : null; } catch { return null; }
};
const verifyRelease = (ctx, mode, release) => {
  const { health, frontend } = readHealth(ctx, mode);
  verifyInstalledRevision(release, health, frontend);
  for (const service of ['backend', 'frontend']) {
    const id = dc(ctx, mode, ['ps', '-q', service], 'ps');
    const image = ctx.run('docker', ['inspect', '--format', '{{.Image}}', id], { phase: 'inspect' });
    const expected = ctx.run('docker', ['image', 'inspect', '--format', '{{.Id}}', release[service]], { phase: 'image_inspect' });
    const digests = JSON.parse(ctx.run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', release[service]], { phase: 'image_digests' }));
    if (!id || image !== expected || !digests?.includes(release[service])) throw new Error('DEPLOY_DIGEST_MISMATCH');
  }
};
const serviceImageIds = (ctx, mode) => Object.fromEntries(['backend', 'frontend'].map((service) => {
  const id = dc(ctx, mode, ['ps', '--all', '-q', service], 'ps');
  if (!id) throw new Error('CURRENT_SERVICE_UNIDENTIFIED');
  const imageId = ctx.run('docker', ['inspect', '--format', '{{.Image}}', id], { phase: 'inspect' });
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('INVALID_PREVIOUS_IMAGE_ID');
  ctx.run('docker', ['image', 'tag', imageId, `fullpassword-rollback-${service}:${imageId.slice(7, 19)}`], { phase: 'rollback_tag' });
  return [service, imageId];
}));

// ---- backup ------------------------------------------------------------------------------------------------------
const BACKUP_NAME = /^fullpassword-pre-update-\d{8}T\d{6}Z\.dump$/;
const takeBackup = (ctx, mode) => {
  const { backupDirectory, backupKeep = 3 } = ctx.config;
  const resolved = JSON.parse(dc(ctx, mode, ['config', '--format', 'json'], 'compose_config'));
  const db = resolved.services?.db?.environment || {};
  const user = db.POSTGRES_USER || 'postgres';
  const name = db.POSTGRES_DB || user;
  const stamp = new Date(ctx.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const file = path.join(backupDirectory, `fullpassword-pre-update-${stamp}.dump`);
  try {
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    dc(ctx, mode, ['exec', '-T', 'db', 'pg_dump', '-U', user, '-d', name, '-Fc'], 'backup', { stdoutFile: file });
    const size = fs.statSync(file).size;
    if (size < 1024) throw new Error('BACKUP_EMPTY');
    // The archive must be readable by pg_restore, otherwise it is not a backup.
    const listing = dc(ctx, mode, ['exec', '-T', 'db', 'pg_restore', '--list'], 'backup_verify', { input: fs.readFileSync(file) });
    if (!/\bTABLE\b/.test(listing)) throw new Error('BACKUP_UNREADABLE');
  } catch (error) { try { fs.rmSync(file, { force: true }); } catch { /* nothing to clean */ } throw new Error('BACKUP_FAILED'); }
  const all = fs.readdirSync(backupDirectory).filter((entry) => BACKUP_NAME.test(entry)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - backupKeep))) fs.rmSync(path.join(backupDirectory, old), { force: true });
  return path.basename(file);
};

// ---- apply / rollback --------------------------------------------------------------------------------------------
const rollback = (ctx, previous) => {
  const { stateDirectory } = ctx.config;
  writeReleaseEnv(ctx.config, previous.releaseEnv);
  const override = path.join(stateDirectory, 'rollback-override.json');
  atomic(override, { services: Object.fromEntries(['backend', 'frontend'].map((service) => [service, { image: `fullpassword-rollback-${service}:${previous.images[service].slice(7, 19)}` }])) });
  const mode = composeBase(ctx, { files: [...previous.files, override],
    imageEnv: isAdopted(previous.releaseEnv) ? { RELEASE_BACKEND_IMAGE: previous.releaseEnv.RELEASE_BACKEND_IMAGE, RELEASE_FRONTEND_IMAGE: previous.releaseEnv.RELEASE_FRONTEND_IMAGE } : {} });
  dc(ctx, mode, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'backend', 'frontend'], 'image_rollback');
  for (const service of ['backend', 'frontend']) {
    const id = dc(ctx, mode, ['ps', '-q', service], 'ps');
    if (ctx.run('docker', ['inspect', '--format', '{{.Image}}', id], { phase: 'inspect' }) !== previous.images[service]) throw new Error('ROLLBACK_IMAGE_MISMATCH');
  }
};

const applyRelease = async (ctx, release, { publish, processing }) => {
  const { config } = ctx;
  const target = targetMode(ctx, release);
  const current = currentMode(ctx);
  const currentRelease = readReleaseEnv(ctx);
  const previous = { revision: runningRevision(ctx, current), images: serviceImageIds(ctx, current), releaseEnv: currentRelease,
    files: isAdopted(currentRelease) ? [...config.baseFiles, config.overlayFile] : [...config.baseFiles] };
  processing.update({ previous, phase: 'preflight' });
  const resolved = JSON.parse(dc(ctx, target, ['--profile', 'operator', 'config', '--format', 'json'], 'compose_config'));
  validateReleaseCompose(resolved, { origin: config.origin, migrateSchema: true });
  let stopped = false;
  try {
    dc(ctx, target, ['pull', 'backend', 'frontend'], 'pull_images');
    processing.update({ phase: 'backup' });
    dc(ctx, current, ['stop', 'backend'], 'stop_writers'); stopped = true;
    const backup = takeBackup(ctx, current);
    processing.update({ phase: 'migrate', backup });
    // The migration service resolves its image from the target env; the runtime role keeps DML-only access.
    dc(ctx, target, ['--profile', 'operator', 'run', '--rm', '--no-deps', 'schema-migrate', 'node', 'scripts/migrate-schema.js'], 'schema_migrate');
    processing.update({ phase: 'start' });
    dc(ctx, target, ['up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '180', 'backend', 'frontend'], 'start_services');
    verifyRelease(ctx, target, release);
    writeReleaseEnv(config, { ...currentRelease, RELEASE_BACKEND_IMAGE: release.backend, RELEASE_FRONTEND_IMAGE: release.frontend });
    publish({ state: 'stabilizing', healthyAt: new Date(ctx.now()).toISOString() });
    processing.update({ phase: 'stabilize' });
    await ctx.wait(ctx.stabilizeMs);
    verifyRelease(ctx, targetMode(ctx, release), release); // re-check the real installation after the minimum window
    return { backup };
  } catch (error) {
    const message = String(error.message);
    const code = message.startsWith('COMMAND_FAILED:') ? `${message.slice(15).toUpperCase()}_FAILED` : message;
    try { rollback(ctx, previous); } catch { const failure = new Error(code); failure.recovery = true; throw failure; }
    const failure = new Error(code.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60)); failure.recovery = false; failure.stopped = stopped; throw failure;
  }
};

// ---- orchestration -----------------------------------------------------------------------------------------------
const processingFile = (config) => path.join(config.stateDirectory, 'processing.json');
const makeProcessing = (config, initial) => { let value = initial; atomic(processingFile(config), value); return { get: () => value, update: (patch) => { value = { ...value, ...patch }; atomic(processingFile(config), value); } }; };

const writeStatus = (config, base, phase) => atomic(path.join(config.publicDirectory, 'status.json'), { ...base, ...phase }, 0o644);

// Chooses the release a click may install: the signed channel head, only when the installation descends from it.
const candidate = async (ctx, installedRevision) => {
  const { config } = ctx;
  const cacheFile = path.join(config.stateDirectory, 'channel.json');
  let cached = readJsonIfPresent(cacheFile);
  const publicKey = ctx.read(config.publicKeyFile);
  const options = { registry: config.imageRegistry || 'ghcr.io', now: ctx.now() };
  if (!cached || ctx.now() - Date.parse(cached.fetchedAt) > CHANNEL_TTL) {
    try {
      const envelope = await downloadChannel(config.channelUrl || DEFAULT_CHANNEL, ctx.fetcher);
      const verified = verifyChannel(envelope, publicKey, options);
      const seen = readJsonIfPresent(path.join(config.stateDirectory, 'channel-seen.json'));
      if (seen && (Date.parse(verified.release.publishedAt) < Date.parse(seen.publishedAt) ||
          (verified.release.revision !== seen.revision && !verified.release.ancestors.includes(seen.revision)))) throw new Error('CHANNEL_ROLLBACK');
      atomic(path.join(config.stateDirectory, 'channel-seen.json'), { revision: verified.release.revision, publishedAt: verified.release.publishedAt });
      cached = { fetchedAt: new Date(ctx.now()).toISOString(), envelope };
      atomic(cacheFile, cached);
    } catch { if (cached) cached = { ...cached, fetchedAt: new Date(ctx.now() - CHANNEL_TTL + 60000).toISOString() }; /* retry in a minute */ }
  }
  if (!cached) return null;
  let verified;
  try { verified = verifyChannel(cached.envelope, publicKey, options); } catch { return null; } // expired or tampered cache -> no release
  const { release, hash } = verified;
  if (!SHA.test(installedRevision || '') || release.revision === installedRevision || !release.ancestors.includes(installedRevision)) return { release, hash, eligible: false };
  return { release, hash, eligible: true };
};

const catalogFor = (config, found) => ({ approvalId: approvalIdFor(found.hash), revision: found.release.revision, manifestHash: found.hash,
  backend: found.release.backend, frontend: found.release.frontend, origin: config.origin, expiresAt: found.release.expiresAt, changes: found.release.changes });

const readRequest = (file) => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 || stat.nlink !== 1) throw new Error('INVALID_REQUEST_FILE');
    const request = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!exact(request, ['approvalId', 'manifestHash', 'requestId', 'revision']) || !UUID.test(request.approvalId) || !UUID.test(request.requestId) ||
        !SHA.test(request.revision) || !/^[a-f0-9]{64}$/.test(request.manifestHash)) throw new Error('INVALID_REQUEST');
    return request;
  } finally { fs.closeSync(fd); }
};

// Reconciles an interrupted run without a human when the real state is unambiguous.
const reconcile = (ctx, pending) => {
  const { config } = ctx;
  const base = { ...pending.request, backend: pending.release.backend, frontend: pending.release.frontend, changes: pending.release.changes, startedAt: pending.startedAt };
  const current = currentMode(ctx);
  const target = targetMode(ctx, pending.release);
  const publish = (phase) => writeStatus(config, base, phase);
  const finish = (phase) => { publish({ ...phase, finishedAt: new Date(ctx.now()).toISOString() }); fs.rmSync(processingFile(config), { force: true }); };
  try {
    verifyRelease(ctx, target, pending.release);
    writeReleaseEnv(config, { ...readReleaseEnv(ctx), RELEASE_BACKEND_IMAGE: pending.release.backend, RELEASE_FRONTEND_IMAGE: pending.release.frontend });
    atomic(path.join(config.publicDirectory, 'installed-release.json'), catalogFor(config, { release: pending.release, hash: pending.request.manifestHash }), 0o644);
    return finish({ state: 'completed' }), 'completed';
  } catch { /* not the target */ }
  if (!pending.previous) { fs.rmSync(processingFile(config), { force: true }); return 'discarded'; } // crashed before any effect
  try {
    if (runningRevision(ctx, current) !== pending.previous.revision) rollback(ctx, pending.previous);
    return finish({ state: 'failed', errorCode: 'AGENT_INTERRUPTED' }), 'failed';
  } catch { publish({ state: 'recovery_required', errorCode: 'AGENT_INTERRUPTED', finishedAt: new Date(ctx.now()).toISOString() }); return 'recovery_required'; }
};

const acquireLock = (config) => {
  const lock = path.join(config.stateDirectory, 'agent.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.fsyncSync(fd); fs.closeSync(fd); return () => fs.rmSync(lock, { force: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = readJsonIfPresent(lock);
      let alive = false;
      try { process.kill(previous?.pid, 0); alive = true; } catch (failure) { alive = failure.code === 'EPERM'; }
      if (alive) return null; // another run is working
      fs.rmSync(lock, { force: true }); // dead owner: the interrupted work is reconciled below from real state
    }
  }
  return null;
};

const tick = async (ctx, { adopt = false } = {}) => {
  const { config } = ctx;
  if (fs.existsSync(config.disabledFile) || config.enabled === false) return { skipped: 'disabled' };
  const release = acquireLock(config);
  if (!release) return { skipped: 'busy' };
  try {
    const pending = readJsonIfPresent(processingFile(config));
    if (pending) {
      if (pending.recovery) return { skipped: 'recovery_required' };
      const outcome = reconcile(ctx, pending);
      if (outcome === 'recovery_required') atomic(processingFile(config), { ...pending, recovery: true });
      else if (outcome === 'completed' || outcome === 'failed') { /* reported through status.json */ }
    }
    if (fs.existsSync(processingFile(config))) return { skipped: 'recovery_required' };
    const installed = runningRevision(ctx, currentMode(ctx));
    const found = await candidate(ctx, installed);
    const catalogFile = path.join(config.publicDirectory, 'catalog.json');
    if (!found?.eligible) { fs.rmSync(catalogFile, { force: true }); return { idle: true }; }
    const catalog = catalogFor(config, found);
    atomic(catalogFile, catalog, 0o644);
    const requestFile = path.join(config.queueDirectory, `${catalog.approvalId}.json`);
    let request = null;
    if (fs.existsSync(requestFile)) {
      request = readRequest(requestFile);
      fs.rmSync(requestFile, { force: true }); // one click = one attempt; a retry needs a new click
      if (request.approvalId !== catalog.approvalId || request.revision !== catalog.revision || request.manifestHash !== catalog.manifestHash) return { rejected: true };
    } else if (adopt || (!isAdopted(readReleaseEnv(ctx)) && fs.existsSync(path.join(config.stateDirectory, 'adopt.consent')))) {
      // First adoption was consented to by running setup: it proceeds on the first eligible stable release.
      request = { approvalId: catalog.approvalId, revision: catalog.revision, manifestHash: catalog.manifestHash, requestId: crypto.randomUUID() };
    }
    if (!request) return { available: catalog.revision };
    const base = { ...request, backend: found.release.backend, frontend: found.release.frontend, changes: found.release.changes, startedAt: new Date(ctx.now()).toISOString() };
    const publish = (phase) => writeStatus(config, base, phase);
    const processing = makeProcessing(config, { request, release: found.release, startedAt: base.startedAt, phase: 'requested' });
    publish({ state: 'deploying' });
    try {
      const result = await applyRelease(ctx, found.release, { publish, processing });
      atomic(path.join(config.publicDirectory, 'installed-release.json'), catalog, 0o644);
      atomic(path.join(config.stateDirectory, 'adopted.json'), { revision: catalog.revision, at: new Date(ctx.now()).toISOString() });
      publish({ state: 'completed', finishedAt: new Date(ctx.now()).toISOString() });
      fs.rmSync(processingFile(config), { force: true });
      return { completed: catalog.revision, backup: result.backup };
    } catch (error) {
      if (error.recovery) {
        atomic(processingFile(config), { ...processing.get(), recovery: true });
        publish({ state: 'recovery_required', errorCode: error.message, finishedAt: new Date(ctx.now()).toISOString() });
        return { recovery_required: true };
      }
      publish({ state: 'failed', errorCode: error.message, finishedAt: new Date(ctx.now()).toISOString() });
      fs.rmSync(processingFile(config), { force: true });
      return { failed: error.message };
    }
  } finally { release(); }
};

// ---- configuration -----------------------------------------------------------------------------------------------
const CONFIG_KEYS = ['projectDir', 'envFile', 'baseFiles', 'overlayFile', 'origin', 'publicKeyFile', 'stateDirectory', 'publicDirectory', 'queueDirectory', 'backupDirectory'];
const loadConfig = (file = '/etc/fullpassword/auto-update.json', read = protectedRead) => {
  const config = JSON.parse(read(file));
  for (const key of CONFIG_KEYS) if (!config[key]) throw new Error('INVALID_AUTO_UPDATE_CONFIG');
  if (!Array.isArray(config.baseFiles) || !config.baseFiles.length || !/^https:\/\//.test(config.origin)) throw new Error('INVALID_AUTO_UPDATE_CONFIG');
  for (const protectedFile of [config.envFile, config.overlayFile, ...config.baseFiles, config.publicKeyFile]) read(protectedFile);
  config.disabledFile = config.disabledFile || '/etc/fullpassword/auto-update.disabled';
  return config;
};

const main = async () => {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('OPERATOR_ROOT_REQUIRED');
  const config = loadConfig();
  const ctx = createContext(config);
  const result = await tick(ctx, { adopt: process.argv.includes('--adopt') });
  if (process.argv.includes('--adopt') && !result.completed && !result.idle && !result.skipped) { console.error(`ADOPT_FAILED ${JSON.stringify(result)}`); process.exitCode = 1; }
  else if (process.argv.includes('--adopt')) console.log(JSON.stringify(result));
};
if (require.main === module) main().catch((error) => { console.error(`AUTO_UPDATE_FAILED: ${error.message}`); process.exitCode = 1; });
module.exports = { verifyChannel, approvalIdFor, catalogFor, createContext, tick, applyRelease, reconcile, rollback, takeBackup, readRequest, loadConfig, atomic, parseEnv };
