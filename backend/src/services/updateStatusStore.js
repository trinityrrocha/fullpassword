const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = ['up_to_date', 'update_available', 'checking', 'updating', 'check_failed', 'local_ahead', 'diverged', 'unknown'];
const TYPE_LABELS = { feat: 'Novidade', fix: 'Correção', security: 'Segurança', style: 'Interface', refactor: 'Melhoria interna', perf: 'Desempenho', docs: 'Documentação', test: 'Testes', chore: 'Manutenção', build: 'Build', ci: 'CI/CD', change: 'Alteração' };
const rootDirectory = () => process.env.UPDATER_STATE_DIR || '/var/lib/fullpassword-updater';
const emptyStatus = () => ({ schema_version: 1, state: 'unknown', installed_commit: null, available_commit: null, commits_behind: 0, checked_at: null, last_successful_check_at: null, discovered_at: null, changes: [], changes_truncated: false, last_check_request_id: null, error_code: null });
const validDate = (v) => v === null || (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)));
const shortText = (v) => typeof v === 'string' && v.length <= 300 && !/[\x00-\x1f\x7f]/.test(v);

function readSmallFile(file, maxSize) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxSize) throw new Error('invalid_file');
  return fs.readFileSync(file, 'utf8');
}

function validateStatus(value) {
  if (!value || value.schema_version !== 1 || !STATES.includes(value.state)
    || ![value.installed_commit, value.available_commit].every((v) => v === null || (typeof v === 'string' && v.length === 40 && SHA.test(v)))
    || !Number.isSafeInteger(value.commits_behind) || value.commits_behind < 0
    || ![value.checked_at, value.last_successful_check_at, value.discovered_at].every(validDate)
    || !(value.last_check_request_id === null || UUID.test(value.last_check_request_id))
    || ![null, 'repository_unreachable', 'invalid_origin', 'invalid_installed_commit', 'check_failed', 'update_failed'].includes(value.error_code)
    || typeof value.changes_truncated !== 'boolean' || !Array.isArray(value.changes) || value.changes.length > 100) return null;
  if (value.state === 'update_available' && (!value.installed_commit || !value.available_commit || value.installed_commit === value.available_commit || value.commits_behind < 1)) return null;
  if (value.state === 'up_to_date' && (!value.installed_commit || value.installed_commit !== value.available_commit || value.commits_behind !== 0)) return null;
  const changes = [];
  for (const change of value.changes) {
    if (!change || typeof change.commit !== 'string' || change.commit.length !== 40 || !SHA.test(change.commit) || change.short_commit !== change.commit.slice(0, 7)
      || !change.date || !validDate(change.date) || !Object.hasOwn(TYPE_LABELS, change.type)
      || change.type_label !== TYPE_LABELS[change.type] || !shortText(change.title) || !shortText(change.raw_subject)) return null;
    changes.push(Object.fromEntries(['commit', 'short_commit', 'date', 'type', 'type_label', 'title', 'raw_subject'].map((key) => [key, change[key]])));
  }
  return { ...Object.fromEntries(Object.keys(emptyStatus()).map((key) => [key, value[key]])), changes };
}

function readStatus(root = rootDirectory()) {
  try { return validateStatus(JSON.parse(readSmallFile(path.join(root, 'update-status.json'), 256000))) || emptyStatus(); }
  catch { return emptyStatus(); }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function writeStatus(value, root = rootDirectory()) {
  const status = validateStatus(value);
  if (!status) throw new Error('invalid_status');
  atomicWrite(path.join(root, 'update-status.json'), JSON.stringify(status));
  return status;
}

function readInstalledCommit(root = rootDirectory()) {
  try {
    const value = readSmallFile(path.join(root, 'installed-commit'), 41).trim();
    return SHA.test(value) ? value : null;
  } catch { return null; }
}

function writeInstalledCommit(commit, root = rootDirectory(), onlyIfMissing = false) {
  if (typeof commit !== 'string' || commit.length !== 40 || !SHA.test(commit)) throw new Error('invalid_installed_commit');
  const file = path.join(root, 'installed-commit');
  if (onlyIfMissing && fs.existsSync(file)) return;
  atomicWrite(file, `${commit}\n`);
}

module.exports = { SHA, UUID, TYPE_LABELS, emptyStatus, rootDirectory, readStatus, writeStatus, atomicWrite, readSmallFile, readInstalledCommit, writeInstalledCommit };
