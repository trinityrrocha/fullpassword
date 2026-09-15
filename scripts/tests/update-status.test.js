const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const store = require('../../backend/src/services/updateStatusStore');
const { checkUpdateStatus, changeFromLog, validateCheckRequest, restartArchivedDaemon } = require('../check-update-status');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fullpassword-update-test-'));
const repo = path.join(temporary, 'repo');
const origin = path.join(temporary, 'origin.git');
const stateRoot = path.join(temporary, 'state');
fs.mkdirSync(repo);
const run = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (subject) => { run(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', subject]); return run(['rev-parse', 'HEAD']); };
const official = 'https://github.com/trinityrrocha/fullpassword.git';
const git = (args) => args[0] === 'fetch'
  ? run(['-c', `url.${origin.replace(/\\/g, '/')}.insteadOf=${official}`, ...args]) : run(args);
let tick = 0;
const check = (extra = {}) => checkUpdateStatus({ root: stateRoot, git, now: () => new Date(1700000000000 + tick++ * 1000).toISOString(), ...extra });

async function main() {
  run(['init', '--bare', origin]);
  run(['init', '-b', 'main']);
  const first = commit('feat: initial');
  run(['remote', 'add', 'origin', official]);
  run(['push', origin, 'main']);
  assert.equal(check().state, 'unknown');
  store.writeInstalledCommit(first, stateRoot, true);
  assert.equal(fs.readFileSync(path.join(stateRoot, 'installed-commit'), 'utf8'), `${first}\n`);
  assert.equal(check().state, 'up_to_date');
  const second = commit('fix: corrected startup');
  run(['push', origin, 'main']);
  let status = check();
  assert.equal(status.state, 'update_available');
  assert.equal(status.commits_behind, 1);
  assert.equal(status.changes[0].title, 'corrected startup');
  assert.equal(status.changes[0].type_label, 'Correção');
  const discovered = status.discovered_at;
  assert.equal(check().discovered_at, discovered);
  assert.equal(changeFromLog(`${first}\t2026-09-14T00:00:00Z\tfeat: thing`).type_label, 'Novidade');
  assert.equal(changeFromLog(`${first}\t2026-09-14T00:00:00Z\tother: thing`).type_label, 'Alteração');
  for (const type of Object.keys(store.TYPE_LABELS)) {
    assert.equal(changeFromLog(`${first}\t2026-09-14T00:00:00Z\t${type}: thing`).type_label, store.TYPE_LABELS[type]);
  }
  const stable = store.readStatus(stateRoot);
  status = check({ git: (args) => { if (args[0] === 'fetch') throw new Error('secret must not escape'); return git(args); } });
  assert.equal(status.state, 'check_failed');
  assert.equal(status.error_code, 'repository_unreachable');
  assert.equal(status.last_successful_check_at, stable.last_successful_check_at);
  assert.equal(status.available_commit, second);
  assert.ok(!JSON.stringify(status).includes('secret'));
  let fetchCalled = false;
  assert.equal(check({ git: (args) => { if (args[0] === 'remote') return 'https://example.invalid/repo'; fetchCalled = true; return git(args); } }).error_code, 'invalid_origin');
  assert.equal(fetchCalled, false);
  const third = commit('style: newer interface');
  run(['push', origin, 'main']);
  status = check();
  assert.notEqual(status.discovered_at, discovered);
  assert.equal(status.changes[0].commit, third);
  // Simulated failed deploy after a real HEAD advance must not change marker.
  store.writeInstalledCommit(third, stateRoot, true);
  assert.equal(store.readInstalledCommit(stateRoot), first);
  assert.equal(check().installed_commit, first);
  store.writeInstalledCommit(third, stateRoot);
  assert.equal(check().state, 'up_to_date');
  const ahead = commit('chore: local only');
  store.writeInstalledCommit(ahead, stateRoot);
  assert.equal(check().state, 'local_ahead');
  run(['checkout', '-b', 'fork', first]);
  const fork = commit('fix: different history');
  store.writeInstalledCommit(fork, stateRoot);
  assert.equal(check().state, 'diverged');
  run(['checkout', 'main']);
  for (let index = 0; index < 101; index++) commit(`test: change ${index}`);
  run(['push', origin, 'main']);
  store.writeInstalledCommit(first, stateRoot);
  status = check();
  assert.equal(status.commits_behind, 104);
  assert.equal(status.changes.length, 100);
  assert.equal(status.changes_truncated, true);
  assert.equal(fs.readdirSync(stateRoot).filter((name) => name.endsWith('.tmp')).length, 0);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(stateRoot, 'installed-commit')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(stateRoot, 'update-status.json')).mode & 0o777, 0o600);
  }

  process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
  process.env.ADMIN_BOOTSTRAP_TOKEN = crypto.randomBytes(48).toString('hex');
  process.env.DB_HOST = '127.0.0.1'; process.env.DB_USER = 'test'; process.env.DB_PASSWORD = 'TEST_ONLY'; process.env.DB_NAME = 'test';
  const { createUpdateStatusController } = require('../../backend/src/controllers/updateStatusController');
  let seen = null;
  const events = [];
  const controller = createUpdateStatusController({ root: stateRoot, audit: async (event) => events.push(event.action), database: {
    query: async (sql, values) => { if (sql.startsWith('INSERT')) seen = values[1]; return { rows: [{ update_notification_seen_commit: seen }] }; }
  } });
  const user = { id: crypto.randomUUID(), email: 'admin@example.invalid', role: 'admin', is_super_admin: true };
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; }, setHeader() {} });
  const call = async (method, body = {}, actor = user) => { const res = response(); await controller[method]({ user: actor, body }, res); return res; };
  for (const method of ['getStatus', 'requestCheck', 'markSeen']) {
    assert.equal((await call(method, {}, { ...user, is_super_admin: false })).statusCode, 403);
    assert.equal((await call(method, {}, { ...user, role: 'user' })).statusCode, 403);
  }
  assert.equal((await call('getStatus')).data.notification_unread, true);
  assert.equal((await call('markSeen')).statusCode, 200);
  assert.equal(seen, status.available_commit);
  assert.equal((await call('getStatus')).data.notification_unread, false);
  assert.equal((await call('getStatus')).data.update_available, true);
  assert.equal((await call('markSeen', { commit: first })).statusCode, 400);
  assert.equal((await call('requestCheck', { repo: official, branch: 'other', command: 'anything' })).statusCode, 400);
  const requested = await call('requestCheck');
  assert.equal(requested.statusCode, 202);
  const requestFile = path.join(stateRoot, 'check-requests', `${requested.data.request_id}.json`);
  assert.ok(validateCheckRequest(requestFile, requested.data.request_id));
  if (process.platform !== 'win32') assert.equal(fs.statSync(requestFile).mode & 0o777, 0o600);
  const malformedRequest = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  store.atomicWrite(requestFile, JSON.stringify({ ...malformedRequest, command: 'forbidden' }));
  assert.equal(validateCheckRequest(requestFile, requested.data.request_id), false);
  store.atomicWrite(requestFile, JSON.stringify(malformedRequest));
  status = check({ requestId: requested.data.request_id });
  assert.equal(status.last_check_request_id, requested.data.request_id);
  const newCommit = commit('security: new release'); run(['push', origin, 'main']);
  check();
  assert.equal((await call('getStatus')).data.notification_unread, true);
  assert.equal((await call('markSeen')).data.seen_commit, newCommit);
  assert.ok(events.includes('system_update_notification_seen'));
  store.atomicWrite(path.join(stateRoot, 'update-status.json'), '{invalid json secret=/internal/path');
  const invalid = (await call('getStatus')).data;
  assert.equal(invalid.state, 'unknown');
  assert.ok(!JSON.stringify(invalid).includes('/internal'));
  fs.unlinkSync(path.join(stateRoot, 'update-status.json'));
  assert.equal((await call('getStatus')).data.state, 'unknown');
  assert.equal((await call('markSeen')).statusCode, 200);
  const updateScript = fs.readFileSync(path.join(__dirname, '../update.sh'), 'utf8');
  assert.ok(updateScript.indexOf('initialize-installed "$PRE_UPDATE_COMMIT"') < updateScript.indexOf('git fetch origin main'));
  assert.ok(updateScript.indexOf('[ "$ready" = 1 ]') < updateScript.indexOf('record-installed "$(git rev-parse HEAD)"'));
  const installScript = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
  assert.match(installScript, /create_initial_super_admin\s+record_installed_commit/);
  assert.match(installScript, /compose exec -T updater node \/opt\/fullpassword\/scripts\/check-update-status.js record-installed/);
  const daemonSource = fs.readFileSync(path.join(__dirname, '../updater-daemon.sh'), 'utf8');
  assert.match(daemonSource, /UPDATER_CHECK_INTERVAL_SECONDS:-86400/);
  assert.match(daemonSource, /now - last_check/);
  assert.match(daemonSource, /UPDATER_LOCK_HELD=1 APP_DIR=/);
  assert.match(daemonSource, /check_updates "\$\{name%\.json\}"/);
  fs.mkdirSync(path.join(stateRoot, 'update.lock'));
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '../check-update-status.js'), 'check'], {
    env: { ...process.env, UPDATER_STATE_DIR: stateRoot, UPDATER_LOCK_HELD: '' }, stdio: 'pipe'
  }));
  fs.rmdirSync(path.join(stateRoot, 'update.lock'));
  store.atomicWrite(path.join(stateRoot, 'processed', `${requested.data.request_id}.json`), JSON.stringify(malformedRequest));
  let restarted = false;
  await restartArchivedDaemon(requested.data.request_id, stateRoot, () => {
    assert.ok(fs.existsSync(path.join(stateRoot, 'update.lock')));
    restarted = true;
  });
  assert.equal(restarted, true);
  assert.equal(fs.existsSync(path.join(stateRoot, 'update.lock')), false);
  console.log('Update status: Git histories, 100-item cap, marker preservation, requests, authorization and notifications passed.');
  if (process.platform === 'win32') console.log('POSIX permission bits: skipped on Windows; explicit chmod/creation modes reviewed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temporary, { recursive: true, force: true }));
