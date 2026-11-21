const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
Object.assign(process.env, {
  DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'TEST_ONLY_PASSWORD', DB_NAME: 'test',
  JWT_SECRET: 'TEST_ONLY_JWT_'.repeat(8), ADMIN_BOOTSTRAP_TOKEN: 'TEST_BOOTSTRAP_'.repeat(6),
  APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid', NODE_ENV: 'production',
  BACKEND_APP_COMMIT: 'a'.repeat(40), CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64')
});
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
const db = require('../src/config/database');
const { ensureSecuritySchema } = require('../src/config/securitySchema');
const { BACKUP_TABLES } = require('../src/config/backupTables');
const settings = require('../src/services/spfblSettingsService');
const matrix = require('../src/services/spfblMatrixClient');
const controller = require('../src/controllers/spfblController');

const pg = new PGlite({ extensions: { uuid_ossp } });
// Existing ensure* helpers send multi-statement DDL; a prepared statement refuses it, so route it through exec.
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (user, extra = {}) => ({ user, params: {}, body: {}, get: () => 'test-agent', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra });

const MATRIX_SECRET = 'MATRIX_PASSWORD_SENTINEL_9f3a';
const WHM_SECRET = 'WHMTOKENSENTINEL0123456789ABCDEF';
const leaks = (value) => JSON.stringify(value ?? null).includes('SENTINEL');
const raw = async () => (await pg.query('SELECT * FROM spfbl_settings WHERE id = 1')).rows[0];

async function run() {
  await pg.exec(read('database/init.sql'));
  const adminId = '00000000-0000-0000-0000-0000000000a1';
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt) VALUES ($1,'T','admin@example.invalid','H','W','S')", [adminId]);
  const admin = { id: adminId, email: 'admin@example.invalid', role: 'admin', is_super_admin: true };

  // Schema: fresh install, idempotent ensure and standalone migration keep the saved row.
  assert.deepEqual(await settings.getSettings(), { matrix_user: '', has_matrix_password: false, whm_host: '', whm_user: '', has_whm_token: false, domain_sync_at: null, domain_sync_status: null, updated_at: (await raw()).updated_at });
  await settings.updateSettings({ matrix_user: 'ops@example.com' }, adminId);
  await ensureSecuritySchema();
  const migration = read('database/migrations/26_create_spfbl_settings.sql');
  await pg.exec(migration); await pg.exec(migration);
  assert.equal((await raw()).matrix_user, 'ops@example.com');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM spfbl_settings')).rows[0].n, 1);
  await assert.rejects(pg.query('INSERT INTO spfbl_settings(id) VALUES (2)'));
  assert.ok(BACKUP_TABLES.includes('spfbl_settings') && BACKUP_TABLES.indexOf('spfbl_settings') > BACKUP_TABLES.indexOf('users'));
  await settings.updateSettings({ matrix_user: '', remove_matrix_credentials: true }, adminId);

  // Validation: only exact types and shapes.
  const bad = (input, code) => assert.throws(() => settings.normalizeSettings(input), code ? { code } : { name: 'SpfblSettingsError' });
  for (const input of [null, [], 'x', 5]) bad(input);
  bad({ matrix_user: 5 }); bad({ matrix_user: 'a b@example.com' }); bad({ matrix_user: 'x'.repeat(255) });
  bad({ matrix_password: 12345 }); bad({ matrix_user: 'u@example.com', matrix_password: 'line\nbreak' });
  bad({ remove_matrix_credentials: 'true' }); bad({ remove_whm_token: 1 });
  for (const host of ['https://srv.example.com', 'srv.example.com:2087', 'srv.example.com/path', '203.0.113.10', 'localhost', 'srv', 'bad host.example.com', '-a.example.com', 'srv.example.com.', 'user@srv.example.com']) {
    bad({ whm_host: host, whm_user: 'root' }, 'SPFBL_WHM_HOST_INVALID');
  }
  for (const user of ['Root', 'root@example.com', '1root', 'a'.repeat(33), 'ro ot', 'root;x']) bad({ whm_host: 'srv.example.com', whm_user: user }, 'SPFBL_WHM_USER_INVALID');
  bad({ whm_host: 'srv.example.com' }, 'SPFBL_WHM_INCOMPLETE'); bad({ whm_user: 'root' }, 'SPFBL_WHM_INCOMPLETE');
  for (const token of ['short', 'has space 0123456789ABCDEF', 'bad/char/0123456789ABCDEF', 'x'.repeat(257), 'tok;en0123456789ABCDEF']) {
    bad({ whm_host: 'srv.example.com', whm_user: 'root', whm_token: token }, 'SPFBL_WHM_TOKEN_INVALID');
  }
  assert.equal(settings.normalizeSettings({ whm_host: ' SRV.Example.COM ', whm_user: 'root' }).whm_host, 'srv.example.com');

  // Save: secrets are encrypted, bound to their target, and never come back.
  let result = await settings.updateSettings({ matrix_user: 'ops@example.com', matrix_password: MATRIX_SECRET, whm_host: 'srv.example.com', whm_user: 'root', whm_token: WHM_SECRET }, adminId);
  assert.equal(result.matrix_password_changed, true); assert.equal(result.whm_token_changed, true);
  assert.deepEqual({ ...result.settings, updated_at: undefined }, { matrix_user: 'ops@example.com', has_matrix_password: true, whm_host: 'srv.example.com', whm_user: 'root', has_whm_token: true, domain_sync_at: null, domain_sync_status: null, updated_at: undefined });
  assert.equal(leaks(result), false);
  const stored = await raw();
  assert.equal(leaks(stored), false, 'plaintext secrets must not be stored');
  for (const column of ['encrypted_matrix_password', 'encrypted_whm_token']) assert.match(stored[column], /^[^:]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.deepEqual(await settings.getMatrixCredentials(), { user: 'ops@example.com', password: MATRIX_SECRET });
  assert.deepEqual(await settings.getWhmCredentials(), { host: 'srv.example.com', user: 'root', token: WHM_SECRET });
  assert.equal(await settings.updateSettings({ matrix_password: '' }, adminId).then((r) => r.settings.has_matrix_password), true, 'an empty password keeps the saved one');
  assert.equal(leaks((await settings.getSettings())), false);

  // Passwords are kept exactly as typed (no trimming); tokens are trimmed.
  await settings.updateSettings({ matrix_password: ` ${MATRIX_SECRET} `, whm_token: ` ${WHM_SECRET} ` }, adminId);
  assert.equal((await settings.getMatrixCredentials()).password, ` ${MATRIX_SECRET} `);
  assert.equal((await settings.getWhmCredentials()).token, WHM_SECRET);

  // Secret binding (R-06 style): a saved secret never follows the account to a new target.
  await assert.rejects(settings.updateSettings({ matrix_user: 'other@example.com' }, adminId), { code: 'SPFBL_SECRET_REENTRY_REQUIRED' });
  await assert.rejects(settings.updateSettings({ whm_host: 'other.example.com' }, adminId), { code: 'SPFBL_SECRET_REENTRY_REQUIRED' });
  await assert.rejects(settings.updateSettings({ whm_user: 'reseller1' }, adminId), { code: 'SPFBL_SECRET_REENTRY_REQUIRED' });
  assert.equal((await raw()).whm_host, 'srv.example.com', 'a refused change must not be applied');
  await settings.updateSettings({ matrix_user: 'other@example.com', matrix_password: MATRIX_SECRET }, adminId);
  assert.equal((await settings.getMatrixCredentials()).user, 'other@example.com');
  await settings.updateSettings({ whm_host: 'other.example.com', whm_token: WHM_SECRET }, adminId);
  assert.equal((await settings.getWhmCredentials()).host, 'other.example.com');
  // The ciphertext is bound inside the authenticated plaintext: tampering with the row is detected.
  await pg.query("UPDATE spfbl_settings SET whm_host = 'attacker.example.net' WHERE id = 1");
  await assert.rejects(settings.getWhmCredentials(), { code: 'SPFBL_CREDENTIAL_TARGET_MISMATCH' });
  await pg.query("UPDATE spfbl_settings SET whm_host = 'other.example.com' WHERE id = 1");
  await pg.query('UPDATE spfbl_settings SET encrypted_whm_token = encrypted_matrix_password WHERE id = 1');
  await assert.rejects(settings.getWhmCredentials(), { code: 'SPFBL_CREDENTIAL_TARGET_MISMATCH' }, 'a Matrix ciphertext is not a WHM token');
  await pg.query("UPDATE spfbl_settings SET encrypted_whm_token = 'garbage' WHERE id = 1");
  await assert.rejects(settings.getWhmCredentials(), { name: 'ConfigEncryptionError' });
  await settings.updateSettings({ whm_token: WHM_SECRET }, adminId);

  // Removal: explicit flag, or clearing the target, drops the secret with it.
  await settings.updateSettings({ remove_whm_token: true }, adminId);
  assert.equal((await settings.getSettings()).has_whm_token, false);
  await assert.rejects(settings.getWhmCredentials(), { code: 'WHM_NOT_CONFIGURED', statusCode: 422 });
  await settings.updateSettings({ whm_token: WHM_SECRET }, adminId);
  await settings.updateSettings({ whm_host: '', whm_user: '' }, adminId);
  const cleared = await raw();
  assert.equal(cleared.encrypted_whm_token, null); assert.equal(cleared.whm_host, '');
  await settings.updateSettings({ matrix_user: '' }, adminId);
  assert.equal((await raw()).encrypted_matrix_password, null);
  await assert.rejects(settings.getMatrixCredentials(), { code: 'MATRIX_NOT_CONFIGURED' });

  // Matrix adapter with a simulated transport (never run against the real provider).
  const creds = { user: 'ops@example.com', password: MATRIX_SECRET };
  const answer = (status, body) => async () => ({ status, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const ok = await matrix.testConnection(creds, { transport: answer(200, { result: 'VALID', information: 'valid credential', message: [] }) });
  assert.equal(ok.ok, true); assert.equal(ok.diagnostic, 'history HTTP=200 result=VALID info=VALID_CREDENTIAL');
  let seen;
  await matrix.testConnection(creds, { transport: async (call) => { seen = call; return { status: 200, body: JSON.stringify({ result: 'VALID', message: [{ x: 1 }] }) }; } });
  assert.equal(seen.endpoint, 'history');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen.query)), { user: 'ops@example.com', password: MATRIX_SECRET });
  const fails = async (transport, code, status) => {
    const error = await matrix.testConnection(creds, { transport }).then(() => null, (e) => e);
    assert.ok(error instanceof matrix.MatrixError, String(error)); assert.equal(error.code, code);
    if (status) assert.equal(error.statusCode, status);
    assert.equal(leaks(error.message) || leaks(error.diagnostic) || error.message.includes('example.com') || error.diagnostic.includes('example.com'), false, 'no credentials or URLs in errors');
    return error;
  };
  await fails(answer(200, { result: 'INVALID', information: 'invalid credential' }), 'MATRIX_AUTH_REFUSED', 422);
  await fails(answer(200, { result: 'EXPIRED' }), 'MATRIX_AUTH_REFUSED', 422);
  const unknown = await fails(answer(200, { result: 'WHATEVER', information: `echo ${MATRIX_SECRET}` }), 'MATRIX_NOT_CONFIRMED');
  assert.equal(unknown.diagnostic, 'history HTTP=200 result=OTHER info=OTHER', 'unknown provider text is reduced to fixed tokens');
  await fails(answer(200, { result: 'VALID', message: { a: 1 } }), 'MATRIX_INVALID_SHAPE');
  await fails(answer(200, { message: [] }), 'MATRIX_NOT_CONFIRMED');
  await fails(answer(500, `boom ${MATRIX_SECRET}`), 'MATRIX_HTTP_UNEXPECTED');
  await fails(answer(302, ''), 'MATRIX_HTTP_UNEXPECTED');
  await fails(answer(200, 'not json'), 'MATRIX_INVALID_JSON');
  await fails(answer(200, '[1,2]'), 'MATRIX_INVALID_SHAPE');
  await fails(answer(200, 'null'), 'MATRIX_INVALID_SHAPE');
  await fails(answer(200, 'x'.repeat(4 * 1024 * 1024 + 1)), 'MATRIX_RESPONSE_TOO_LARGE');
  await fails(async () => { throw new Error(`socket hang up for ${MATRIX_SECRET}`); }, 'MATRIX_CONNECTION_FAILED');
  await assert.rejects(matrix.request('white', creds, { transport: answer(200, { result: 'VALID' }) }), { code: 'MATRIX_ENDPOINT_FORBIDDEN', statusCode: 403 });
  await assert.rejects(matrix.testConnection({ user: '', password: 'x' }, { transport: answer(200, {}) }), { code: 'MATRIX_NOT_CONFIGURED', statusCode: 422 });

  // Controller: audit trail holds no secrets, hosts or users; responses never carry credentials.
  const user = admin;
  let res = response();
  await controller.saveSettings(request(user, { body: { matrix_user: 'ops@example.com', matrix_password: MATRIX_SECRET, whm_host: 'srv.example.com', whm_user: 'root', whm_token: WHM_SECRET } }), res);
  assert.equal(res.code, 200); assert.equal(leaks(res.body), false);
  res = response();
  await controller.saveSettings(request(user, { body: { whm_host: 'https://x.example.com', whm_user: 'root', whm_token: WHM_SECRET } }), res);
  assert.equal(res.code, 400); assert.equal(res.body.code, 'SPFBL_WHM_HOST_INVALID'); assert.equal(leaks(res.body), false);
  res = response(); await controller.getSettings(request(user), res);
  assert.equal(res.code, 200); assert.equal(res.body.has_matrix_password, true); assert.equal(leaks(res.body), false);
  const audit = (await pg.query("SELECT action, status, metadata FROM system_audit_events WHERE action LIKE 'spfbl_%' ORDER BY created_at, id")).rows;
  assert.deepEqual(audit.map((e) => `${e.action}:${e.status}`), ['spfbl_settings_updated:success', 'spfbl_settings_updated:failed']);
  assert.deepEqual(audit[0].metadata, { matrix_password_changed: true, whm_token_changed: true, matrix_configured: true, whm_configured: true });
  assert.equal(JSON.stringify(audit).includes('example.com'), false, 'no hosts or users in the audit trail');
  assert.equal(leaks(audit), false);

  // Matrix test endpoint: single-flight, cool-down (also after failures), audited with fixed tokens only.
  const realTest = matrix.testConnection;
  controller.resetTestState();
  matrix.testConnection = async () => ({ ok: true, diagnostic: 'history HTTP=200 result=VALID info=VALID_CREDENTIAL' });
  res = response(); await controller.testMatrix(request(user), res);
  assert.equal(res.code, 200); assert.equal(res.body.ok, true);
  res = response(); await controller.testMatrix(request(user), res);
  assert.equal(res.code, 429); assert.equal(res.body.code, 'SPFBL_TEST_COOLDOWN'); assert.ok(res.body.retry_after_seconds >= 1 && res.body.retry_after_seconds <= 30);
  controller.resetTestState();
  matrix.testConnection = async () => { throw new matrix.MatrixError('O Matrix recusou a autenticação. Revise o usuário e a senha.', 'MATRIX_AUTH_REFUSED', 422, 'history HTTP=200 result=INVALID info=INVALID_CREDENTIAL'); };
  res = response(); await controller.testMatrix(request(user), res);
  assert.equal(res.code, 422); assert.equal(res.body.code, 'MATRIX_AUTH_REFUSED');
  res = response(); await controller.testMatrix(request(user), res);
  assert.equal(res.code, 429, 'a failed test also starts the cool-down');
  controller.resetTestState();
  let release; matrix.testConnection = () => new Promise((resolve) => { release = resolve; });
  const first = (async () => { const r = response(); await controller.testMatrix(request(user), r); return r; })();
  await new Promise((resolve) => setTimeout(resolve, 20));
  res = response(); await controller.testMatrix(request(user), res);
  assert.equal(res.code, 429); assert.equal(res.body.code, 'SPFBL_TEST_BUSY');
  release({ ok: true, diagnostic: 'history HTTP=200 result=VALID info=VALID_CREDENTIAL' });
  assert.equal((await first).code, 200);
  controller.resetTestState();
  matrix.testConnection = realTest;
  await settings.updateSettings({ matrix_user: '' }, adminId);
  res = response(); await controller.testMatrix(request(user), res);
  assert.equal(res.code, 422); assert.equal(res.body.code, 'MATRIX_NOT_CONFIGURED');
  const testAudit = (await pg.query("SELECT status, metadata FROM system_audit_events WHERE action = 'spfbl_matrix_test' ORDER BY created_at, id")).rows;
  assert.deepEqual(testAudit.map((e) => e.status), ['success', 'failed', 'success', 'failed']);
  assert.deepEqual(testAudit[1].metadata, { reason: 'MATRIX_AUTH_REFUSED', diagnostic: 'history HTTP=200 result=INVALID info=INVALID_CREDENTIAL' });
  assert.equal(leaks(testAudit), false);

  // Wiring: authenticate, then module toggle, then Super Admin (+ reauth for writes, limiter for the test).
  const routes = read('backend/src/routes/spfblRoutes.js');
  assert.ok(routes.indexOf('router.use(verifyToken)') < routes.indexOf("router.use(requireModuleEnabled('spfbl'))") && routes.indexOf("router.use(requireModuleEnabled('spfbl'))") < routes.indexOf("router.get('/settings'"));
  assert.match(routes, /router\.get\('\/settings', requireSuperAdmin,/);
  assert.match(routes, /router\.put\('\/settings', requireSuperAdmin, guardFixed\('spfbl_settings'\),/);
  assert.match(routes, /router\.post\('\/matrix\/test', requireSuperAdmin, spfblTestLimiter,/);
  assert.equal((routes.match(/router\.(get|put|post|delete|patch)\(/g) || []).length, 12, 'every route must be reviewed here (domains: test-spfbl-whm.js, access: test-spfbl-access.js)');
  const server = read('backend/src/server.js');
  assert.ok(server.indexOf("app.use('/api/spfbl', require('./routes/spfblRoutes'))") < server.indexOf("function apiNotFound"));
  assert.match(server, /app\.use\('\/api\/spfbl', sensitiveOperationLimiter\)/);
  assert.match(read('backend/src/services/reauthService.js'), /\^spfbl_settings\$/);
  console.log('PASS spfbl settings: encrypted+target-bound credentials, no secrets in responses/audit, Matrix adapter contract (simulated), single-flight test with cool-down.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await pg.close(); await db.pool.end(); });
