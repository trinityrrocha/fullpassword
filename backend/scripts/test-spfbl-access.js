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
const modules = require('../src/services/modulesService');
const modulesController = require('../src/controllers/modulesController');
const access = require('../src/services/spfblAccessService');
const domains = require('../src/services/spfblDomainsService');
const controller = require('../src/controllers/spfblController');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (user, extra = {}) => ({ user, params: {}, body: {}, get: () => 'test-agent', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra });
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function run() {
  await pg.exec(read('database/init.sql'));
  const ids = { admin: id(1), alice: id(2), bob: id(3), inactive: id(4), nullActive: id(5), carol: id(6) };
  const seed = async (key, email, { active = true, superAdmin = false } = {}) => pg.query(
    "INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_active,is_super_admin,role) VALUES ($1,$2,$3,'H','W','S',$4,$5,$6)",
    [ids[key], key[0].toUpperCase() + key.slice(1), email, active, superAdmin, superAdmin ? 'admin' : 'user']
  );
  await seed('admin', 'admin@example.invalid', { superAdmin: true });
  await seed('alice', 'alice@example.invalid'); await seed('bob', 'bob@example.invalid');
  await seed('inactive', 'inactive@example.invalid', { active: false }); await seed('carol', 'carol@example.invalid');
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_active,role) VALUES ($1,'Null','null@example.invalid','H','W','S',NULL,'user')", [ids.nullActive]);
  const admin = { id: ids.admin, email: 'admin@example.invalid', role: 'admin', is_super_admin: true };
  const user = (key) => ({ id: ids[key], email: `${key}@example.invalid`, role: 'user', is_super_admin: false });

  // ---- Schema ----
  await ensureSecuritySchema();
  const migration = read('database/migrations/28_create_spfbl_user_access.sql');
  await pg.exec(migration); await pg.exec(migration);
  const order = (t) => BACKUP_TABLES.indexOf(t);
  assert.ok(order('spfbl_user_access') > order('users') && order('spfbl_user_domains') > order('spfbl_user_access') && order('spfbl_user_domains') > order('spfbl_domains'), 'restore order respects the foreign keys');
  await assert.rejects(pg.query("INSERT INTO spfbl_user_access(user_id, unlock_mode) VALUES ($1, 'anything')", [ids.alice]));
  await assert.rejects(pg.query("INSERT INTO spfbl_user_access(user_id) VALUES ('00000000-0000-0000-0000-00000000ffff')"));

  await domains.addManualDomain('one.example.com', ids.admin);
  await domains.addManualDomain('two.example.com', ids.admin);
  await domains.addManualDomain('three.example.com', ids.admin);
  const d = Object.fromEntries((await domains.listDomains()).map((row) => [row.name.split('.')[0], row.id]));

  // ---- Input validation ----
  const rejects = (target, input, code, status) => assert.rejects(access.saveAccess(target, input, ids.admin), status ? { code, statusCode: status } : { code });
  await rejects(ids.alice, null, 'SPFBL_ACCESS_INVALID');
  await rejects(ids.alice, [], 'SPFBL_ACCESS_INVALID');
  for (const mode of ['', 'admin', null, undefined, 'REVIEW', ['review']]) await rejects(ids.alice, { unlock_mode: mode, domain_ids: [d.one] }, 'SPFBL_ACCESS_MODE_INVALID');
  for (const list of [undefined, null, 'x', {}, [], [d.one, 'not-a-uuid'], [d.one, 5], [null]]) await rejects(ids.alice, { unlock_mode: 'review', domain_ids: list }, 'SPFBL_ACCESS_DOMAINS_INVALID');
  await rejects(ids.alice, { unlock_mode: 'review', domain_ids: Array.from({ length: 101 }, (_, i) => id(1000 + i)) }, 'SPFBL_ACCESS_DOMAINS_INVALID', 400);
  await rejects(ids.alice, { unlock_mode: 'review', domain_ids: [d.one, id(999)] }, 'SPFBL_ACCESS_DOMAINS_INVALID', 422);
  for (const target of ['nope', '', null, id(777)]) await rejects(target, { unlock_mode: 'review', domain_ids: [d.one] }, 'SPFBL_ACCESS_USER_NOT_FOUND', 404);
  await rejects(ids.admin, { unlock_mode: 'review', domain_ids: [d.one] }, 'SPFBL_ACCESS_SUPER_ADMIN', 409);
  await rejects(ids.inactive, { unlock_mode: 'review', domain_ids: [d.one] }, 'SPFBL_ACCESS_USER_INACTIVE', 409);
  await rejects(ids.nullActive, { unlock_mode: 'review', domain_ids: [d.one] }, 'SPFBL_ACCESS_USER_INACTIVE', 409);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM spfbl_user_access')).rows[0].n, 0, 'refused requests change nothing');

  // ---- Grant, replace, switch mode ----
  assert.equal(await access.hasAccess(user('alice')), false);
  let saved = await access.saveAccess(ids.alice, { unlock_mode: 'review', domain_ids: [d.two, d.one, d.one.toUpperCase()] }, ids.admin);
  assert.deepEqual(saved.domains.map((x) => x.name), ['one.example.com', 'two.example.com'], 'sorted, deduplicated');
  assert.equal(saved.unlock_mode, 'review'); assert.equal(saved.email, 'alice@example.invalid');
  saved = await access.saveAccess(ids.alice, { unlock_mode: 'direct', domain_ids: [d.three, d.one] }, ids.admin);
  assert.deepEqual(saved.domains.map((x) => x.name), ['one.example.com', 'three.example.com'], 'the set is replaced, not appended');
  assert.equal(saved.unlock_mode, 'direct');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM spfbl_user_domains WHERE user_id = $1', [ids.alice])).rows[0].n, 2);
  await access.saveAccess(ids.bob, { unlock_mode: 'review', domain_ids: [d.two] }, ids.admin);
  const listed = await access.listAccess();
  assert.deepEqual(listed.map((r) => [r.name, r.unlock_mode, r.domains.length]), [['Alice', 'direct', 2], ['Bob', 'review', 1]]);

  // ---- Access is evaluated live: module toggle, grants and account status ----
  await modules.setModuleEnabled('spfbl', true, ids.admin);
  assert.deepEqual(await modules.getMenuModules(user('alice')), { spfbl: true });
  assert.deepEqual(await modules.getMenuModules(user('carol')), { spfbl: false }, 'no grant, no icon');
  assert.deepEqual(await modules.getMenuModules(admin), { spfbl: true });
  await modules.setModuleEnabled('spfbl', false, ids.admin);
  assert.deepEqual(await modules.getMenuModules(user('alice')), { spfbl: false }, 'a grant does not outlive a disabled module');
  await modules.setModuleEnabled('spfbl', true, ids.admin);
  await pg.query('UPDATE users SET is_active = FALSE WHERE id = $1', [ids.bob]);
  assert.equal(await access.hasAccess(user('bob')), false, 'a deactivated account loses access without touching the grant');
  assert.equal(await access.getOwnAccess(user('bob')), null);
  await pg.query('UPDATE users SET is_active = TRUE WHERE id = $1', [ids.bob]);
  assert.equal(await access.hasAccess(user('bob')), true);
  assert.equal(await access.hasAccess({ id: 'nope' }), false); assert.equal(await access.hasAccess(null), false); assert.equal(await access.hasAccess({}), false);

  // ---- Cascades ----
  await domains.removeDomain(d.three);
  assert.deepEqual((await access.getOwnAccess(user('alice'))).domains.map((x) => x.name), ['one.example.com'], 'a removed domain leaves every scope');
  await pg.query('DELETE FROM users WHERE id = $1', [ids.bob]);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM spfbl_user_access WHERE user_id = $1', [ids.bob])).rows[0].n, 0);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM spfbl_user_domains WHERE user_id = $1', [ids.bob])).rows[0].n, 0);

  // ---- Controller: overview never leaks another scope; audit holds ids and counts only ----
  let res = response(); await controller.overview(request(user('alice')), res);
  assert.equal(res.code, 200); assert.deepEqual(res.body, { role: 'user', unlock_mode: 'direct', domains: [{ id: d.one, name: 'one.example.com', active: true }] });
  assert.equal(JSON.stringify(res.body).includes('two.example.com'), false);
  res = response(); await controller.overview(request(user('carol')), res);
  assert.equal(res.code, 403); assert.equal(res.body.code, 'SPFBL_ACCESS_DENIED');
  res = response(); await controller.overview(request(admin), res);
  assert.equal(res.code, 200); assert.equal(res.body.role, 'super_admin');
  assert.deepEqual([res.body.matrix_configured, res.body.whm_configured, res.body.domains, res.body.users_with_access], [false, false, { total: 2, active: 2 }, 1]);
  assert.equal(Object.keys(res.body).some((key) => /password|token|secret/i.test(key)), false);
  await modules.setModuleEnabled('spfbl', false, ids.admin);
  res = response(); await controller.overview(request(admin), res);
  assert.equal(res.code, 403, 'even the Super Admin gets nothing while the module is off');
  await modules.setModuleEnabled('spfbl', true, ids.admin);

  res = response(); await controller.saveAccess(request(admin, { params: { userId: ids.carol }, body: { unlock_mode: 'review', domain_ids: [d.one, d.two] } }), res);
  assert.equal(res.code, 200); assert.equal(res.body.access.domains.length, 2);
  res = response(); await controller.saveAccess(request(admin, { params: { userId: ids.inactive }, body: { unlock_mode: 'review', domain_ids: [d.one] } }), res);
  assert.equal(res.code, 409); assert.equal(res.body.code, 'SPFBL_ACCESS_USER_INACTIVE');
  res = response(); await controller.revokeAccess(request(admin, { params: { userId: ids.carol } }), res);
  assert.equal(res.code, 200); assert.equal(await access.hasAccess(user('carol')), false);
  res = response(); await controller.revokeAccess(request(admin, { params: { userId: ids.carol } }), res);
  assert.equal(res.code, 404);
  res = response(); await controller.listAccess(request(admin), res);
  assert.equal(res.code, 200); assert.equal(res.body.access.length, 1);
  const audit = (await pg.query("SELECT action, status, metadata FROM system_audit_events WHERE action LIKE 'spfbl_access_%' ORDER BY created_at, id")).rows;
  assert.deepEqual(audit.map((e) => `${e.action}:${e.status}`), ['spfbl_access_saved:success', 'spfbl_access_saved:failed', 'spfbl_access_revoked:success', 'spfbl_access_revoked:failed']);
  assert.deepEqual(audit[0].metadata, { target_user_id: ids.carol, unlock_mode: 'review', domains: 2 });
  assert.equal(JSON.stringify(audit).includes('@example'), false, 'no e-mail addresses in the audit trail');

  // The menu endpoint (any signed-in user) reports the grant, booleans only.
  res = response(); await modulesController.menu(request(user('alice')), res);
  assert.deepEqual(res.body, { modules: { spfbl: true } });

  // ---- Wiring ----
  const routes = read('backend/src/routes/spfblRoutes.js');
  assert.match(routes, /router\.get\('\/overview', asyncRoute\(controller\.overview\)\)/);
  for (const line of ["router.get('/access', requireSuperAdmin,", "router.put('/access/:userId', requireSuperAdmin, uuidParam('userId'), guard('spfbl_access', 'userId'),", "router.delete('/access/:userId', requireSuperAdmin, uuidParam('userId'), guard('spfbl_access', 'userId'),"]) {
    assert.ok(routes.includes(line), line);
  }
  const routeLines = routes.split('\n').filter((line) => /^router\.(get|put|post|delete|patch)\(/.test(line));
  assert.equal(routeLines.length, 24);
  const open = routeLines.filter((line) => !line.includes('requireSuperAdmin'));
  // Open to granted users: the overview and the read-only history views. Each one resolves the caller's CURRENT scope per request
  // (test-spfbl-history.js); everything else is Super Admin only.
  const openPaths = open.map((line) => /^router\.(\w+)\('([^']+)'/.exec(line).slice(1).join(' '));
  assert.deepEqual(openPaths.sort(), ['get /dashboard', 'get /history', 'get /overview', 'get /records/:id', 'get /requests', 'post /history/refresh', 'post /records/:id/request', 'post /records/:id/status', 'post /records/:id/unlock'].sort());
  assert.match(read('backend/src/services/reauthService.js'), /\|spfbl_access\):\[0-9a-f-\]\{36\}\$/, 'access reauth is bound to the target account');
  assert.match(read('backend/src/controllers/modulesController.js'), /require\('\.\.\/services\/spfblAccessService'\)/);
  console.log('PASS spfbl access: FK-ordered schema, validated grants (1-100 domains, no Super Admin/inactive), live menu check, scoped overview, cascades, audit without e-mails.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await pg.close(); await db.pool.end(); });
