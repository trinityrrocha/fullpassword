// End-to-end rehearsal of the automatic updater with REAL Docker, PostgreSQL and nginx images built from this checkout.
// Synthetic only: refuses to run if an auto-update install or a legacy release policy already exists on the host.
// Needs root, Docker with compose v2, Node 24.x, openssl-free (keys via node:crypto). Registry is a throwaway local registry:2.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const hex = (n) => crypto.randomBytes(n).toString('hex');
const sha = () => hex(20);
const log = (message) => console.log(`[auto-update-e2e] ${message}`);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1500000, ...options });
  if (result.status !== 0 && !options.allowFailure) {
    const tail = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n').filter((line) => !/password|secret|token/i.test(line)).slice(-25).join('\n');
    throw new Error(`COMMAND_FAILED ${command} ${args.slice(0, 3).join(' ')}\n${tail}`);
  }
  return options.allowFailure ? result : (result.stdout || '').trim();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PATHS = ['/etc/fullpassword', '/usr/local/lib/fullpassword-release', '/var/lib/fullpassword-release-agent', '/var/lib/fullpassword-release-public',
  '/var/lib/fullpassword-release-queue', '/var/backups/fullpassword'];

async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0, 'run as root');
  assert.match(process.version, /^v24\./, 'Node 24.x required');
  for (const entry of PATHS) assert.equal(fs.existsSync(entry), false, `never touch an existing ${entry}`);

  const id = hex(4);
  const base = `/var/lib/fp-au-test-${id}`;
  const project = path.join(base, 'project');
  const nodeDir = `/usr/local/lib/fp-au-node-${id}`;
  const projectName = `fpau${id}`;
  const registryName = `fp-au-registry-${id}`;
  const [A, B, C, D] = [sha(), sha(), sha(), sha()];
  const dbPassword = hex(24);
  const created = { registry: false, server: null };
  const cleanup = () => {
    run('docker', ['compose', '-p', projectName, '--project-directory', project, '-f', `${project}/docker-compose.yml`, '--env-file', `${project}/.env`, 'down', '-v', '--remove-orphans'], { allowFailure: true });
    if (created.registry) run('docker', ['rm', '-f', registryName], { allowFailure: true });
    for (const entry of ['/etc/systemd/system/fullpassword-auto-update.service', '/etc/systemd/system/fullpassword-auto-update.timer', ...PATHS, base, nodeDir]) fs.rmSync(entry, { recursive: true, force: true });
    const tags = run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', '--filter', 'reference=fullpassword-rollback-*'], { allowFailure: true }).stdout || '';
    for (const tag of tags.split('\n').filter(Boolean)) run('docker', ['image', 'rm', '-f', tag], { allowFailure: true });
    created.server?.close();
  };
  process.on('exit', cleanup);

  // ---- a clean, root-owned source install ----
  fs.mkdirSync(base, { mode: 0o755 }); fs.mkdirSync(project, { mode: 0o755 });
  const listing = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).stdout;
  assert.ok(listing.length > 0);
  run('tar', ['--null', '-T', '-', '-cf', path.join(base, 'src.tar')], { input: listing });
  run('tar', ['-xf', path.join(base, 'src.tar'), '-C', project]);
  const composeFile = path.join(project, 'docker-compose.yml');
  fs.writeFileSync(composeFile, fs.readFileSync(composeFile, 'utf8').replace(/^\s*container_name:.*\n/gm, '')); // isolate from any local stack
  fs.writeFileSync(path.join(project, '.env'), Object.entries({ COMPOSE_PROJECT_NAME: projectName, DB_PASSWORD: dbPassword,
    JWT_SECRET: hex(32), ADMIN_BOOTSTRAP_TOKEN: hex(24), SUPER_ADMIN_EMAIL: 'audit@example.invalid', APP_ORIGIN: 'https://audit.example.invalid',
    BACKEND_APP_COMMIT: A, VITE_APP_COMMIT: A }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  // Local sandboxes reach the internet only through a TLS-intercepting proxy: opt-in, never used in CI.
  const proxyCa = process.env.FP_E2E_PROXY_CA; const proxy = process.env.HTTPS_PROXY;
  const buildFlags = [];
  if (proxyCa) {
    buildFlags.push('--network=host', '--build-arg', `HTTPS_PROXY=${proxy}`, '--build-arg', `HTTP_PROXY=${proxy}`);
    for (const service of ['backend', 'frontend']) {
      fs.copyFileSync(proxyCa, path.join(project, service, 'ca.crt'));
      const dockerfile = path.join(project, service, 'Dockerfile');
      fs.writeFileSync(dockerfile, fs.readFileSync(dockerfile, 'utf8').replace(/^(FROM node:.*)$/m, '$1\nCOPY ca.crt /ca.crt\nENV NODE_EXTRA_CA_CERTS=/ca.crt'));
    }
  }
  const build = (service, revision, tag) => run('docker', ['build', ...buildFlags, '--build-arg', service === 'backend' ? `BACKEND_APP_COMMIT=${revision}` : `VITE_APP_COMMIT=${revision}`, '-t', tag, `./${service}`], { cwd: project });
  const compose = (...args) => run('docker', ['compose', '--project-directory', project, '--env-file', path.join(project, '.env'), '-f', composeFile, ...args]);
  const waitHealthy = async (revision) => {
    for (let n = 0; n < 60; n += 1) {
      try {
        const health = JSON.parse(compose('exec', '-T', 'backend', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"));
        if (health.commit === revision && health.schema_ready === true) return health;
      } catch { /* starting */ }
      await sleep(3000);
    }
    throw new Error(`NOT_HEALTHY ${revision}`);
  };
  log(`building installed revision ${A.slice(0, 8)} from source`);
  for (const service of ['backend', 'frontend']) build(service, A, `${projectName}-${service}`);
  compose('up', '-d', 'db', 'backend', 'frontend');
  await waitHealthy(A);
  const sql = (statement) => compose('exec', '-T', 'db', 'sh', '-c', 'psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', '_', statement);
  sql("CREATE TABLE au_marker(v text); INSERT INTO au_marker VALUES ('survives-every-update')");

  // ---- target images through a throwaway registry, signed with a throwaway key ----
  run('docker', ['run', '-d', '--name', registryName, '-p', '127.0.0.1:5000:5000', 'registry:2']); created.registry = true;
  const registry = '127.0.0.1:5000';
  const image = (service, revision) => {
    const ref = `${registry}/trinityrrocha/fullpassword-${service}:${revision.slice(0, 12)}`;
    build(service, revision, ref);
    run('docker', ['push', ref]);
    const digest = run('docker', ['image', 'inspect', '--format', '{{index .RepoDigests 0}}', ref]);
    assert.match(digest, /@sha256:[a-f0-9]{64}$/);
    return digest;
  };
  log('building and publishing target images B, C (mismatched frontend) and D');
  const bBack = image('backend', B); const bFront = image('frontend', B);
  const cBack = image('backend', C); // C ships the frontend of B: revision mismatch -> must roll back
  const dBack = image('backend', D); const dFront = image('frontend', D);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  let envelope = null;
  const channelFile = path.join(base, 'channel.json');
  const channel = (revision, backend, frontend, ancestors, publishedOffset = 0) => {
    const published = new Date(Date.now() - 60000 + publishedOffset);
    const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: 'trinityrrocha/fullpassword', channel: 'stable', revision,
      backend, frontend, publishedAt: published.toISOString(), expiresAt: new Date(published.getTime() + 30 * 86400000).toISOString(), ancestors,
      changes: [{ type: 'feat', title: `Rehearsal ${revision.slice(0, 7)}` }] }));
    envelope = { payload: payload.toString('base64'), signature: crypto.sign('sha256', payload, privateKey).toString('base64') };
    fs.writeFileSync(channelFile, JSON.stringify(envelope));
    fs.rmSync('/var/lib/fullpassword-release-agent/channel.json', { force: true }); // skip the 15-minute fetch cache
  };
  // The agent runs under spawnSync, which blocks this process: serve the channel from a separate process.
  const channelPort = 20000 + (parseInt(id, 16) % 20000);
  const server = spawn(process.execPath, ['-e', `require('http').createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(require('fs').readFileSync(${JSON.stringify(channelFile)}))}).listen(${channelPort},'127.0.0.1')`], { stdio: 'ignore' });
  created.server = { close: () => server.kill() };
  const channelUrl = `http://127.0.0.1:${channelPort}/stable.json`;

  // ---- setup (one command), then point the root-owned config at the rehearsal channel ----
  fs.mkdirSync(nodeDir, { mode: 0o755 }); fs.copyFileSync(process.execPath, path.join(nodeDir, 'node')); fs.chmodSync(path.join(nodeDir, 'node'), 0o755);
  const env = { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` };
  log('setup-auto-update.sh --no-adopt');
  run('bash', [path.join(project, 'scripts/setup-auto-update.sh'), '--project-dir', project, '--no-adopt'], { env });
  const configFile = '/etc/fullpassword/auto-update.json';
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(config.origin, 'https://audit.example.invalid');
  fs.writeFileSync(configFile, JSON.stringify({ ...config, channelUrl, imageRegistry: registry }));
  fs.writeFileSync(config.publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }));
  assert.equal(sql("SELECT rolcanlogin::text||rolsuper::text FROM pg_roles WHERE rolname='fullpassword_runtime'"), 'truefalse');
  const agent = (...args) => run(path.join(nodeDir, 'node'), ['/usr/local/lib/fullpassword-release/auto-update-agent.js', ...args], { env, allowFailure: true });
  const status = () => JSON.parse(fs.readFileSync('/var/lib/fullpassword-release-public/status.json', 'utf8'));
  const catalog = () => JSON.parse(fs.readFileSync('/var/lib/fullpassword-release-public/catalog.json', 'utf8'));
  const backups = () => fs.readdirSync('/var/backups/fullpassword').filter((name) => name.endsWith('.dump')).sort();
  const click = () => { // what the backend does: write exactly the request it was shown (as the unprivileged node user)
    const shown = catalog();
    const body = JSON.stringify({ approvalId: shown.approvalId, revision: shown.revision, manifestHash: shown.manifestHash, requestId: crypto.randomUUID() });
    compose('exec', '-T', 'backend', 'node', '-e', `require('fs').writeFileSync('/var/lib/fullpassword-release-queue/${shown.approvalId}.json', process.argv[1], {flag:'wx', mode:0o600})`, body);
  };
  const runningRevision = () => JSON.parse(compose('exec', '-T', 'backend', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)")).commit;

  // 1) channel says B; the installed A is an ancestor -> catalog appears, nothing is installed without a request
  channel(B, bBack, bFront, [A]);
  let result = agent();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(catalog().revision, B); assert.equal(runningRevision(), A, 'no request, no change');
  assert.equal(backups().length, 0);

  // 2) adoption (what setup does by default): A -> B with backup, migration, overlay mounts, runtime role
  log('adoption A -> B (real pull, backup, migrate, up, 60 s stabilization)');
  result = agent('--adopt'); assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(status().state, 'completed'); assert.equal(runningRevision(), B);
  assert.equal(backups().length, 1);
  const listed = spawnSync('docker', ['compose', '--project-directory', project, '--env-file', path.join(project, '.env'), '-f', composeFile, 'exec', '-T', 'db', 'pg_restore', '--list'],
    { input: fs.readFileSync(path.join('/var/backups/fullpassword', backups()[0])), encoding: 'utf8' });
  assert.equal(listed.status, 0); assert.match(listed.stdout, /au_marker/, 'the pre-update dump contains the data and restores');
  assert.equal(sql('SELECT v FROM au_marker'), 'survives-every-update');
  assert.equal(fs.existsSync('/var/lib/fullpassword-release-public/installed-release.json'), true);
  const inspect = JSON.parse(run('docker', ['inspect', run('docker', ['compose', '--project-directory', project, '--env-file', '/etc/fullpassword/auto-update/app.env', '--env-file', '/var/lib/fullpassword-release-agent/release.env', '-f', '/etc/fullpassword/auto-update/docker-compose.yml', '-f', '/etc/fullpassword/auto-update/docker-compose.release-agent.yml', 'ps', '-q', 'backend'], { env: { ...process.env, RELEASE_BACKEND_IMAGE: bBack, RELEASE_FRONTEND_IMAGE: bFront } })]))[0];
  assert.equal(inspect.Config.Image, bBack, 'backend runs the digest-pinned image');
  assert.ok(inspect.Mounts.some((m) => m.Destination === '/var/lib/fullpassword-release-queue' && m.RW), 'queue is writable by the app');
  assert.ok(inspect.Mounts.some((m) => m.Destination === '/var/lib/fullpassword-release-public' && !m.RW), 'public state is read-only for the app');
  assert.ok(inspect.Config.Env.includes('DB_SCHEMA_MODE=verify') && inspect.Config.Env.includes('DB_USER=fullpassword_runtime'));
  assert.equal(inspect.HostConfig.ReadonlyRootfs, true);

  // 3) a release whose frontend does not match: update fails, previous version restored, backup taken, click consumed
  log('update to C (mismatched frontend) must fail and roll back');
  channel(C, cBack, bFront, [A, B]);
  agent(); click();
  result = agent(); assert.equal(result.status, 0, result.stderr);
  assert.equal(status().state, 'failed', JSON.stringify(status())); assert.match(status().errorCode, /^DEPLOY_REVISION_MISMATCH$/);
  assert.equal(runningRevision(), B, 'rolled back to B'); assert.equal(sql('SELECT v FROM au_marker'), 'survives-every-update');
  assert.equal(fs.readdirSync('/var/lib/fullpassword-release-queue').length, 0, 'the click is consumed');
  assert.equal(backups().length, 2);

  // 4) backup failure refuses the update and restores service
  log('backup failure must refuse the update');
  channel(D, dBack, dFront, [A, B, C]);
  agent();
  const backupDir = '/var/backups/fullpassword';
  fs.renameSync(backupDir, `${backupDir}.real`); fs.writeFileSync(backupDir, 'not a directory');
  click(); result = agent();
  assert.equal(status().state, 'failed'); assert.equal(status().errorCode, 'BACKUP_FAILED', JSON.stringify(status()));
  assert.equal(runningRevision(), B, 'service restored after refused update');
  fs.rmSync(backupDir); fs.renameSync(`${backupDir}.real`, backupDir);

  // 5) crash in the middle of stabilization: the next run reconciles to the verified real state
  log('agent killed during stabilization; next run reconciles');
  fs.writeFileSync(path.join(base, 'crash.js'), `const a=require('/usr/local/lib/fullpassword-release/auto-update-agent.js');
    const ctx=a.createContext(a.loadConfig(),{wait:()=>{process.kill(process.pid,'SIGKILL');}});a.tick(ctx).then(()=>{});`);
  agent(); click();
  result = run(path.join(nodeDir, 'node'), [path.join(base, 'crash.js')], { env, allowFailure: true });
  assert.notEqual(result.status, 0); assert.equal(runningRevision(), D, 'new version was already running');
  assert.equal(status().state, 'stabilizing'); assert.equal(fs.existsSync('/var/lib/fullpassword-release-agent/processing.json'), true);
  result = agent(); assert.equal(result.status, 0, result.stderr);
  assert.equal(status().state, 'completed', JSON.stringify(status())); assert.equal(fs.existsSync('/var/lib/fullpassword-release-agent/processing.json'), false);
  assert.match(fs.readFileSync('/var/lib/fullpassword-release-agent/release.env', 'utf8'), new RegExp(dBack.replace(/[.$*+?()[\]{}|\\^]/g, '\\$&')));
  assert.equal(backups().length, 3);

  // 6) an up-to-date install exposes no release; the off switch stops everything
  result = agent(); assert.equal(fs.existsSync('/var/lib/fullpassword-release-public/catalog.json'), false);
  run('bash', [path.join(project, 'scripts/setup-auto-update.sh'), '--disable'], { env });
  channel(sha(), bBack, bFront, [A, B, C, D], 5000); // a newer head that must be ignored while disabled
  agent(); assert.equal(fs.existsSync('/var/lib/fullpassword-release-public/catalog.json'), false, 'disabled agent publishes nothing');
  // and the retention keeps only the last three backups
  assert.ok(backups().length <= 3);
  console.log('PASS auto-update e2e: adoption, failed update rolled back, backup failure refused, crash reconciled, off switch, retention.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
