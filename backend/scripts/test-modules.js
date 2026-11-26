const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
Object.assign(process.env, {
  DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'TEST_ONLY_PASSWORD', DB_NAME: 'test',
  JWT_SECRET: 'TEST_ONLY_JWT_'.repeat(8), ADMIN_BOOTSTRAP_TOKEN: 'TEST_BOOTSTRAP_'.repeat(6),
  APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid', NODE_ENV: 'production',
  BACKEND_APP_COMMIT: 'a'.repeat(40)
});
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
const db = require('../src/config/database');
const { ensureSecuritySchema } = require('../src/config/securitySchema');
const { BACKUP_TABLES } = require('../src/config/backupTables');
const service = require('../src/services/modulesService');
const controller = require('../src/controllers/modulesController');

const pg = new PGlite({ extensions: { uuid_ossp } });
// Some existing ensure* helpers send multi-statement DDL. A prepared statement refuses it (and would abort the
// transaction), while real PostgreSQL's simple query protocol accepts it: route those through exec up front.
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (user, extra = {}) => ({ user, params: {}, body: {}, get: () => 'test-agent', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra });

async function run() {
  await pg.exec(read('database/init.sql'));
  const adminId = '00000000-0000-0000-0000-0000000000a1';
  const userId = '00000000-0000-0000-0000-0000000000b2';
  for (const [id, email] of [[adminId, 'admin@example.invalid'], [userId, 'user@example.invalid']]) {
    await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt) VALUES ($1,'T',$2,'H','W','S')", [id, email]);
  }
  const superAdmin = { id: adminId, email: 'admin@example.invalid', role: 'admin', is_super_admin: true };
  const ordinary = { id: userId, email: 'user@example.invalid', role: 'user', is_super_admin: false };
  const ordinaryAdmin = { id: userId, email: 'user@example.invalid', role: 'admin', is_super_admin: false };

  // Fresh install: the registry exists and every module starts disabled.
  assert.deepEqual((await pg.query('SELECT module_key, enabled FROM system_modules')).rows, [{ module_key: 'spfbl', enabled: false }, { module_key: 'domain_manager', enabled: false }]);
  assert.equal(await service.isModuleEnabled('spfbl'), false);

  // Upgrade path: both the runtime ensure and the standalone migration are idempotent and keep the state.
  await ensureSecuritySchema();
  const enabled = await service.setModuleEnabled('spfbl', true, adminId);
  assert.equal(enabled.enabled, true);
  await ensureSecuritySchema();
  const migration = read('database/migrations/25_create_system_modules.sql');
  await pg.exec(migration); await pg.exec(migration);
  assert.equal(await service.isModuleEnabled('spfbl'), true, 'ensure/migration must not reset the toggle');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM system_modules')).rows[0].n, 2);
  await assert.rejects(pg.query("INSERT INTO system_modules(module_key) VALUES ('Bad Key')"));
  await assert.rejects(pg.query("INSERT INTO system_modules(module_key,updated_by) VALUES ('other','00000000-0000-0000-0000-00000000ffff')"));

  // Only catalogued modules, only real booleans.
  for (const key of ['nope', '__proto__', 'constructor', 'toString', '', null, undefined, ['spfbl'], { toString: () => 'spfbl' }]) {
    await assert.rejects(service.setModuleEnabled(key, true, adminId), { code: 'MODULE_UNKNOWN', statusCode: 404 });
    await assert.rejects(service.isModuleEnabled(key), { code: 'MODULE_UNKNOWN' });
  }
  for (const value of ['true', 1, 0, null, undefined, 'false', {}]) {
    await assert.rejects(service.setModuleEnabled('spfbl', value, adminId), { code: 'MODULE_STATE_INVALID' });
  }
  assert.equal(await service.isModuleEnabled('spfbl'), true);
  const listed = await service.listModules();
  assert.deepEqual(listed.map((m) => [m.key, m.name, m.enabled]), [['spfbl', 'SPFBL', true], ['domain_manager', 'Domain Manager', false]]);

  // Menu: booleans only; disabled => nobody; enabled => Super Admin; others only through a registered grant check.
  await service.setModuleEnabled('spfbl', false, adminId);
  assert.deepEqual(await service.getMenuModules(superAdmin), { spfbl: false, domain_manager: false });
  await service.setModuleEnabled('spfbl', true, adminId);
  assert.deepEqual(await service.getMenuModules(superAdmin), { spfbl: true, domain_manager: false });
  assert.deepEqual(await service.getMenuModules(ordinary), { spfbl: false, domain_manager: false });
  assert.deepEqual(await service.getMenuModules(ordinaryAdmin), { spfbl: false, domain_manager: false }, 'an admin who is not Super Admin has no implicit access');
  assert.deepEqual(await service.getMenuModules({ role: 'admin', is_super_admin: true }), { spfbl: false, domain_manager: false }, 'no user id, no access');
  let granted = false;
  service.registerUserAccessCheck('spfbl', async (user) => granted && user.id === userId);
  assert.deepEqual(await service.getMenuModules(ordinary), { spfbl: false, domain_manager: false });
  granted = true;
  assert.deepEqual(await service.getMenuModules(ordinary), { spfbl: true, domain_manager: false });
  await service.setModuleEnabled('spfbl', false, adminId);
  assert.deepEqual(await service.getMenuModules(ordinary), { spfbl: false, domain_manager: false }, 'a grant does not outlive a disabled module');
  assert.throws(() => service.registerUserAccessCheck('nope', async () => true), { code: 'MODULE_UNKNOWN' });
  service.registerUserAccessCheck('spfbl', async () => false);

  // Every route of a module is refused while the module is off.
  let nextCalled = false; let nextError;
  let res = response();
  await service.requireModuleEnabled('spfbl')(request(superAdmin), res, (error) => { nextCalled = true; nextError = error; });
  assert.equal(res.code, 404); assert.equal(res.body.code, 'MODULE_DISABLED'); assert.equal(nextCalled, false);
  await service.setModuleEnabled('spfbl', true, adminId);
  res = response();
  await service.requireModuleEnabled('spfbl')(request(superAdmin), res, (error) => { nextCalled = true; nextError = error; });
  assert.equal(nextCalled, true); assert.equal(nextError, undefined);
  await assert.rejects(service.requireModuleEnabled('nope')(request(superAdmin), response(), (error) => { throw error; }), { code: 'MODULE_UNKNOWN' });

  // Controller: toggle, validation and audit trail (no secrets, only module + state).
  res = response();
  await controller.setState(request(superAdmin, { params: { key: 'spfbl' }, body: { enabled: false } }), res);
  assert.equal(res.code, 200); assert.equal(res.body.module.enabled, false);
  res = response();
  await controller.setState(request(superAdmin, { params: { key: 'spfbl' }, body: { enabled: 'yes' } }), res);
  assert.equal(res.code, 400); assert.equal(res.body.code, 'MODULE_STATE_INVALID');
  res = response();
  await controller.setState(request(superAdmin, { params: { key: 'nope' }, body: { enabled: true } }), res);
  assert.equal(res.code, 404);
  const audit = (await pg.query("SELECT status, metadata FROM system_audit_events WHERE action='system_module_toggled' ORDER BY created_at, id")).rows;
  assert.deepEqual(audit.map((e) => e.status), ['success', 'failed', 'failed']);
  assert.deepEqual(audit[0].metadata, { module: 'spfbl', enabled: false });
  res = response(); await controller.list(request(superAdmin), res);
  assert.equal(res.code, 200); assert.equal(res.body.modules[0].enabled, false);
  res = response(); await controller.menu(request(superAdmin), res);
  assert.deepEqual(res.body, { modules: { spfbl: false, domain_manager: false } });

  // Backup/restore registry and wiring.
  assert.ok(BACKUP_TABLES.includes('system_modules'));
  assert.ok(BACKUP_TABLES.indexOf('system_modules') > BACKUP_TABLES.indexOf('users'), 'restored after users (FK updated_by)');
  const routes = read('backend/src/routes/systemRoutes.js');
  assert.match(routes, /router\.get\('\/modules\/menu', asyncRoute\(modulesController\.menu\)\)/);
  assert.match(routes, /router\.get\('\/modules', requireSuperAdmin,/);
  assert.match(routes, /router\.put\('\/modules\/:key', requireSuperAdmin, require\('\.\.\/services\/reauthService'\)\.guard\('modules_settings', 'key'\)/);
  assert.match(read('backend/src/services/reauthService.js'), /\^modules_settings:\[a-z\]\[a-z0-9_\]\{1,31\}\$/, 'bound to the module in the URL');
  assert.match(read('backend/src/config/securitySchema.js'), /ensureModulesSchema\(client\)/);
  console.log('PASS modules: schema/migration idempotent, server-side toggle, menu booleans only, no implicit admin access, audit, backup registry.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await pg.close(); await db.pool.end(); });
