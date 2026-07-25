const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { safeLogError } = require('../src/utils/safeLogger');

const repositoryRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const vaultController = read('backend/src/controllers/vaultController.js');
const authController = read('backend/src/controllers/authController.js');
const authMiddleware = read('backend/src/middleware/authMiddleware.js');
const authContext = read('frontend/src/context/AuthContext.jsx');
const updateScript = read('scripts/update.sh');
const accessControlService = read('backend/src/services/accessControlService.js');
const backupControllers = [
  read('backend/src/controllers/systemController.js'),
  read('backend/src/controllers/backupRestoreController.js')
].join('\n');

assert.match(vaultController, /const canManage = await canManageClientShares\(clientId, req\.user\);[\s\S]*if \(!canManage\)/);
assert.doesNotMatch(vaultController, /!canManage\s*&&\s*itemCheck\.rows\[0\]\.created_by/);
assert.match(vaultController, /vault_item_share_denied/);
assert.match(vaultController, /vault_item_share_update/);
assert.match(vaultController, /vault_share_update_denied/);
assert.match(accessControlService, /try\s*{\s*await ensureSharingSchema\(\)/);

assert.match(authController, /httpOnly:\s*true/);
assert.match(authController, /sameSite:\s*'strict'/);
assert.match(authController, /secure:\s*process\.env\.NODE_ENV\s*===\s*'production'/);
assert.match(authMiddleware, /validateUserSession/);
assert.doesNotMatch(authContext, /(?:localStorage|sessionStorage)\.setItem\([^)]*(?:token|jwt)/i);

assert.match(updateScript, /https:\/\/github\.com\/trinityrrocha\/fullpassword\.git/);
assert.match(updateScript, /git fetch origin main/);
assert.match(updateScript, /git pull --ff-only origin main/);
assert.match(updateScript, /git rev-parse origin\/main/);
assert.match(updateScript, /db\|backend\|frontend\|nginx/);
assert.doesNotMatch(updateScript, /git (?:fetch|pull|checkout).*\$\{?(?:BRANCH|REMOTE|URL|COMMAND)/i);

assert.doesNotMatch(backupControllers, /console\.(?:log|warn|error)\([^)]*(?:passphrase|ciphertext|req\.body)/i);
assert.match(backupControllers, /safeLogError/);
assert.match(backupControllers, /includeStack:\s*false/);

const originalConsoleError = console.error;
let capturedSafeLog;
try {
  console.error = (...args) => {
    capturedSafeLog = args;
  };
  safeLogError('backup test', new Error('sensitive parser detail'), { includeStack: false });
} finally {
  console.error = originalConsoleError;
}
assert.strictEqual(capturedSafeLog[1].stack, undefined);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullpassword-updater-request-'));
const validatorPath = path.join(repositoryRoot, 'scripts/validate-updater-request.js');
const requestId = '123e4567-e89b-42d3-a456-426614174000';
const validRequest = {
  request_id: requestId,
  requested_by_user_id: '123e4567-e89b-42d3-a456-426614174001',
  requested_by_email: 'admin@example.com',
  requested_at: new Date().toISOString(),
  ip: '192.0.2.10',
  user_agent: 'FullPassword test'
};

try {
  const validPath = path.join(tempDir, `${requestId}.json`);
  fs.writeFileSync(validPath, JSON.stringify(validRequest), { mode: 0o600 });
  assert.strictEqual(spawnSync(process.execPath, [validatorPath, validPath, requestId]).status, 0);

  const injectedPath = path.join(tempDir, 'injected.json');
  fs.writeFileSync(injectedPath, JSON.stringify({ ...validRequest, command: 'arbitrary-command' }), { mode: 0o600 });
  assert.notStrictEqual(spawnSync(process.execPath, [validatorPath, injectedPath, requestId]).status, 0);

  const mismatchedPath = path.join(tempDir, 'mismatched.json');
  fs.writeFileSync(mismatchedPath, JSON.stringify(validRequest), { mode: 0o600 });
  assert.notStrictEqual(
    spawnSync(process.execPath, [validatorPath, mismatchedPath, '223e4567-e89b-42d3-a456-426614174000']).status,
    0
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Operational hardening tests passed.');
