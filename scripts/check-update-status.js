// Runs in the updater only. The API imports the file store, never this Git runner.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const store = require('../backend/src/services/updateStatusStore');
const ORIGINS = new Set(['https://github.com/trinityrrocha/fullpassword', 'https://github.com/trinityrrocha/fullpassword.git', 'git@github.com:trinityrrocha/fullpassword.git']);

function gitRunner(cwd) {
  return (args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, ...args], {
    cwd, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function changeFromLog(line) {
  const [commit, date, ...subjectParts] = line.split('\t');
  const raw_subject = subjectParts.join(' ').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300);
  const match = raw_subject.match(/^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/);
  const type = match && Object.hasOwn(store.TYPE_LABELS, match[1]) ? match[1] : 'change';
  return { commit, short_commit: commit.slice(0, 7), date, type, type_label: store.TYPE_LABELS[type], title: type === 'change' ? raw_subject : match[2], raw_subject };
}

function checkUpdateStatus({ root = store.rootDirectory(), git = gitRunner(process.env.APP_DIR || '/opt/fullpassword'), requestId = null, now = () => new Date().toISOString() } = {}) {
  if (requestId !== null && !store.UUID.test(requestId)) throw new Error('invalid_request');
  const previous = store.readStatus(root);
  const installed = store.readInstalledCommit(root);
  const base = { ...previous, installed_commit: installed, checked_at: now(), last_check_request_id: requestId || previous.last_check_request_id, error_code: null };
  if (!installed) return store.writeStatus({ ...store.emptyStatus(), ...base, state: 'unknown', error_code: 'invalid_installed_commit' }, root);
  store.writeStatus({ ...base, state: 'checking', last_check_request_id: previous.last_check_request_id }, root);
  try {
    if (!ORIGINS.has(git(['remote', 'get-url', 'origin']))) {
      return store.writeStatus({ ...base, state: 'check_failed', error_code: 'invalid_origin' }, root);
    }
    try { git(['fetch', 'origin', 'main']); }
    catch { return store.writeStatus({ ...base, state: 'check_failed', error_code: 'repository_unreachable' }, root); }
    const available = git(['rev-parse', 'refs/remotes/origin/main']);
    if (!store.SHA.test(available)) throw new Error('invalid_remote_commit');
    try { git(['cat-file', '-e', `${installed}^{commit}`]); }
    catch { return store.writeStatus({ ...base, state: 'unknown', error_code: 'invalid_installed_commit' }, root); }
    const ancestor = (a, b) => {
      try { git(['merge-base', '--is-ancestor', a, b]); return true; }
      catch (error) { if (error.status === 1) return false; throw error; }
    };
    const state = installed === available ? 'up_to_date' : ancestor(installed, available) ? 'update_available' : ancestor(available, installed) ? 'local_ahead' : 'diverged';
    const range = `${installed}..${available}`;
    const count = state === 'update_available' ? Number(git(['rev-list', '--count', range])) : 0;
    const changes = count ? git(['log', '--date-order', '--max-count=100', '--format=%H%x09%cI%x09%s', range]).split('\n').filter(Boolean).map(changeFromLog) : [];
    return store.writeStatus({ ...base, state, available_commit: available, commits_behind: count, changes, changes_truncated: count > 100,
      last_successful_check_at: now(), discovered_at: state === 'update_available' ? (previous.available_commit === available && previous.discovered_at ? previous.discovered_at : now()) : null }, root);
  } catch {
    return store.writeStatus({ ...base, state: 'check_failed', error_code: 'check_failed' }, root);
  }
}

function validateCheckRequest(file, expectedId) {
  try {
    const request = JSON.parse(store.readSmallFile(file, 4096));
    return request && Object.keys(request).length === 4
      && ['request_id', 'requested_by_user_id', 'requested_by_email', 'requested_at'].every((key) => Object.hasOwn(request, key))
      && store.UUID.test(expectedId) && request.request_id === expectedId && store.UUID.test(request.requested_by_user_id)
      && typeof request.requested_by_email === 'string' && request.requested_by_email.length <= 320 && request.requested_by_email.includes('@')
      && typeof request.requested_at === 'string' && Number.isFinite(Date.parse(request.requested_at));
  } catch { return false; }
}

// One-shot compatibility handoff, not another scheduler/updater. Never installs code.
async function restartArchivedDaemon(requestId, root = store.rootDirectory(), restart = () => execFileSync('docker', ['restart', 'fullpassword_updater'], { timeout: 30000, stdio: 'ignore' })) {
  if (!store.UUID.test(requestId)) throw new Error('invalid_request');
  for (let attempt = 0; attempt < 120; attempt++) {
    const processed = path.join(root, 'processed', `${requestId}.json`);
    const processing = path.join(root, 'processing', `${requestId}.json`);
    if (fs.existsSync(processed) && !fs.existsSync(processing)) {
      const lock = path.join(root, 'update.lock');
      try { fs.mkdirSync(lock, { mode: 0o700 }); }
      catch { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
      try { restart(); }
      finally { fs.rmdirSync(lock); }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('daemon_handoff_timeout');
}

if (require.main === module) {
  const [command = 'check', argument, expectedId] = process.argv.slice(2);
  const root = store.rootDirectory();
  let ownsLock = false;
  try {
    if (command === 'restart-archived-daemon') {
      restartArchivedDaemon(argument, root).catch(() => { process.exitCode = 1; });
    } else if (command === 'validate-request') {
      process.exitCode = validateCheckRequest(argument, expectedId) ? 0 : 1;
    } else {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      if (process.env.UPDATER_LOCK_HELD !== '1') {
        fs.mkdirSync(path.join(root, 'update.lock'), { mode: 0o700 });
        ownsLock = true;
      }
      if (command === 'schedule-daemon-restart') {
        if (!store.UUID.test(argument)) throw new Error('invalid_request');
        const child = spawn(process.execPath, [__filename, 'restart-archived-daemon', argument], { detached: true, stdio: 'ignore', env: process.env });
        child.on('error', () => { process.exitCode = 1; });
        child.unref();
      } else if (command === 'record-installed' || command === 'initialize-installed') {
        store.writeInstalledCommit(argument, root, command === 'initialize-installed');
      } else if (command === 'updating') {
        store.writeStatus({ ...store.readStatus(root), state: 'updating', installed_commit: store.readInstalledCommit(root), error_code: null }, root);
      } else if (command === 'check') {
        const status = checkUpdateStatus({ root, requestId: argument || null });
        console.log(`[FullPassword Update Check] ${status.state}`);
      } else throw new Error('invalid_command');
    }
  } catch {
    console.error('[FullPassword Update Check] Operação indisponível; nenhum segredo foi registrado.');
    process.exitCode = 1;
  } finally {
    if (ownsLock) fs.rmdirSync(path.join(root, 'update.lock'));
  }
}

module.exports = { checkUpdateStatus, changeFromLog, gitRunner, validateCheckRequest, restartArchivedDaemon };
