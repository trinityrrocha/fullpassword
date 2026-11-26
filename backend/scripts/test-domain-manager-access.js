const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
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
const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });

// The router is driven for real (middleware order, scope, 403/404); only authentication is replaced by a header that names the account.
const authMiddleware = require('../src/middleware/authMiddleware');
authMiddleware.verifyToken = async (req, res, next) => {
  const id = req.get('x-test-user');
  const row = id ? (await pg.query('SELECT id, email, role, is_super_admin FROM users WHERE id = $1', [id])).rows[0] : null;
  if (!row) return res.status(401).json({ error: 'sem sessão' });
  req.user = { id: row.id, email: row.email, role: row.role, is_super_admin: row.is_super_admin };
  return next();
};
const { ensureSecuritySchema } = require('../src/config/securitySchema');
const { BACKUP_TABLES, OPTIONAL_BACKUP_TABLES } = require('../src/config/backupTables');
const modules = require('../src/services/modulesService');
const access = require('../src/services/domainManagerAccessService');
const dm = require('../src/services/domainManagerService');
require('../src/controllers/modulesController');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1); const ALICE = id(2); const BOB = id(3); const INACTIVE = id(4); const OTHER_ADMIN = id(5);

async function run() {
  await pg.exec(read('database/init.sql'));
  await pg.query(`INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,role,is_super_admin,is_active) VALUES
    ($1,'Admin','admin@example.invalid','H','W','S','admin',true,true), ($2,'Alice','alice@example.invalid','H','W','S','user',false,true),
    ($3,'Bob','bob@example.invalid','H','W','S','user',false,true), ($4,'Inativo','off@example.invalid','H','W','S','user',false,false),
    ($5,'Admin2','admin2@example.invalid','H','W','S','admin',false,true)`, [ADMIN, ALICE, BOB, INACTIVE, OTHER_ADMIN]);
  await ensureSecuritySchema(); await ensureSecuritySchema();
  const migration = read('database/migrations/37_domain_manager_user_access.sql');
  await pg.exec(migration); await pg.exec(migration);
  for (const table of ['dm_user_access', 'dm_user_domains']) assert.ok(BACKUP_TABLES.includes(table) && OPTIONAL_BACKUP_TABLES.has(table));
  assert.match(read('backend/src/services/reauthService.js'), /\|domain_manager_access\):\[0-9a-f-\]\{36\}\$/, 'access changes are reauthenticated, bound to the target');

  const service = dm.getService();
  const names = ['alfa.com', 'beta.com.br', 'gama.org', 'delta.net'];
  const created = {};
  for (const name of names) created[name] = (await service.addDomain(name, ADMIN)).id;
  for (const [name, expires] of [['alfa.com', '2027-03-01'], ['beta.com.br', '2027-04-01']]) {
    await pg.query(`INSERT INTO dm_snapshots (domain_id, checked_at, lookup_status, expires_on) VALUES ($1, now(), 'ok', $2)`, [created[name], expires]);
  }

  // --- Service: validation, who can receive a grant, replacement and cascades.
  for (const bad of [null, []]) await assert.rejects(access.saveAccess(ALICE, bad, ADMIN), { code: 'DM_ACCESS_INVALID' });
  for (const bad of [{}, { domain_ids: [] }, { domain_ids: 'x' }, { domain_ids: ['nope'] }, { domain_ids: Array.from({ length: 101 }, (_, i) => id(1000 + i)) }]) {
    await assert.rejects(access.saveAccess(ALICE, bad, ADMIN), { code: 'DM_ACCESS_DOMAINS_INVALID' }, JSON.stringify(bad)?.slice(0, 40));
  }
  await assert.rejects(access.saveAccess('nope', { domain_ids: [created['alfa.com']] }, ADMIN), { code: 'DM_ACCESS_USER_NOT_FOUND', statusCode: 404 });
  await assert.rejects(access.saveAccess(id(99), { domain_ids: [created['alfa.com']] }, ADMIN), { code: 'DM_ACCESS_USER_NOT_FOUND' });
  await assert.rejects(access.saveAccess(ADMIN, { domain_ids: [created['alfa.com']] }, ADMIN), { code: 'DM_ACCESS_SUPER_ADMIN', statusCode: 409 });
  await assert.rejects(access.saveAccess(INACTIVE, { domain_ids: [created['alfa.com']] }, ADMIN), { code: 'DM_ACCESS_USER_INACTIVE' });
  await assert.rejects(access.saveAccess(ALICE, { domain_ids: [id(777)] }, ADMIN), { code: 'DM_ACCESS_DOMAINS_INVALID', statusCode: 422 });
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_user_access')).rows[0].n, 0, 'a refused grant leaves nothing behind');

  const granted = await access.saveAccess(ALICE, { domain_ids: [created['alfa.com'], created['beta.com.br'], created['alfa.com'].toUpperCase()] }, ADMIN);
  assert.deepEqual(granted.domains.map((d) => d.name), ['alfa.com', 'beta.com.br']);
  assert.ok(!('emails' in granted) && !JSON.stringify(granted).includes('hash_senha'));
  const replaced = await access.saveAccess(ALICE, { domain_ids: [created['beta.com.br'], created['gama.org']] }, ADMIN);
  assert.deepEqual(replaced.domains.map((d) => d.name), ['beta.com.br', 'gama.org'], 'a new selection replaces the old one');
  assert.deepEqual((await access.listAccess()).map((a) => a.user_id), [ALICE]);

  // --- Menu and module gate: a grant opens the module for that account only, and only while the module is on.
  await modules.setModuleEnabled('domain_manager', true, ADMIN);
  assert.equal((await modules.getMenuModules({ id: ALICE, role: 'user' })).domain_manager, true);
  assert.equal((await modules.getMenuModules({ id: BOB, role: 'user' })).domain_manager, false, 'no grant, no menu');
  assert.equal((await modules.getMenuModules({ id: OTHER_ADMIN, role: 'admin', is_super_admin: false })).domain_manager, false, 'an admin who is not Super Admin has no implicit access');
  assert.equal((await modules.getMenuModules({ id: ADMIN, role: 'admin', is_super_admin: true })).domain_manager, true);

  // --- The real router.
  const router = require('../src/routes/domainManagerRoutes');
  const app = express();
  app.use(express.json());
  app.use('/api/domain-manager', router);
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error?.message) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/domain-manager`;
  const call = async (method, url, user, body) => {
    const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  assert.equal((await call('GET', '/domains', null)).status, 401);
  assert.deepEqual((await call('GET', '/domains', BOB)).body.code, 'DM_ACCESS_DENIED', 'no grant: refused');
  assert.equal((await call('GET', '/domains', OTHER_ADMIN)).status, 403, 'a plain admin has no implicit access');

  const own = await call('GET', '/domains', ALICE);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.domains.map((d) => d.name), ['beta.com.br', 'gama.org'], 'only the granted domains');
  assert.equal(own.body.total, 2);
  assert.equal(own.body.role, 'user');
  assert.ok(!('settings' in own.body), 'no administration settings for an ordinary account');
  assert.ok(own.body.domains.every((d) => !('alerts' in d)), 'no alert configuration for an ordinary account');
  assert.equal(own.body.domains[0].snapshot.expires_on, '2027-04-01');
  assert.equal((await call('GET', '/domains?search=alfa', ALICE)).body.total, 0, 'search never reaches outside the grant');
  assert.equal((await call('GET', '/domains?search=%25', ALICE)).body.total, 0);

  const adminList = await call('GET', '/domains', ADMIN);
  assert.equal(adminList.body.total, 4);
  assert.equal(adminList.body.role, 'super_admin');
  assert.ok('settings' in adminList.body && adminList.body.domains.every((d) => 'alerts' in d));

  assert.equal((await call('GET', `/domains/${created['beta.com.br']}`, ALICE)).status, 200);
  assert.equal((await call('GET', `/domains/${created['beta.com.br'].toUpperCase()}`, ALICE)).status, 200, 'ids are case-insensitive');
  for (const outside of ['alfa.com', 'delta.net']) {
    const denied = await call('GET', `/domains/${created[outside]}`, ALICE);
    assert.equal(denied.status, 404, 'outside the grant it simply does not exist');
    assert.equal(denied.body.code, 'DM_NOT_FOUND');
  }
  assert.equal((await call('GET', `/domains/${id(12345)}`, ALICE)).status, 404);
  assert.equal((await call('GET', '/domains/not-a-uuid', ALICE)).status, 400);

  // A lookup is allowed inside the grant (here answered by the per-domain cooldown, before any network use) and refused outside it.
  await pg.query('UPDATE dm_domains SET last_checked_at = now() WHERE id = $1', [created['beta.com.br']]);
  assert.equal((await call('POST', `/domains/${created['beta.com.br']}/check`, ALICE)).body.code, 'DM_COOLDOWN');
  assert.equal((await call('POST', `/domains/${created['alfa.com']}/check`, ALICE)).status, 404);
  assert.equal((await call('POST', `/domains/${created['beta.com.br']}/check`, BOB)).status, 403);

  // Everything that changes or administers is Super Admin only.
  const adminOnly = [
    ['POST', '/domains', { name: 'novo.com' }], ['POST', '/domains/import', { names: ['x1.com'] }], ['DELETE', `/domains/${created['gama.org']}`],
    ['GET', `/domains/${created['beta.com.br']}/alerts`], ['PUT', `/domains/${created['beta.com.br']}/alerts`, { enabled: false, notify_admins: false, emails: [] }],
    ['GET', '/settings'], ['PUT', '/settings', { check_interval_days: 3 }],
    ['GET', '/access'], ['GET', '/access/domains'], ['PUT', `/access/${BOB}`, { domain_ids: [created['alfa.com']] }], ['DELETE', `/access/${ALICE}`]
  ];
  for (const [method, url, body] of adminOnly) {
    const denied = await call(method, url, ALICE, body);
    assert.equal(denied.status, 403, `${method} ${url} must be Super Admin only`);
    assert.equal(denied.body.code, 'SUPER_ADMIN_REQUIRED');
  }
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM dm_domains WHERE name IN ('novo.com','x1.com')")).rows[0].n, 0, 'nothing was changed by the refused calls');
  assert.equal((await call('GET', '/access', ADMIN)).body.access.length, 1);
  const picker = await call('GET', '/access/domains', ADMIN);
  assert.deepEqual(picker.body.domains.map((d) => d.name), ['alfa.com', 'beta.com.br', 'delta.net', 'gama.org']);
  assert.deepEqual(Object.keys(picker.body.domains[0]).sort(), ['id', 'name'], 'the picker gets only id and name');
  // Granting needs the fresh confirmation bound to the target, exactly like the SPFBL grants.
  const noProof = await call('PUT', `/access/${BOB}`, ADMIN, { domain_ids: [created['alfa.com']] });
  assert.equal(noProof.status, 403);
  assert.equal(noProof.body.code, 'REAUTH_REQUIRED');
  assert.equal(noProof.body.purpose, `domain_manager_access:${BOB}`);
  assert.equal((await access.listAccess()).length, 1);

  // --- Module off: even a granted account is out; module on again: back in; deactivated account: out.
  await modules.setModuleEnabled('domain_manager', false, ADMIN);
  assert.equal((await call('GET', '/domains', ALICE)).status, 404);
  assert.equal((await modules.getMenuModules({ id: ALICE, role: 'user' })).domain_manager, false);
  await modules.setModuleEnabled('domain_manager', true, ADMIN);
  assert.equal((await call('GET', '/domains', ALICE)).status, 200);
  await pg.query('UPDATE users SET is_active = FALSE WHERE id = $1', [ALICE]);
  assert.equal((await call('GET', '/domains', ALICE)).status, 403, 'an inactive account loses access at once');
  await pg.query('UPDATE users SET is_active = TRUE WHERE id = $1', [ALICE]);

  // --- Revocation and cascades.
  await pg.query('DELETE FROM dm_domains WHERE id = $1', [created['gama.org']]);
  assert.deepEqual((await call('GET', '/domains', ALICE)).body.domains.map((d) => d.name), ['beta.com.br'], 'a removed domain leaves the grant');
  assert.deepEqual(await access.revokeAccess(ALICE), { user_id: ALICE });
  await assert.rejects(access.revokeAccess(ALICE), { code: 'DM_ACCESS_NOT_FOUND', statusCode: 404 });
  assert.equal((await call('GET', '/domains', ALICE)).status, 403, 'revoked: out on the next request');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_user_domains')).rows[0].n, 0);
  await access.saveAccess(BOB, { domain_ids: [created['delta.net']] }, ADMIN);
  await pg.query('DELETE FROM users WHERE id = $1', [BOB]);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_user_access')).rows[0].n, 0, 'deleting the account removes its grant');

  // --- Route order: authenticate, module gate, then per-route access; Super Admin gate after the three read routes only.
  const stack = router.stack;
  // The only router-level layer after authentication and the module gate is the Super Admin gate.
  const adminGate = stack.findIndex((layer, index) => index > 1 && !layer.route);
  assert.equal(stack.filter((layer) => !layer.route).length, 3);
  assert.ok(stack[adminGate].handle === require('../src/middleware/requireSuperAdmin'), 'it is the Super Admin middleware');
  const routeIndex = (method, routePath) => stack.findIndex((layer) => layer.route && layer.route.path === routePath && layer.route.methods[method]);
  assert.ok(!stack[0].route && !stack[1].route, 'authentication and the module gate are the first two layers, before any route');
  assert.ok(stack[0].handle === authMiddleware.verifyToken, 'the first layer is the authentication middleware');
  assert.equal(adminGate > routeIndex('post', '/domains/:id/check'), true, 'the three read routes come before the Super Admin gate');
  for (const [method, routePath] of [['post', '/domains'], ['post', '/domains/import'], ['delete', '/domains/:id'], ['get', '/access'], ['put', '/access/:userId'], ['delete', '/access/:userId'], ['get', '/settings'], ['put', '/settings'], ['get', '/domains/:id/alerts'], ['put', '/domains/:id/alerts']]) {
    assert.ok(routeIndex(method, routePath) > adminGate, `${method} ${routePath} sits behind the Super Admin gate`);
  }
  server.close();
  console.log('domain manager access tests passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
