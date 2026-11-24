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
const servers = require('../src/services/spfblServersService');
const matrix = require('../src/services/spfblMatrixClient');
const controller = require('../src/controllers/spfblController');

const pg = new PGlite({ extensions: { uuid_ossp } });
// Existing ensure* helpers send multi-statement DDL; a prepared statement refuses it, so route it through exec.
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const response = () => ({ code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (user, extra = {}) => ({ user, params: {}, body: {}, get: () => 'test-agent', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra });

const MATRIX_SECRET = 'MATRIX_PASSWORD_SENTINEL_9f3a';
const WHM_SECRET = 'WHMTOKENSENTINEL0123456789ABCDEF';
const leaks = (value) => JSON.stringify(value ?? null).includes('SENTINEL');
const serverRow = async (id) => (await pg.query('SELECT * FROM spfbl_whm_servers WHERE id = $1', [id])).rows[0];

async function run() {
  await pg.exec(read('database/init.sql'));
  const adminId = '00000000-0000-0000-0000-0000000000a1';
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt) VALUES ($1,'T','admin@example.invalid','H','W','S')", [adminId]);
  const admin = { id: adminId, email: 'admin@example.invalid', role: 'admin', is_super_admin: true };
  await ensureSecuritySchema();
  const migration = read('database/migrations/33_spfbl_whm_servers.sql');
  await pg.exec(migration); await pg.exec(migration); // idempotent
  assert.deepEqual(await servers.listServers(), []);
  assert.ok(BACKUP_TABLES.includes('spfbl_whm_servers') && BACKUP_TABLES.indexOf('spfbl_whm_servers') < BACKUP_TABLES.indexOf('spfbl_domains'), 'servers are restored before the domains that point to them');

  // Validation: anything sent is checked, a bad value is an error and nothing is stored.
  const bad = async (input, code) => assert.rejects(servers.createServer(input, adminId), { code }, JSON.stringify(input).replace(/SENTINEL\w*/g, 'S'));
  const good = { name: 'Servidor 1', host: 'srv.example.com', whm_user: 'root', token: WHM_SECRET, matrix_user: 'ops@example.com', matrix_password: MATRIX_SECRET };
  await bad(null, 'SPFBL_SERVER_INVALID'); await bad([], 'SPFBL_SERVER_INVALID');
  for (const name of ['', '   ', 'x'.repeat(81), 'a<b', 'a\nb', 5]) await bad({ ...good, name }, 'SPFBL_SERVER_NAME_INVALID');
  for (const host of ['https://x.example.com', 'x.example.com:2087', '10.0.0.1', 'localhost', 'a b.example.com', 'x.example.com/path']) await bad({ ...good, host }, 'SPFBL_WHM_HOST_INVALID');
  await bad({ ...good, host: '' }, 'SPFBL_WHM_INCOMPLETE'); await bad({ ...good, whm_user: '' }, 'SPFBL_WHM_INCOMPLETE');
  for (const user of ['Root', 'root@example.com', '1root', 'a'.repeat(33), 'ro ot', 'root;x']) await bad({ ...good, whm_user: user }, 'SPFBL_WHM_USER_INVALID');
  for (const token of ['', 'short', 'has space 0123456789ABCDEF', 'a/b/0123456789ABCDEF', 'x'.repeat(257)]) await bad({ ...good, token }, 'SPFBL_WHM_TOKEN_INVALID');
  await bad({ ...good, matrix_password: '' }, 'SPFBL_MATRIX_INCOMPLETE'); await bad({ ...good, matrix_user: '' }, 'SPFBL_MATRIX_INCOMPLETE');
  assert.equal((await servers.listServers()).length, 0, 'nothing was stored');

  // Create: sealed, target-bound, never returned; the host is normalised; the token is trimmed.
  let created = await servers.createServer({ ...good, host: ' SRV.Example.COM ', token: ` ${WHM_SECRET} ` }, adminId);
  const srv1 = created.server;
  assert.equal(created.whm_token_changed, true); assert.equal(created.matrix_password_changed, true);
  assert.deepEqual(Object.keys(srv1).sort(), ['domains_active', 'domains_total', 'has_matrix_password', 'has_token', 'history_last_run_at', 'host', 'id', 'matrix_configured', 'matrix_user', 'name', 'sync_at', 'sync_status', 'updated_at', 'whm_user']);
  assert.equal(srv1.host, 'srv.example.com'); assert.equal(srv1.has_token, true); assert.equal(srv1.matrix_configured, true); assert.equal(leaks(srv1), false);
  const stored = await serverRow(srv1.id);
  for (const column of ['encrypted_token', 'encrypted_matrix_password']) assert.match(stored[column], /^[^:]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.equal(JSON.stringify(stored).includes('SENTINEL'), false, 'secrets are encrypted at rest');
  assert.deepEqual(await servers.getWhmCredentials(srv1.id), { host: 'srv.example.com', user: 'root', token: WHM_SECRET });
  assert.deepEqual({ ...(await servers.getMatrixCredentials(srv1.id)) }, { user: 'ops@example.com', password: MATRIX_SECRET, serverId: srv1.id });
  // A server without a Matrix connection is valid: it only lists domains.
  const srv2 = (await servers.createServer({ name: 'Servidor 2', host: 'two.example.com', whm_user: 'root', token: WHM_SECRET }, adminId)).server;
  assert.equal(srv2.matrix_configured, false);
  await assert.rejects(servers.getMatrixCredentials(srv2.id), { code: 'MATRIX_NOT_CONFIGURED', statusCode: 422 });
  // Uniqueness: name (any case), host+user, Matrix account.
  await bad({ ...good, name: 'servidor 1', host: 'x.example.com', matrix_user: 'a@example.com' }, 'SPFBL_SERVER_NAME_EXISTS');
  await bad({ ...good, name: 'Outro', matrix_user: 'a@example.com' }, 'SPFBL_SERVER_EXISTS');
  await bad({ ...good, name: 'Outro', host: 'x.example.com', matrix_user: 'OPS@example.com' }, 'SPFBL_MATRIX_IN_USE');

  // Edit: rename and token rotation keep everything else; changing host/user or the Matrix user asks for the secret again.
  let edited = await servers.updateServer(srv1.id, { name: 'Principal' }, adminId);
  assert.equal(edited.server.name, 'Principal'); assert.equal(edited.whm_token_changed, false); assert.equal((await servers.getWhmCredentials(srv1.id)).token, WHM_SECRET);
  await assert.rejects(servers.updateServer(srv1.id, { host: 'other.example.com' }, adminId), { code: 'SPFBL_SECRET_REENTRY_REQUIRED' });
  await assert.rejects(servers.updateServer(srv1.id, { whm_user: 'reseller1' }, adminId), { code: 'SPFBL_SECRET_REENTRY_REQUIRED' });
  await assert.rejects(servers.updateServer(srv1.id, { matrix_user: 'new@example.com' }, adminId), { code: 'SPFBL_SECRET_REENTRY_REQUIRED' });
  assert.equal((await serverRow(srv1.id)).host, 'srv.example.com', 'a refused change is not applied');
  await assert.rejects(servers.updateServer(srv1.id, { name: 'Servidor 2' }, adminId), { code: 'SPFBL_SERVER_NAME_EXISTS' });
  await assert.rejects(servers.updateServer(srv1.id, { token: 'short' }, adminId), { code: 'SPFBL_WHM_TOKEN_INVALID' });
  edited = await servers.updateServer(srv1.id, { host: 'other.example.com', token: WHM_SECRET }, adminId);
  assert.equal((await servers.getWhmCredentials(srv1.id)).host, 'other.example.com');
  edited = await servers.updateServer(srv1.id, { matrix_user: 'new@example.com', matrix_password: MATRIX_SECRET }, adminId);
  assert.equal(edited.matrix_user_changed, true); assert.equal(edited.previous_matrix_user, 'ops@example.com');
  edited = await servers.updateServer(srv2.id, { matrix_user: 'two@example.com', matrix_password: MATRIX_SECRET }, adminId);
  assert.equal(edited.server.matrix_configured, true, 'a Matrix connection can be added to a server later');
  await assert.rejects(servers.updateServer(srv2.id, { matrix_password: MATRIX_SECRET, matrix_user: '' }, adminId), { code: 'SPFBL_MATRIX_INCOMPLETE' });
  edited = await servers.updateServer(srv2.id, { remove_matrix: true }, adminId);
  assert.equal(edited.server.matrix_configured, false); assert.equal((await serverRow(srv2.id)).encrypted_matrix_password, null);
  await assert.rejects(servers.updateServer(srv2.id, { remove_matrix: 'yes' }, adminId), { code: 'SPFBL_SERVER_INVALID' });
  await assert.rejects(servers.updateServer('00000000-0000-0000-0000-00000000dead', {}, adminId), { code: 'SPFBL_SERVER_NOT_FOUND', statusCode: 404 });
  await assert.rejects(servers.updateServer('not-a-uuid', {}, adminId), { code: 'SPFBL_SERVER_NOT_FOUND' });

  // Target binding: a ciphertext copied to another host/user/purpose never opens into a usable secret.
  await pg.query("UPDATE spfbl_whm_servers SET host = 'attacker.example.net' WHERE id = $1", [srv1.id]);
  await assert.rejects(servers.getWhmCredentials(srv1.id), { code: 'SPFBL_CREDENTIAL_TARGET_MISMATCH' });
  await pg.query("UPDATE spfbl_whm_servers SET host = 'other.example.com' WHERE id = $1", [srv1.id]);
  await pg.query('UPDATE spfbl_whm_servers SET encrypted_token = encrypted_matrix_password WHERE id = $1', [srv1.id]);
  await assert.rejects(servers.getWhmCredentials(srv1.id), { code: 'SPFBL_CREDENTIAL_TARGET_MISMATCH' }, 'a Matrix ciphertext is not a WHM token');
  await pg.query("UPDATE spfbl_whm_servers SET encrypted_token = 'garbage' WHERE id = $1", [srv1.id]);
  await assert.rejects(servers.getWhmCredentials(srv1.id), { name: 'ConfigEncryptionError' });
  await servers.updateServer(srv1.id, { token: WHM_SECRET }, adminId);
  assert.equal((await servers.getWhmCredentials(srv1.id)).token, WHM_SECRET);

  // Removing asks what to do with the domains. Kept domains end up WITHOUT a server (history only); removed ones go with their access links.
  await assert.rejects(servers.removeServer(srv2.id, undefined), { code: 'SPFBL_REMOVE_CHOICE_REQUIRED', statusCode: 422 });
  await assert.rejects(servers.removeServer(srv2.id, 'yes'), { code: 'SPFBL_REMOVE_CHOICE_REQUIRED' });
  await pg.query("INSERT INTO spfbl_domains(name,source,server_id) VALUES ('keep.example.com','whm',$1),('gone.example.com','whm',$2),('gone2.example.com','whm',$2),('manual.example.com','manual',NULL)", [srv1.id, srv2.id]);
  assert.equal((await servers.listServers()).find((s) => s.id === srv2.id).domains_total, 2);
  const keptResult = await servers.removeServer(srv1.id, false);
  assert.deepEqual([keptResult.domains_kept, keptResult.domains_removed, keptResult.name], [1, 0, 'Principal']);
  const kept = (await pg.query("SELECT server_id, source, active FROM spfbl_domains WHERE name = 'keep.example.com'")).rows[0];
  assert.deepEqual([kept.server_id, kept.source, kept.active], [null, 'whm', true], 'the domain stays, active, without a query server');
  const goneResult = await servers.removeServer(srv2.id, true);
  assert.deepEqual([goneResult.domains_removed, goneResult.domains_kept], [2, 0]);
  assert.equal((await pg.query("SELECT 1 FROM spfbl_domains WHERE name LIKE 'gone%'")).rowCount, 0);
  assert.equal((await pg.query("SELECT 1 FROM spfbl_domains WHERE name IN ('keep.example.com','manual.example.com')")).rowCount, 2, 'other domains are untouched');
  assert.deepEqual(await servers.listServers(), []);
  await assert.rejects(servers.removeServer(srv2.id, true), { code: 'SPFBL_SERVER_NOT_FOUND' });

  // The old single server and Matrix connection are moved into the list, once (migration 33 / startup).
  await pg.query("UPDATE spfbl_settings SET whm_host = 'legacy.example.com', whm_user = 'root', matrix_user = 'legacy@example.com' WHERE id = 1");
  await pg.query("UPDATE spfbl_settings SET encrypted_whm_token = $1, encrypted_matrix_password = $2 WHERE id = 1", ['legacy-token', 'legacy-matrix']);
  await pg.query("INSERT INTO spfbl_domains(name,source) VALUES ('legacy-domain.example.com','whm')");
  await pg.exec(migration);
  const moved = (await pg.query("SELECT * FROM spfbl_whm_servers WHERE host = 'legacy.example.com'")).rows;
  assert.equal(moved.length, 1); assert.equal(moved[0].name, 'legacy.example.com'); assert.equal(moved[0].matrix_user, 'legacy@example.com'); assert.equal(moved[0].encrypted_token, 'legacy-token'); assert.equal(moved[0].encrypted_matrix_password, 'legacy-matrix');
  assert.equal((await pg.query("SELECT server_id FROM spfbl_domains WHERE name = 'legacy-domain.example.com'")).rows[0].server_id, moved[0].id, 'imported domains are linked to the moved server');
  const cleared = (await pg.query('SELECT whm_host, whm_user, encrypted_whm_token, matrix_user, encrypted_matrix_password FROM spfbl_settings WHERE id = 1')).rows[0];
  assert.deepEqual(Object.values(cleared), ['', '', null, '', null], 'the legacy columns are cleared once moved');
  await pg.exec(migration); assert.equal((await pg.query('SELECT 1 FROM spfbl_whm_servers')).rowCount, 1, 'running it again changes nothing, even after the admin removes the server');
  await servers.removeServer(moved[0].id, true); await pg.exec(migration);
  assert.equal((await pg.query('SELECT 1 FROM spfbl_whm_servers')).rowCount, 0, 'a removed server does not come back from the legacy columns');
  await pg.query("DELETE FROM spfbl_domains WHERE name = 'legacy-domain.example.com'");
  const sealed = await servers.createServer({ ...good, name: 'Servidor A' }, adminId); const A = sealed.server.id;

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
  await assert.rejects(matrix.request('delete', creds, { transport: answer(200, { result: 'VALID' }) }), { code: 'MATRIX_ENDPOINT_FORBIDDEN', statusCode: 403 }, 'only the reviewed endpoints exist');
  // Mutations are confirmed only by DONE + the exact information; a plain VALID answer (or the other mutation's wording) is "not confirmed".
  await assert.rejects(matrix.request('white', creds, { transport: answer(200, { result: 'VALID' }) }), { code: 'MATRIX_MUTATION_NOT_CONFIRMED' });
  await assert.rejects(matrix.request('white', creds, { transport: answer(200, { result: 'DONE', information: 'sender blocked' }) }), { code: 'MATRIX_MUTATION_NOT_CONFIRMED' });
  assert.equal((await matrix.request('white', creds, { transport: answer(200, { result: 'DONE', information: 'sender whitelisted' }) })).data.information, 'sender whitelisted');
  await assert.rejects(matrix.testConnection({ user: '', password: 'x' }, { transport: answer(200, {}) }), { code: 'MATRIX_NOT_CONFIGURED', statusCode: 422 });

  // Controller: audit trail holds no secrets, hosts or users; responses never carry credentials.
  const user = admin;
  let res = response();
  await controller.createWhmServer(request(user, { body: { name: 'Servidor B', host: 'b.example.com', whm_user: 'root', token: WHM_SECRET, matrix_user: 'b@example.com', matrix_password: MATRIX_SECRET } }), res);
  assert.equal(res.code, 201); assert.equal(leaks(res.body), false); const B = res.body.server.id;
  res = response();
  await controller.createWhmServer(request(user, { body: { name: 'Ruim', host: 'https://x.example.com', whm_user: 'root', token: WHM_SECRET } }), res);
  assert.equal(res.code, 400); assert.equal(res.body.code, 'SPFBL_WHM_HOST_INVALID'); assert.equal(leaks(res.body), false);
  res = response(); await controller.updateWhmServer(request(user, { params: { id: B }, body: { name: 'Servidor B2' } }), res);
  assert.equal(res.code, 200); assert.equal(res.body.server.name, 'Servidor B2');
  res = response(); await controller.listWhmServers(request(user), res);
  assert.equal(res.code, 200); assert.equal(res.body.servers.length, 2); assert.equal(leaks(res.body), false);
  assert.ok(res.body.servers.every((s) => !('encrypted_token' in s) && !('token' in s) && !('matrix_password' in s)));
  res = response(); await controller.removeWhmServer(request(user, { params: { id: B }, body: {} }), res);
  assert.equal(res.code, 422); assert.equal(res.body.code, 'SPFBL_REMOVE_CHOICE_REQUIRED', 'the choice about the domains is mandatory');
  res = response(); await controller.removeWhmServer(request(user, { params: { id: B }, body: { remove_domains: false } }), res);
  assert.equal(res.code, 200); assert.deepEqual([res.body.domains_removed, res.body.domains_kept], [0, 0]);
  const audit = (await pg.query("SELECT action, status, metadata FROM system_audit_events WHERE action LIKE 'spfbl_whm_server_%' ORDER BY created_at, id")).rows;
  assert.deepEqual(audit.map((e) => `${e.action}:${e.status}`), ['spfbl_whm_server_added:success', 'spfbl_whm_server_added:failed', 'spfbl_whm_server_updated:success', 'spfbl_whm_server_removed:failed', 'spfbl_whm_server_removed:success']);
  assert.deepEqual(audit[0].metadata, { server: 'Servidor B', matrix_password_changed: true, whm_token_changed: true });
  assert.deepEqual(audit[4].metadata, { server: 'Servidor B2', remove_domains: false, domains_removed: 0, domains_kept: 0 });
  assert.equal(JSON.stringify(audit).includes('example.com'), false, 'no hosts or users in the audit trail');
  assert.equal(leaks(audit), false);

  // Matrix test endpoint: single-flight, cool-down (also after failures), audited with fixed tokens only.
  const realTest = matrix.testConnection;
  controller.resetTestState();
  matrix.testConnection = async () => ({ ok: true, diagnostic: 'history HTTP=200 result=VALID info=VALID_CREDENTIAL' });
  res = response(); await controller.testMatrix(request(user, { params: { id: A } }), res);
  assert.equal(res.code, 200); assert.equal(res.body.ok, true);
  res = response(); await controller.testMatrix(request(user, { params: { id: A } }), res);
  assert.equal(res.code, 429); assert.equal(res.body.code, 'SPFBL_TEST_COOLDOWN'); assert.ok(res.body.retry_after_seconds >= 1 && res.body.retry_after_seconds <= 30);
  controller.resetTestState();
  matrix.testConnection = async () => { throw new matrix.MatrixError('O Matrix recusou a autenticação. Revise o usuário e a senha.', 'MATRIX_AUTH_REFUSED', 422, 'history HTTP=200 result=INVALID info=INVALID_CREDENTIAL'); };
  res = response(); await controller.testMatrix(request(user, { params: { id: A } }), res);
  assert.equal(res.code, 422); assert.equal(res.body.code, 'MATRIX_AUTH_REFUSED');
  res = response(); await controller.testMatrix(request(user, { params: { id: A } }), res);
  assert.equal(res.code, 429, 'a failed test also starts the cool-down');
  controller.resetTestState();
  let release; matrix.testConnection = () => new Promise((resolve) => { release = resolve; });
  const first = (async () => { const r = response(); await controller.testMatrix(request(user, { params: { id: A } }), r); return r; })();
  await new Promise((resolve) => setTimeout(resolve, 20));
  res = response(); await controller.testMatrix(request(user, { params: { id: A } }), res);
  assert.equal(res.code, 429); assert.equal(res.body.code, 'SPFBL_TEST_BUSY');
  release({ ok: true, diagnostic: 'history HTTP=200 result=VALID info=VALID_CREDENTIAL' });
  assert.equal((await first).code, 200);
  controller.resetTestState();
  matrix.testConnection = realTest;
  await servers.updateServer(A, { remove_matrix: true }, adminId);
  res = response(); await controller.testMatrix(request(user, { params: { id: A } }), res);
  assert.equal(res.code, 422); assert.equal(res.body.code, 'MATRIX_NOT_CONFIGURED');
  const testAudit = (await pg.query("SELECT status, metadata FROM system_audit_events WHERE action = 'spfbl_matrix_test' ORDER BY created_at, id")).rows;
  assert.deepEqual(testAudit.map((e) => e.status), ['success', 'failed', 'success', 'failed']);
  assert.deepEqual(testAudit[1].metadata, { reason: 'MATRIX_AUTH_REFUSED', diagnostic: 'history HTTP=200 result=INVALID info=INVALID_CREDENTIAL' });
  assert.equal(leaks(testAudit), false);

  // Wiring: authenticate, then module toggle, then Super Admin (+ reauth for writes, limiter for the test).
  const routes = read('backend/src/routes/spfblRoutes.js');
  assert.ok(routes.indexOf('router.use(verifyToken)') < routes.indexOf("router.use(requireModuleEnabled('spfbl'))") && routes.indexOf("router.use(requireModuleEnabled('spfbl'))") < routes.indexOf("router.get('/whm-servers'"));
  assert.match(routes, /router\.get\('\/whm-servers', requireSuperAdmin,/);
  for (const line of ["router.post('/whm-servers', requireSuperAdmin, guardFixed('spfbl_settings')", "router.put('/whm-servers/:id', requireSuperAdmin, uuidParam('id'), guardFixed('spfbl_settings')", "router.delete('/whm-servers/:id', requireSuperAdmin, uuidParam('id'), guardFixed('spfbl_settings')"]) assert.ok(routes.includes(line), `${line} needs the reauthentication grant`);
  assert.match(routes, /router\.post\('\/whm-servers\/:id\/matrix\/test', requireSuperAdmin, uuidParam\('id'\), spfblTestLimiter,/);
  assert.equal((routes.match(/router\.(get|put|post|delete|patch)\(/g) || []).length, 33, 'every route must be reviewed here (domains: test-spfbl-whm.js, access: test-spfbl-access.js)');
  const server = read('backend/src/server.js');
  assert.ok(server.indexOf("app.use('/api/spfbl', require('./routes/spfblRoutes'))") < server.indexOf("function apiNotFound"));
  // sensitiveOperationLimiter allows 5 mutations per 15 min (sized for backup export): wrong for routine admin work.
  assert.doesNotMatch(server, /app\.use\('\/api\/spfbl', sensitiveOperationLimiter\)/);
  assert.match(server, /app\.use\(\[[^\]]*'\/api\/spfbl'[^\]]*\], generalWriteLimiter\)/, 'the normal 60/min write limiter covers the module');
  assert.match(read('backend/src/services/reauthService.js'), /\^spfbl_settings\$/);
  console.log('PASS spfbl settings: encrypted+target-bound credentials, no secrets in responses/audit, Matrix adapter contract (simulated), single-flight test with cool-down.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await pg.close(); await db.pool.end(); });
