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
const { WhmClient, WhmError, isPublicIpv4, MAX_DOMAINS } = require('../src/services/spfblWhmClient');
const domains = require('../src/services/spfblDomainsService');
const controller = require('../src/controllers/spfblController');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (user, extra = {}) => ({ user, params: {}, body: {}, get: () => 'test-agent', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra });

const TOKEN = 'WHMTOKENSENTINEL0123456789ABCDEF';
const leaks = (value) => JSON.stringify(value ?? null).includes('SENTINEL');
const ok = (data) => ({ status: 200, body: JSON.stringify({ metadata: { result: 1, reason: 'OK', version: 1 }, data }) });
const PUBLIC_IP = '93.184.216.7';

// A simulated WHM server: two allow-listed functions answered from mutable fixtures.
const server = { accounts: [], domains: [], calls: [] };
const transport = async (call) => {
  server.calls.push(call);
  if (server.failWith) throw server.failWith;
  if (call.path === '/json-api/listaccts?api.version=1') return ok({ acct: server.accounts });
  if (call.path === '/json-api/get_domain_info?api.version=1') return ok({ domains: server.domains });
  return { status: 404, body: '{}' };
};
const resolver = async () => [PUBLIC_IP];
const client = (overrides = {}, options = {}) => new WhmClient({ host: 'srv.example.com', user: 'root', token: TOKEN, ...overrides }, { transport, resolver, ...options });

async function run() {
  // ---- Hardened client: input validation ----
  for (const host of ['', 'https://srv.example.com', 'srv.example.com:2087', '203.0.113.9', 'localhost', 'srv', null, 5]) {
    assert.throws(() => client({ host }), { code: 'WHM_HOST_INVALID' });
  }
  for (const user of ['', 'Root', 'root@example.com', '1x', null]) assert.throws(() => client({ user }), { code: 'WHM_USER_INVALID' });
  for (const token of ['', 'short', 'has space 0123456789ABCDEF', 'a/b/0123456789ABCDEF', null]) assert.throws(() => client({ token }), { code: 'WHM_TOKEN_INVALID' });

  // ---- Only globally routable IPv4 addresses are ever contacted ----
  for (const ip of ['93.184.216.34', '8.8.8.8', '203.0.114.1', '1.1.1.1']) assert.equal(isPublicIpv4(ip), true, ip);
  for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '0.0.0.0', '169.254.169.254', '100.64.1.1', '198.18.0.1', '198.19.205.3', '224.0.0.1', '240.0.0.1', '255.255.255.255', '192.0.2.1', '203.0.113.5', '::1', '2001:db8::1', '1.2.3', '01.1.1.1', '1.1.1.1/8', '1.1.1.1 ', 'srv.example.com', '', null, 5]) {
    assert.equal(isPublicIpv4(ip), false, String(ip));
  }
  for (const answer of [['10.0.0.5'], ['127.0.0.1'], ['169.254.169.254'], [PUBLIC_IP, '10.0.0.5'], ['10.0.0.5', PUBLIC_IP]]) {
    server.calls = [];
    const bad = client({}, { resolver: async () => answer });
    await assert.rejects(bad.accounts(), { code: 'WHM_ADDRESS_FORBIDDEN', statusCode: 422 });
    assert.equal(server.calls.length, 0, 'no request may leave for a forbidden address');
  }
  for (const failing of [async () => [], async () => { throw new Error('ENOTFOUND'); }, async () => null]) {
    await assert.rejects(client({}, { resolver: failing }).accounts(), { code: 'WHM_DNS' });
  }

  // ---- Request shape: pinned IP, hostname for TLS, fixed port/path, token only in the header ----
  server.accounts = []; server.domains = []; server.calls = [];
  let lookups = 0;
  const pinned = client({}, { resolver: async () => { lookups += 1; return lookups === 1 ? [PUBLIC_IP] : ['10.0.0.9']; } });
  await pinned.accounts(); await pinned.domains();
  assert.equal(lookups, 1, 'resolved once: a later answer cannot redirect the request');
  assert.deepEqual(server.calls.map((c) => [c.ip, c.host, c.path]), [[PUBLIC_IP, 'srv.example.com', '/json-api/listaccts?api.version=1'], [PUBLIC_IP, 'srv.example.com', '/json-api/get_domain_info?api.version=1']]);
  assert.equal(server.calls[0].headers.Authorization, `whm root:${TOKEN}`);
  assert.equal(JSON.stringify(server.calls.map((c) => c.path)).includes(TOKEN), false, 'the token never goes in the URL');
  assert.ok(server.calls[0].maxBytes >= 8 * 1024 * 1024 && server.calls[0].timeoutMs <= 20000);
  for (const name of ['createacct', 'removeacct', 'listaccts/../x', '', 'applist']) {
    await assert.rejects(pinned.call(name), { code: 'WHM_FUNCTION_FORBIDDEN', statusCode: 403 });
  }

  // ---- Provider responses are never trusted ----
  // Which call failed must be diagnosable on the first real run (message and fixed diagnostic), without leaking anything.
  for (const [name, answer, expected] of [
    ['listaccts', { status: 401, body: '' }, /WHM_HTTP_401 listaccts/],
    ['listaccts', { status: 200, body: JSON.stringify({ metadata: { result: 0 }, data: null }) }, /WHM_API_REFUSED listaccts/],
    ['listaccts', { status: 200, body: 'nope' }, /WHM_FORMAT listaccts/],
    ['get_domain_info', { status: 500, body: '' }, /WHM_HTTP_500 get_domain_info/]
  ]) {
    const error = await (name === 'listaccts' ? client({}, { transport: async () => answer }).accounts() : client({}, { transport: async () => answer }).domains()).then(() => null, (e) => e);
    assert.match(error.diagnostic, expected); assert.ok(error.message.includes(name), error.message);
  }
  const expectFail = async (answer, code, status) => {
    const c = client({}, { transport: typeof answer === 'function' ? answer : async () => answer });
    const error = await c.accounts().then(() => null, (e) => e);
    assert.ok(error instanceof WhmError, String(error?.stack || error)); assert.equal(error.code, code);
    if (status) assert.equal(error.statusCode, status);
    assert.equal(leaks(error.message) || leaks(error.diagnostic) || error.message.includes(PUBLIC_IP), false, 'no token or address in errors');
  };
  await expectFail({ status: 401, body: `denied ${TOKEN}` }, 'WHM_AUTH_REFUSED', 422);
  await expectFail({ status: 403, body: '' }, 'WHM_AUTH_REFUSED', 422);
  await expectFail({ status: 302, body: '' }, 'WHM_REDIRECT');
  await expectFail({ status: 500, body: `boom ${TOKEN}` }, 'WHM_HTTP');
  await expectFail({ status: 200, body: 'not json' }, 'WHM_FORMAT');
  await expectFail({ status: 200, body: '[1]' }, 'WHM_FORMAT');
  await expectFail({ status: 200, body: JSON.stringify({ data: { acct: [] } }) }, 'WHM_FORMAT');
  await expectFail({ status: 200, body: JSON.stringify({ metadata: { result: 0, reason: `Token ${TOKEN} denied` }, data: null }) }, 'WHM_API_REFUSED');
  await expectFail({ status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: null }) }, 'WHM_FORMAT');
  await expectFail({ status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: { acct: {} } }) }, 'WHM_FORMAT');
  await expectFail(async () => { throw Object.assign(new Error('x'), { oversized: true }); }, 'WHM_RESPONSE_TOO_LARGE');
  await expectFail({ status: 200, body: 'x'.repeat(8 * 1024 * 1024 + 1) }, 'WHM_RESPONSE_TOO_LARGE');
  await expectFail(async () => { throw Object.assign(new Error('timeout'), { timeout: true }); }, 'WHM_TIMEOUT', 504);
  await expectFail(async () => { throw Object.assign(new Error('self signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }); }, 'WHM_TLS');
  await expectFail(async () => { throw new Error(`connect ECONNREFUSED ${PUBLIC_IP}:2087 token ${TOKEN}`); }, 'WHM_CONNECTION');
  let clock = 1000;
  const slow = client({}, { now: () => clock });
  clock += 46000;
  await assert.rejects(slow.accounts(), { code: 'WHM_TIMEOUT' });

  // ---- Active domains: accounts + get_domain_info, suspended accounts flagged, unknown owners not trusted ----
  server.accounts = [
    { user: 'alice', domain: 'Alice.com.br', suspended: 0 }, { user: 'bob', domain: 'bob.net', suspended: 1 },
    { user: 'carol', domain: 'carol.io', suspended: 0 }, { user: 'Bad User', domain: 'x.com', suspended: 0 }, { user: 'dave', domain: 'dave.org', suspended: 'maybe' }
  ];
  server.domains = [
    { domain: 'alice.com.br', user: 'alice' }, { domain: 'shop.alice.com.br', user: 'alice' }, { domain: 'bob.net', user: 'bob' },
    { domain: 'ghost.org', user: 'nobody' }, { domain: 'BAD DOMAIN', user: 'alice' }, { domain: 'ok.example', user: 5 }, null
  ];
  const listing = await client().listDomains();
  assert.deepEqual(listing.domains, [
    { name: 'alice.com.br', cpanel_user: 'alice', suspended: false }, { name: 'bob.net', cpanel_user: 'bob', suspended: true },
    { name: 'carol.io', cpanel_user: 'carol', suspended: false }, { name: 'shop.alice.com.br', cpanel_user: 'alice', suspended: false }
  ], 'carol.io comes from listaccts alone; ghost.org (unknown account) is not trusted');
  assert.equal(listing.accounts, 3);
  assert.equal(listing.skipped, 2 + 3 + 1, 'invalid accounts, invalid domains and one unknown-owner domain');
  const big = client();
  big.accounts = async () => ({ accounts: [{ user: 'x', domain: null, suspended: false }], skipped: 0 });
  big.domains = async () => ({ domains: Array.from({ length: MAX_DOMAINS + 1 }, (_, i) => ({ domain: `d${i}.example.com`, user: 'x' })), skipped: 0 });
  await assert.rejects(big.listDomains(), { code: 'WHM_TOO_MANY', statusCode: 422 });

  // ---- Catalogue + sync against PostgreSQL ----
  await pg.exec(read('database/init.sql'));
  const adminId = '00000000-0000-0000-0000-0000000000a1';
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt) VALUES ($1,'T','admin@example.invalid','H','W','S')", [adminId]);
  const admin = { id: adminId, email: 'admin@example.invalid', role: 'admin', is_super_admin: true };
  await ensureSecuritySchema();
  const migration = read('database/migrations/27_create_spfbl_domains.sql');
  await pg.exec(migration); await pg.exec(migration);
  assert.ok(BACKUP_TABLES.includes('spfbl_domains') && BACKUP_TABLES.indexOf('spfbl_domains') > BACKUP_TABLES.indexOf('users'));
  await assert.rejects(pg.query("INSERT INTO spfbl_domains(name) VALUES ('UPPER.example.com')"));
  await assert.rejects(pg.query("INSERT INTO spfbl_domains(name,source) VALUES ('x.example.com','other')"));
  assert.equal((await settings.getSettings()).domain_sync_at, null);

  // Manual catalogue
  for (const bad of ['a@b.com', 'http://x.com', 'x', 'a..com', '-a.com', '203.0.113.9', '', null, 5, 'a b.com', 'x.com/path']) {
    await assert.rejects(domains.addManualDomain(bad, adminId), { code: 'SPFBL_DOMAIN_INVALID' }, String(bad));
  }
  const manual = await domains.addManualDomain('  Manual.Example.COM ', adminId);
  assert.equal(manual.name, 'manual.example.com'); assert.equal(manual.source, 'manual');
  await assert.rejects(domains.addManualDomain('manual.example.com', adminId), { code: 'SPFBL_DOMAIN_EXISTS', statusCode: 409 });
  for (const id of ['nope', '', null, '00000000-0000-0000-0000-00000000ffff']) await assert.rejects(domains.removeDomain(id), { code: 'SPFBL_DOMAIN_NOT_FOUND', statusCode: 404 });

  // WHM not configured => refused before any network use
  await assert.rejects(domains.testWhm(), { code: 'WHM_NOT_CONFIGURED', statusCode: 422 });
  await assert.rejects(domains.syncFromWhm(adminId), { code: 'WHM_NOT_CONFIGURED' });
  assert.match((await settings.getSettings()).domain_sync_status, /^failed:WHM_NOT_CONFIGURED$/);
  await settings.updateSettings({ whm_host: 'srv.example.com', whm_user: 'root', whm_token: TOKEN }, adminId);
  domains.internals.createClient = (credentials) => new WhmClient(credentials, { transport, resolver });

  server.accounts = [{ user: 'alice', domain: 'alice.com.br', suspended: 0 }, { user: 'bob', domain: 'bob.net', suspended: 0 }];
  server.domains = [{ domain: 'alice.com.br', user: 'alice' }, { domain: 'shop.alice.com.br', user: 'alice' }, { domain: 'bob.net', user: 'bob' }, { domain: 'manual.example.com', user: 'alice' }];
  const dry = await domains.testWhm();
  assert.deepEqual(dry, { accounts: 2, domains: 4, active: 4, suspended: 0, skipped: 0 });
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM spfbl_domains WHERE source = 'whm'")).rows[0].n, 0, 'the test writes nothing');

  let sync = await domains.syncFromWhm(adminId);
  assert.deepEqual(sync, { accounts: 2, domains: 4, active: 4, suspended: 0, skipped: 0, added: 3, updated: 1, deactivated: 0 });
  let rows = Object.fromEntries((await domains.listDomains()).map((d) => [d.name, d]));
  assert.equal(rows['manual.example.com'].source, 'manual', 'a hand-typed domain keeps its source');
  assert.equal(rows['manual.example.com'].cpanel_user, 'alice');
  assert.equal(rows['shop.alice.com.br'].source, 'whm'); assert.equal(rows['shop.alice.com.br'].active, true);
  const status = await settings.getSettings();
  assert.equal(status.domain_sync_status, 'ok'); assert.ok(status.domain_sync_at);
  assert.equal(leaks(status), false);

  // Second sync is idempotent; a suspended account turns its domains inactive; a vanished domain is deactivated.
  sync = await domains.syncFromWhm(adminId);
  assert.equal(sync.added, 0); assert.equal(sync.updated, 4); assert.equal(sync.deactivated, 0);
  server.accounts[1].suspended = 1;
  server.domains = server.domains.filter((d) => d.domain !== 'shop.alice.com.br');
  sync = await domains.syncFromWhm(adminId);
  assert.deepEqual([sync.added, sync.updated, sync.deactivated, sync.suspended, sync.active], [0, 3, 1, 1, 2]);
  rows = Object.fromEntries((await domains.listDomains()).map((d) => [d.name, d]));
  assert.deepEqual([rows['bob.net'].suspended, rows['bob.net'].active], [true, false]);
  assert.equal(rows['shop.alice.com.br'].active, false, 'gone from the server => inactive, kept for history');
  assert.equal(rows['alice.com.br'].active, true);

  // Failures change nothing and are recorded with a fixed code.
  const snapshot = JSON.stringify(await domains.listDomains());
  server.failWith = new Error(`connect ECONNREFUSED ${TOKEN}`);
  await assert.rejects(domains.syncFromWhm(adminId), { code: 'WHM_CONNECTION' });
  server.failWith = null;
  assert.equal(JSON.stringify(await domains.listDomains()), snapshot);
  assert.equal((await settings.getSettings()).domain_sync_status, 'failed:WHM_CONNECTION');
  // An empty answer (e.g. a token without the right permissions) must never wipe the imported domains.
  server.accounts = []; server.domains = [];
  await assert.rejects(domains.syncFromWhm(adminId), { code: 'SPFBL_SYNC_EMPTY', statusCode: 409 });
  assert.equal(JSON.stringify(await domains.listDomains()), snapshot, 'nothing changed');
  assert.equal((await settings.getSettings()).domain_sync_status, 'failed:SPFBL_SYNC_EMPTY');

  // Removal: only hand-typed domains.
  const imported = rows['alice.com.br'];
  await assert.rejects(domains.removeDomain(imported.id), { code: 'SPFBL_DOMAIN_IMPORTED', statusCode: 409 });
  assert.deepEqual(await domains.removeDomain(manual.id), { id: manual.id, name: 'manual.example.com' });
  assert.equal((await domains.listDomains()).some((d) => d.name === 'manual.example.com'), false);

  // ---- Controller: shared lock + cool-down, audit without secrets, error mapping ----
  server.accounts = [{ user: 'alice', domain: 'alice.com.br', suspended: 0 }];
  server.domains = [{ domain: 'alice.com.br', user: 'alice' }];
  controller.resetWhmState();
  let res = response(); await controller.testWhm(request(admin), res);
  assert.equal(res.code, 200); assert.deepEqual(res.body, { accounts: 1, domains: 1, active: 1, suspended: 0, skipped: 0 });
  res = response(); await controller.syncDomains(request(admin), res);
  assert.equal(res.code, 429); assert.equal(res.body.code, 'SPFBL_WHM_COOLDOWN'); assert.ok(res.body.retry_after_seconds >= 1);
  controller.resetWhmState();
  res = response(); await controller.syncDomains(request(admin), res);
  assert.equal(res.code, 200); assert.equal(res.body.added, 0);
  controller.resetWhmState();
  server.failWith = Object.assign(new Error('x'), { timeout: true });
  res = response(); await controller.syncDomains(request(admin), res);
  assert.equal(res.code, 504); assert.equal(res.body.code, 'WHM_TIMEOUT'); assert.equal(leaks(res.body), false);
  server.failWith = null; controller.resetWhmState();
  const realCreate = domains.internals.createClient;
  let release; domains.internals.createClient = () => ({ listDomains: () => new Promise((resolve) => { release = resolve; }) });
  const first = (async () => { const r = response(); await controller.testWhm(request(admin), r); return r; })();
  await new Promise((resolve) => setTimeout(resolve, 20));
  res = response(); await controller.testWhm(request(admin), res);
  assert.equal(res.code, 429); assert.equal(res.body.code, 'SPFBL_WHM_BUSY');
  release({ accounts: 0, domains: [], skipped: 0 });
  assert.equal((await first).code, 200);
  domains.internals.createClient = realCreate; controller.resetWhmState();

  res = response(); await controller.addDomain(request(admin, { body: { name: 'novo.example.org' } }), res);
  assert.equal(res.code, 201); const added = res.body.domain;
  res = response(); await controller.addDomain(request(admin, { body: { name: 'novo.example.org' } }), res);
  assert.equal(res.code, 409);
  res = response(); await controller.addDomain(request(admin, { body: { name: 'bad domain' } }), res);
  assert.equal(res.code, 400);
  res = response(); await controller.listDomains(request(admin), res);
  assert.equal(res.code, 200); assert.ok(res.body.domains.some((d) => d.name === 'novo.example.org'));
  res = response(); await controller.removeDomain(request(admin, { params: { id: added.id } }), res);
  assert.equal(res.code, 200);
  res = response(); await controller.removeDomain(request(admin, { params: { id: added.id } }), res);
  assert.equal(res.code, 404);
  const audit = (await pg.query("SELECT action, status, metadata FROM system_audit_events WHERE action LIKE 'spfbl_%' ORDER BY created_at, id")).rows;
  assert.equal(leaks(audit), false, 'no token in the audit trail');
  assert.equal(JSON.stringify(audit).includes('srv.example.com'), false, 'no WHM host in the audit trail');
  assert.ok(audit.some((e) => e.action === 'spfbl_whm_test' && e.status === 'success' && e.metadata.domains === 1));
  assert.ok(audit.some((e) => e.action === 'spfbl_domains_synced' && e.status === 'failed' && e.metadata.reason === 'WHM_TIMEOUT'));
  assert.ok(audit.some((e) => e.action === 'spfbl_domain_added' && e.metadata.domain === 'novo.example.org'));

  // ---- Wiring ----
  const routes = read('backend/src/routes/spfblRoutes.js');
  for (const line of ["router.post('/whm/test', requireSuperAdmin, spfblTestLimiter,", "router.get('/domains', requireSuperAdmin,", "router.post('/domains', requireSuperAdmin,", "router.post('/domains/sync', requireSuperAdmin, spfblTestLimiter,", "router.delete('/domains/:id', requireSuperAdmin,"]) {
    assert.ok(routes.includes(line), line);
  }
  assert.match(routes, /requireUuidParam\(req, res, next, req\.params\.id\)/);
  console.log('PASS spfbl whm: public-IPv4-only pinned connection, read-only allow-list, untrusted responses, active-domain sync (transactional, never wipes on failure/empty), audit without secrets.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await pg.close(); await db.pool.end(); });
