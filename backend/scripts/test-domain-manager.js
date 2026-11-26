const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
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
const { BACKUP_TABLES, OPTIONAL_BACKUP_TABLES } = require('../src/config/backupTables');
const modules = require('../src/services/modulesService');
const { createRdapClient, parseDomain, toDay } = require('../src/services/domainManagerRdap');
const net = require('../src/services/domainManagerNet');
const sslProbe = require('../src/services/domainManagerSsl');
const dm = require('../src/services/domainManagerService');
const scheduler = require('../src/services/domainManagerScheduler');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });

const DAY = 86400000;
const NOW = Date.parse('2026-11-26T15:00:00Z');
const dayFrom = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

async function run() {
  await pg.exec(read('database/init.sql'));
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt) VALUES ('00000000-0000-0000-0000-0000000000a1','T','admin@example.invalid','H','W','S')");
  const adminId = '00000000-0000-0000-0000-0000000000a1';

  // --- Schema: fresh, ensure and migration are idempotent; the module exists and starts disabled; backups know the tables.
  assert.deepEqual((await pg.query("SELECT module_key, enabled FROM system_modules ORDER BY module_key")).rows, [{ module_key: 'domain_manager', enabled: false }, { module_key: 'spfbl', enabled: false }]);
  await ensureSecuritySchema(); await ensureSecuritySchema();
  const migration = read('database/migrations/35_domain_manager.sql');
  await pg.exec(migration); await pg.exec(migration);
  assert.equal((await pg.query('SELECT check_interval_days FROM dm_settings')).rows[0].check_interval_days, 7);
  for (const table of ['dm_settings', 'dm_domains', 'dm_snapshots', 'dm_changes']) {
    assert.ok(BACKUP_TABLES.includes(table) && OPTIONAL_BACKUP_TABLES.has(table), `${table} must be in the backup lists`);
  }
  assert.ok(modules.MODULES.domain_manager);
  await assert.rejects(pg.query("INSERT INTO dm_domains(name) VALUES ('UPPER.com')"));
  await assert.rejects(pg.query("UPDATE dm_settings SET check_interval_days = 31"));

  // --- Names
  for (const [input, expected] of [['Empresa.com.br', 'empresa.com.br'], [' exemplo.com. ', 'exemplo.com'], ['bücher.de', 'xn--bcher-kva.de']]) assert.equal(dm.normalizeName(input), expected);
  for (const bad of ['', 'localhost', 'a.b', 'http://x.com', 'x.com/path', 'a b.com', 'user@x.com', 'x.com:443', '-x.com', '10.0.0.1', null, 5, {}]) assert.equal(dm.normalizeName(bad), null, String(bad));

  // --- RDAP parsing: dates in Brasília time, registrant data discarded, only the registrar name kept.
  assert.equal(toDay('2027-01-01T02:00:00Z'), '2026-12-31');
  assert.equal(toDay('2027-01-01T12:00:00Z'), '2027-01-01');
  assert.equal(toDay('nope'), null);
  const sample = {
    objectClassName: 'domain', ldhName: 'exemplo.com.br', status: ['Active', 'client transfer prohibited'],
    events: [{ eventAction: 'registration', eventDate: '2020-05-01T12:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-05-01T02:30:00Z' }, { eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' }],
    nameservers: [{ ldhName: 'NS2.Host.COM.' }, { ldhName: 'ns1.host.com' }, { ldhName: 'ns1.host.com' }],
    secureDNS: { delegationSigned: true },
    entities: [
      { roles: ['registrant'], handle: '12345678901', vcardArray: ['vcard', [['fn', {}, 'text', 'Pessoa Secreta'], ['email', {}, 'text', 'pii@example.invalid']]] },
      { roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Registrar Ltda']]] }
    ]
  };
  const parsed = parseDomain(sample);
  assert.deepEqual(parsed, { lookup_status: 'ok', registrar: 'Registrar Ltda', expires_on: '2027-04-30', registered_on: '2020-05-01', rdap_statuses: ['active', 'client transfer prohibited'], nameservers: ['ns1.host.com', 'ns2.host.com'], dnssec: true });
  assert.ok(!JSON.stringify(parsed).includes('Secreta') && !JSON.stringify(parsed).includes('pii@'));
  assert.equal(parseDomain({ ...sample, events: [] }).lookup_status, 'no_expiry');
  assert.equal(parseDomain({ objectClassName: 'nameserver' }).error_code, 'RDAP_INVALID');
  assert.equal(parseDomain(null).lookup_status, 'error');

  // --- RDAP client: bootstrap table, pacing, status mapping, registry host never user-controlled.
  const calls = [];
  let clock = 1000;
  const sleeps = [];
  const responses = new Map();
  const transport = async ({ host, path: requestPath }) => {
    calls.push(`${host}${requestPath}`);
    if (host === 'data.iana.org') return { status: 200, headers: {}, body: JSON.stringify({ services: [[['com', 'net'], ['https://rdap.verisign.example/com/v1/']], [['io'], ['http://insecure.example/']], [['dev'], ['https://rdap.dev.example']]] }) };
    const reply = responses.get(requestPath);
    return reply || { status: 404, headers: {}, body: '{}' };
  };
  const client = createRdapClient({ transport, resolver: async () => ['93.184.216.34'], now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  responses.set('/domain/exemplo.com.br', { status: 200, headers: {}, body: JSON.stringify(sample) });
  assert.equal((await client.lookup('exemplo.com.br')).expires_on, '2027-04-30');
  assert.ok(calls.includes('rdap.registro.br/domain/exemplo.com.br'));
  responses.set('/com/v1/domain/foo.com', { status: 200, headers: {}, body: JSON.stringify(sample) });
  assert.equal((await client.lookup('foo.com')).lookup_status, 'ok');
  assert.ok(calls.includes('rdap.verisign.example/com/v1/domain/foo.com'), 'path prefix from the bootstrap is kept');
  assert.equal((await client.lookup('x.io')).lookup_status, 'unsupported', 'http-only registry is not used');
  assert.equal((await client.lookup('x.zzzz')).lookup_status, 'unsupported');
  assert.equal((await client.lookup('nao-existe.com.br')).lookup_status, 'not_found');
  responses.set('/domain/bloqueado.com.br', { status: 403, headers: { 'nicbr-permission-denied': '1' }, body: '' });
  assert.deepEqual(await client.lookup('bloqueado.com.br'), { lookup_status: 'error', error_code: 'RATE_LIMITED' });
  responses.set('/domain/cai.com.br', { status: 503, headers: {}, body: '' });
  assert.equal((await client.lookup('cai.com.br')).error_code, 'UPSTREAM_ERROR');
  responses.set('/domain/lixo.com.br', { status: 200, headers: {}, body: 'not json' });
  assert.equal((await client.lookup('lixo.com.br')).error_code, 'RDAP_INVALID');
  assert.equal(calls.filter((c) => c.startsWith('data.iana.org')).length, 1, 'bootstrap is cached');
  assert.ok(sleeps.length > 0 && sleeps.every((ms) => ms <= 1000), 'calls to the same registry are spaced');
  const failing = createRdapClient({ transport: async () => { throw Object.assign(new Error('x'), { timeout: true }); }, resolver: async () => ['93.184.216.34'] });
  assert.equal((await failing.lookup('a.com.br')).error_code, 'TIMEOUT');
  const privateRegistry = createRdapClient({ transport, resolver: async () => ['10.0.0.5'] });
  assert.equal((await privateRegistry.lookup('a.com.br')).error_code, 'ADDRESS_FORBIDDEN', 'a registry host resolving to a private address is refused');

  // --- Network guard
  for (const bad of [['127.0.0.1'], ['10.1.2.3'], ['169.254.169.254'], ['93.184.216.34', '192.168.0.1'], []]) {
    await assert.rejects(net.resolvePublic('x.com', async () => bad), (e) => ['ADDRESS_FORBIDDEN', 'DNS_NO_ADDRESS'].includes(e.code));
  }
  assert.equal(await net.resolvePublic('x.com', async () => ['93.184.216.34']), '93.184.216.34');

  // --- SSL probe against a real local TLS server (self-signed -> invalid; far future clock -> expired), and failure mapping.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-ssl-'));
  let haveOpenssl = true;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'), '-days', '30', '-subj', '/CN=exemplo.test/O=Teste CA'], { stdio: 'ignore' });
  } catch { haveOpenssl = false; }
  const publicResolver = async () => ['93.184.216.34'];
  if (haveOpenssl) {
    const server = tls.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (socket) => socket.end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const connect = (options) => tls.connect({ ...options, host: '127.0.0.1', port: server.address().port });
    const invalid = await sslProbe.probe('exemplo.test', { resolver: publicResolver, connect, now: () => Date.now() });
    assert.equal(invalid.ssl_state, 'invalid');
    assert.ok(invalid.ssl_not_after && invalid.ssl_issuer === 'Teste CA' && invalid.ssl_protocol);
    const expired = await sslProbe.probe('exemplo.test', { resolver: publicResolver, connect, now: () => Date.now() + 400 * DAY });
    assert.equal(expired.ssl_state, 'expired');
    server.close();
  }
  const closed = await new Promise((resolve) => { const s = require('node:net').createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  assert.equal((await sslProbe.probe('exemplo.test', { resolver: publicResolver, connect: (o) => tls.connect({ ...o, host: '127.0.0.1', port: closed }) })).ssl_state, 'none');
  assert.equal((await sslProbe.probe('exemplo.test', { resolver: async () => ['127.0.0.1'] })).ssl_state, 'error', 'private addresses are never contacted');
  assert.equal((await sslProbe.probe('exemplo.test', { resolver: async () => { throw new Error('nx'); } })).ssl_state, 'none');

  // --- Cadence
  const delay = (extra, interval = 7) => dm.nextCheckDelayMs(extra, interval, NOW) / DAY;
  assert.equal(delay({ lookupStatus: 'ok', expiresOn: dayFrom(200) }), 7);
  assert.equal(delay({ lookupStatus: 'ok', expiresOn: dayFrom(33) }), 3, 'never later than the day the 30-day window opens');
  assert.equal(delay({ lookupStatus: 'ok', expiresOn: dayFrom(31) }), 1);
  assert.equal(delay({ lookupStatus: 'ok', expiresOn: dayFrom(30) }), 1);
  assert.equal(delay({ lookupStatus: 'ok', expiresOn: dayFrom(5) }), 1);
  assert.equal(delay({ lookupStatus: 'ok', expiresOn: dayFrom(-4) }), 1, 'daily while expired');
  assert.equal(delay({ lookupStatus: 'no_expiry' }, 14), 14);
  assert.equal(delay({ lookupStatus: 'error', errorCode: 'RATE_LIMITED' }), 1 / 24);
  assert.equal(delay({ lookupStatus: 'error', errorCode: 'TIMEOUT' }), 0.25);

  // --- Service
  const results = new Map();
  const probeResults = new Map();
  const fakeRdap = { lookup: async (name) => results.get(name) || { lookup_status: 'not_found' } };
  const fakeSsl = { probe: async (name) => probeResults.get(name) || { ssl_state: 'valid', ssl_issuer: 'CA', ssl_not_after: '2027-01-01T00:00:00.000Z', ssl_protocol: 'TLSv1.3' } };
  let now = NOW;
  const service = dm.createService({ rdap: fakeRdap, ssl: fakeSsl, now: () => now });

  const added = await service.addDomain('Exemplo.COM.br', adminId);
  assert.equal(added.name, 'exemplo.com.br');
  assert.equal(added.source, 'manual');
  assert.equal(added.snapshot, null);
  await assert.rejects(service.addDomain('exemplo.com.br', adminId), { code: 'DM_DUPLICATE' });
  await assert.rejects(service.addDomain('x', adminId), { code: 'DM_NAME_INVALID' });
  const imported = await service.importDomains(['a1.com', 'A1.com', 'b2.net', 'exemplo.com.br', 'inválido', 'c3.org'], adminId);
  assert.deepEqual({ added: imported.added, duplicates: imported.duplicates, invalid: imported.invalid }, { added: 3, duplicates: 1, invalid: ['inválido'] });
  await assert.rejects(service.importDomains([], adminId), { code: 'DM_IMPORT_INVALID' });
  await assert.rejects(service.importDomains(Array.from({ length: 201 }, (_, i) => `d${i}.com`), adminId), { code: 'DM_IMPORT_INVALID' });

  await pg.query("INSERT INTO spfbl_domains(name, source, active) VALUES ('spf.com', 'whm', true), ('gone.com', 'whm', false)");
  assert.equal(await service.syncFromSpfbl(), 1);
  assert.equal(await service.syncFromSpfbl(), 0);
  const spfblRow = (await service.list({ search: 'spf.com' })).domains[0];
  assert.equal(spfblRow.source, 'spfbl');
  await assert.rejects(service.removeDomain(spfblRow.id), { code: 'DM_SOURCE_LOCKED' });

  // A lookup stores the result, no change on the first one, and schedules by cadence.
  results.set('exemplo.com.br', { lookup_status: 'ok', registrar: 'R1', expires_on: dayFrom(20), registered_on: '2020-01-01', rdap_statuses: ['active'], nameservers: ['ns1.a.com'], dnssec: false });
  let checked = await service.checkDomain(added.id, { manual: true });
  assert.equal(checked.snapshot.expires_on, dayFrom(20));
  assert.equal(checked.snapshot.days_left, 20);
  assert.equal(checked.snapshot.ssl.state, 'valid');
  assert.equal(checked.changes, 0);
  const due = (await pg.query('SELECT next_check_at FROM dm_domains WHERE id = $1', [added.id])).rows[0].next_check_at;
  assert.equal(new Date(due).getTime() - now, DAY, 'inside the 30-day window the next lookup is daily');
  await assert.rejects(service.checkDomain(added.id, { manual: true }), { code: 'DM_COOLDOWN', statusCode: 429 });

  // Renewal + DNS change are recorded; an ssl change too.
  now += 2 * DAY;
  results.set('exemplo.com.br', { lookup_status: 'ok', registrar: 'R1', expires_on: dayFrom(385), registered_on: '2020-01-01', rdap_statuses: ['active'], nameservers: ['ns1.b.com', 'ns2.b.com'], dnssec: true });
  probeResults.set('exemplo.com.br', { ssl_state: 'expired', ssl_not_after: '2026-11-01T00:00:00.000Z', ssl_issuer: 'CA', ssl_protocol: 'TLSv1.2' });
  checked = await service.checkDomain(added.id, { manual: true });
  assert.equal(checked.changes, 4);
  const detail = await service.detail(added.id);
  assert.deepEqual(detail.changes.map((c) => c.field).sort(), ['dnssec', 'expires_on', 'nameservers', 'ssl_state']);
  assert.equal(detail.changes.find((c) => c.field === 'expires_on').new_value, dayFrom(385));
  const farDue = (await pg.query('SELECT next_check_at FROM dm_domains WHERE id = $1', [added.id])).rows[0].next_check_at;
  assert.equal(new Date(farDue).getTime() - now, 7 * DAY);

  // A failed registry call keeps the last known data and retries sooner; nothing is invented as a change.
  now += 1 * DAY;
  results.set('exemplo.com.br', { lookup_status: 'error', error_code: 'RATE_LIMITED' });
  checked = await service.checkDomain(added.id);
  assert.equal(checked.snapshot.lookup_status, 'error');
  assert.equal(checked.snapshot.error_code, 'RATE_LIMITED');
  assert.equal(checked.snapshot.expires_on, dayFrom(385), 'previous expiry survives a failed lookup');
  assert.equal(checked.changes, 0);
  assert.equal((await service.detail(added.id)).changes.length, 4);

  // Not found / unsupported are states, not crashes.
  const missing = (await service.list({ search: 'a1.com' })).domains[0];
  checked = await service.checkDomain(missing.id);
  assert.equal(checked.snapshot.lookup_status, 'not_found');
  assert.equal(checked.snapshot.expires_on, null);

  // A probe that throws must not break the lookup.
  const brokenSsl = dm.createService({ rdap: fakeRdap, ssl: { probe: async () => { throw new Error('boom'); } }, now: () => now });
  assert.equal((await brokenSsl.checkDomain(missing.id)).snapshot.ssl.state, 'error');

  // Two lookups of the same domain at once: the second is refused.
  let release;
  const slow = dm.createService({ rdap: { lookup: () => new Promise((resolve) => { release = () => resolve({ lookup_status: 'not_found' }); }) }, ssl: fakeSsl, now: () => now });
  const first = slow.checkDomain(missing.id);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(slow.checkDomain(missing.id), { code: 'DM_BUSY' });
  release(); await first;

  // List: pagination (20/40/100 only), search with LIKE escaping, sort by expiry.
  for (let i = 0; i < 25; i += 1) await service.addDomain(`bulk${i}.com`, adminId);
  const page1 = await service.list({ page: 1, size: 20 });
  const page2 = await service.list({ page: 2, size: 20 });
  assert.equal(page1.domains.length, 20);
  assert.equal(page1.total, page2.total);
  assert.equal((await service.list({ size: 7 })).size, 20);
  assert.equal((await service.list({ search: 'bulk1' })).total, 11);
  assert.equal((await service.list({ search: '%' })).total, 0, 'wildcards in the search are literal');
  assert.equal((await service.list({ sort: 'expiry' })).domains[0].name, 'exemplo.com.br');

  // Settings
  assert.deepEqual(await service.getSettings(), { check_interval_days: 7 });
  assert.deepEqual(await service.saveSettings({ check_interval_days: 14 }), { check_interval_days: 14 });
  for (const bad of [0, 31, 1.5, '7', null, undefined]) await assert.rejects(service.saveSettings({ check_interval_days: bad }), { code: 'DM_INTERVAL_INVALID' });
  await service.saveSettings({ check_interval_days: 7 });

  // Remove a manual domain: snapshot and changes go with it.
  await service.removeDomain(added.id);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_snapshots WHERE domain_id = $1', [added.id])).rows[0].n, 0);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_changes WHERE domain_id = $1', [added.id])).rows[0].n, 0);
  await assert.rejects(service.removeDomain(added.id), { code: 'DM_NOT_FOUND' });

  // --- Scheduler: module off -> nothing; on -> claims at most a batch, due only, and a claimed domain is not taken twice.
  scheduler.resetSchedulerState();
  const countingChecks = [];
  const stub = { syncFromSpfbl: async () => 0, checkDomain: async (id) => { countingChecks.push(id); return { snapshot: { error_code: null } }; } };
  assert.deepEqual(await scheduler.tick({ service: stub, queryable: db, now: () => now }), { skipped: 'module_off' });
  await modules.setModuleEnabled('domain_manager', true, adminId);
  await pg.query("UPDATE dm_domains SET next_check_at = $1", [new Date(now + DAY)]);
  await pg.query("UPDATE dm_domains SET next_check_at = $1 WHERE name LIKE 'bulk%'", [new Date(now - DAY)]);
  const round1 = await scheduler.tick({ service: stub, queryable: db, now: () => now });
  assert.equal(round1.claimed, scheduler.BATCH);
  assert.equal(new Set(countingChecks).size, scheduler.BATCH);
  const round2 = await scheduler.tick({ service: stub, queryable: db, now: () => now });
  assert.equal(round2.claimed, scheduler.BATCH);
  assert.equal(new Set(countingChecks).size, scheduler.BATCH * 2, 'claimed domains are not claimed again');
  // Circuit breaker: three throttled lookups in a row pause the rounds.
  scheduler.resetSchedulerState();
  const throttled = { syncFromSpfbl: async () => 0, checkDomain: async () => ({ snapshot: { error_code: 'RATE_LIMITED' } }) };
  const round3 = await scheduler.tick({ service: throttled, queryable: db, now: () => now });
  assert.equal(round3.checked, 3);
  assert.deepEqual(await scheduler.tick({ service: throttled, queryable: db, now: () => now + 60000 }), { skipped: 'paused' });
  assert.notDeepEqual(await scheduler.tick({ service: stub, queryable: db, now: () => now + scheduler.PAUSE_MS + 1 }), { skipped: 'paused' });
  scheduler.resetSchedulerState();

  // --- Routes: authenticated, module gate, Super Admin, in that order; every route behind them.
  const router = require('../src/routes/domainManagerRoutes');
  const layers = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle.name);
  assert.equal(layers.length, 3);
  assert.equal(layers[0], 'verifyToken');
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`).sort();
  assert.deepEqual(routes, ['DELETE /domains/:id', 'GET /domains', 'GET /domains/:id', 'GET /domains/:id/alerts', 'GET /settings', 'POST /domains', 'POST /domains/:id/check', 'POST /domains/import', 'PUT /domains/:id/alerts', 'PUT /settings']);
  assert.match(read('backend/src/server.js'), /'\/api\/domain-manager'\], generalWriteLimiter/);

  console.log('domain manager tests passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
