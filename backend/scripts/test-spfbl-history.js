// Phase 2A: staged in-memory history, dashboard, record detail, status lookup. No network: the Matrix client is stubbed.
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
const matrix = require('../src/services/spfblMatrixClient');
const history = require('../src/services/spfblHistoryService');
const settings = require('../src/services/spfblSettingsService');
const access = require('../src/services/spfblAccessService');
const domains = require('../src/services/spfblDomainsService');
const modules = require('../src/services/modulesService');
const controller = require('../src/controllers/spfblController');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const call = async (handler, user, extra = {}) => { const res = response(); await handler({ user, params: {}, query: {}, body: {}, get: () => 'agent', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra }, res); return res; };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const nowSeconds = Math.floor(Date.now() / 1000);
const iso = (secondsAgo) => new Date((nowSeconds - secondsAgo) * 1000).toISOString();

async function run() {
  // ---- pure rules ----
  assert.deepEqual(history.classify('BANNED'), { status: 'Bloqueados', reason: 'Rejeitada por banimento', category: 'banimento', icon: 'banned' });
  assert.equal(history.classify('block').category, 'segurança'); assert.equal(history.classify('GREYLIST').category, 'inexistência');
  assert.equal(history.classify('ACCEPT').status, 'Livres'); assert.equal(history.classify(undefined).status, 'Livres');
  assert.equal(history.normalizeEmail(' User@Example.COM '), 'user@example.com');
  for (const bad of ['a@b', 'a b@c.com', '@c.com', 'a@@c.com', 'a..b@c.com', '.a@c.com', 'a@-c.com', 'a@c.c', 123, null]) assert.equal(history.normalizeEmail(bad), '', String(bad));
  assert.equal(history.belongs('x@sub.example.com', 'example.com'), false, 'exact domain only, no implicit subdomains');
  assert.equal(history.belongs('x@example.com', 'example.com'), true);
  assert.equal(history.parseArrival('2026-11-23T20:10:30Z'), Date.parse('2026-11-23T20:10:30Z') / 1000);
  assert.equal(history.parseArrival('2026-11-23 20:10:30 -0300'), Date.parse('2026-11-23T23:10:30Z') / 1000);
  assert.equal(history.parseArrival('Mon, 23 Nov 2026 20:10:30 -0300'), Date.parse('2026-11-23T23:10:30Z') / 1000);
  for (const bad of ['', 'yesterday', '2026-11-23 20:10:30', 5, null]) assert.equal(history.parseArrival(bad), null, String(bad));
  // America/Sao_Paulo day boundaries (UTC-3): midnight local = 03:00Z
  assert.equal(history.zonedMidnight(2026, 11, 23), Date.parse('2026-11-23T03:00:00Z') / 1000);
  const fixedNow = Date.parse('2026-11-23T23:30:00Z'); // 20:30 in Sao Paulo, still the 23rd
  const f = history.parseFilters({}, fixedNow);
  assert.equal(f.end, '2026-11-23'); assert.equal(f.start, '2026-11-17'); assert.equal(f.start_ts, Date.parse('2026-11-17T03:00:00Z') / 1000);
  assert.equal(history.parseFilters({}, Date.parse('2026-11-24T02:30:00Z')).end, '2026-11-23', '23:30 local on the 23rd is already the 24th in UTC');
  for (const bad of [{ status: 'x' }, { by: 'x' }, { email: 'nope' }, { start: '2026-02-30' }, { start: '2026-08-01' }, { end: '2026-11-25' }, { start: ['a'] }]) {
    assert.throws(() => history.parseFilters(bad, fixedNow), history.HistoryError, JSON.stringify(bad));
  }

  // ---- rows ----
  const integration = 'integration-hash';
  const raw = (key, recipient, result, secondsAgo, extra = {}) => ({ key, recipient, sender: 'sender@out.example', from: 'from@out.example', replyto: '', result, arrival: iso(secondsAgo), status: 'NONE', ...extra });
  const row = history.normalizeRecord(raw('K1', 'Daniel@One.Example.com', 'BLOCK', 100), integration);
  assert.equal(row.recipient, 'daniel@one.example.com'); assert.equal(row.provider_key, 'K1'); assert.match(row.id, /^[a-f0-9]{64}$/);
  assert.notEqual(history.normalizeRecord(raw('K1', 'daniel@one.example.com', 'BLOCK', 100), 'another').id, row.id, 'ids are bound to the integration');
  assert.equal(history.normalizeRecord(raw('', 'a@one.example.com', 'BLOCK', 1), integration), null, 'no synthetic keys');
  assert.equal(history.normalizeRecord(raw('K', 'bad', 'BLOCK', 1), integration), null);
  assert.equal(history.normalizeRecord({ ...raw('K', 'a@one.example.com', 'BLOCK', 1), arrival: 'soon' }, integration), null);
  assert.equal(history.normalizeRecord({ ...raw('K', 'a@one.example.com', 'BLOCK', 1), status: 'WEIRD' }, integration).provider_status, 'UNKNOWN');
  assert.throws(() => history.normalizeRecord({ ...raw('K', 'a@one.example.com', 'BLOCK', 1), sender: { a: 1 } }, integration), history.HistoryError);
  assert.equal(history.normalizeRecord(raw(12345678901234567890n.toString(), 'a@one.example.com', 'BLOCK', 1), integration).provider_key, '12345678901234567890');
  assert.ok(!('provider_key' in history.publicRow(row)), 'the provider key never reaches the client');

  // ---- selection / overview ----
  const rows = [raw('1', 'a@one.example.com', 'BLOCK', 3600), raw('2', 'b@one.example.com', 'ACCEPT', 7200), raw('3', 'a@two.example.com', 'BANNED', 3600),
    raw('4', 'c@sub.one.example.com', 'BLOCK', 100), raw('5', 'a@one.example.com', 'BLOCK', 40 * 86400), raw('6', 'd@one.example.com', 'INEXISTENT', 600, { sender: 'Spam@X.example' })]
    .map((r) => history.normalizeRecord(r, integration));
  const filters = history.parseFilters({}, Date.now());
  let sel = history.selectRows(rows, 'one.example.com', filters, 1);
  assert.equal(sel.period, 3, 'only that exact domain and the 7-day period'); assert.equal(sel.filtered, 2); assert.equal(sel.rows[0].recipient, 'd@one.example.com', 'newest first');
  sel = history.selectRows(rows, 'one.example.com', history.parseFilters({ status: 'Todos' }, Date.now()), 1); assert.equal(sel.filtered, 3);
  sel = history.selectRows(rows, 'one.example.com', history.parseFilters({ status: 'Todos', email: 'spam@x.example' }, Date.now()), 1); assert.equal(sel.filtered, 1, 'sender match is case-insensitive');
  sel = history.selectRows(rows, 'one.example.com', history.parseFilters({ status: 'Todos', by: 'recipient', email: 'b@one.example.com' }, Date.now()), 1); assert.equal(sel.filtered, 1);
  const big = Array.from({ length: 60 }, (_, i) => history.normalizeRecord(raw(`b${i}`, `u${i}@one.example.com`, 'BLOCK', 10 + i), integration));
  assert.equal(history.selectRows(big, 'one.example.com', filters, 3).rows.length, 10); assert.equal(history.selectRows(big, 'one.example.com', filters, 99).page, 3);
  const overview = history.buildOverview(rows, ['one.example.com']);
  assert.equal(overview.total, 3); assert.equal(overview.blocked, 2); assert.deepEqual(overview.domains, [{ name: 'one.example.com', count: 2 }]);

  // ---- handlers (scope) ----
  await pg.exec(read('database/init.sql')); await ensureSecuritySchema();
  const ids = { admin: id(1), alice: id(2), bob: id(3) };
  const seed = (key, email, superAdmin) => pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_active,is_super_admin,role) VALUES ($1,$2,$3,'H','W','S',TRUE,$4,$5)", [ids[key], key, email, superAdmin, superAdmin ? 'admin' : 'user']);
  await seed('admin', 'admin@example.invalid', true); await seed('alice', 'alice@example.invalid', false); await seed('bob', 'bob@example.invalid', false);
  const admin = { id: ids.admin, email: 'admin@example.invalid', role: 'admin', is_super_admin: true };
  const user = (key) => ({ id: ids[key], email: `${key}@example.invalid`, role: 'user', is_super_admin: false });
  await modules.setModuleEnabled?.('spfbl', true, ids.admin).catch(() => {});
  await pg.query("INSERT INTO system_modules(key, enabled) VALUES ('spfbl', TRUE) ON CONFLICT (key) DO UPDATE SET enabled = TRUE").catch(() => {});
  await settings.updateSettings({ matrix_user: 'ops@example.com', matrix_password: 'MATRIX_SECRET_SENTINEL' }, ids.admin);
  await domains.addManualDomain('one.example.com', ids.admin); await domains.addManualDomain('two.example.com', ids.admin);
  const d = Object.fromEntries((await domains.listDomains()).map((r) => [r.name.split('.')[0], r.id]));
  await access.saveAccess(ids.alice, { unlock_mode: 'review', domain_ids: [d.one] }, ids.admin);

  let calls = 0; let lastCredentials;
  const providerPage = { messages: rows.map((r) => ({ key: r.provider_key, recipient: r.recipient, sender: r.sender, from: r.from, replyto: r.replyto, result: r.result, arrival: new Date(r.timestamp * 1000).toISOString(), status: 'NONE' })), next: null, signature: 'only' };
  matrix.historyPage = async (credentials) => { calls += 1; lastCredentials = credentials; return providerPage; };
  let lookup = null;
  matrix.registry = async (credentials, key) => lookup(key);
  const recollect = async () => { await pg.query('DELETE FROM spfbl_history_records'); await pg.query('DELETE FROM spfbl_history_runs'); await (await controller.collector.start({ trigger: 'manual', windowStartTs: Date.now() / 1000 - 8 * 86400 })).done; };
  await recollect();

  let res = await call(controller.dashboard, user('alice')); assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.domains_scope, ['one.example.com']); assert.equal(res.body.total, 3);
  assert.equal(JSON.stringify(res.body).includes('MATRIX_SECRET_SENTINEL'), false); assert.equal(lastCredentials.password, 'MATRIX_SECRET_SENTINEL');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  res = await call(controller.dashboard, user('bob')); assert.equal(res.code, 403, 'no grant, no access');
  res = await call(controller.dashboard, admin); assert.equal(res.code, 200); assert.deepEqual(res.body.domains_scope.sort(), ['one.example.com', 'two.example.com']);

  res = await call(controller.historyList, user('alice'), { query: { domain: 'two.example.com' } }); assert.equal(res.code, 403, 'another domain of the same Matrix account is invisible');
  res = await call(controller.historyList, user('alice'), { query: { domain: 'one.example.com', status: 'Todos' } }); assert.equal(res.code, 200);
  assert.equal(res.body.filtered_total, 3); assert.ok(res.body.rows.every((r) => r.recipient.endsWith('@one.example.com')));
  assert.ok(!JSON.stringify(res.body).includes('provider_key') && !JSON.stringify(res.body).includes('"key"'), 'no provider key in the response');
  res = await call(controller.historyList, user('alice'), { query: { domain: 'one.example.com', start: 'garbage' } }); assert.equal(res.code, 422);
  res = await call(controller.historyList, user('alice'), { query: { domain: 'bad domain' } }); assert.equal(res.code, 422);
  const first = (await call(controller.historyList, user('alice'), { query: { domain: 'one.example.com' } })).body.rows[0];

  // revoking the grant applies at once
  res = await call(controller.recordDetail, user('alice'), { params: { id: first.id }, query: { domain: 'one.example.com' } }); assert.equal(res.code, 200); assert.equal(res.body.record.id, first.id);
  res = await call(controller.recordDetail, user('alice'), { params: { id: first.id }, query: { domain: 'two.example.com' } }); assert.equal(res.code, 403);
  res = await call(controller.recordDetail, user('alice'), { params: { id: 'zz' }, query: { domain: 'one.example.com' } }); assert.equal(res.code, 404);
  const other = (await call(controller.historyList, admin, { query: { domain: 'two.example.com', status: 'Todos' } })).body.rows[0];
  res = await call(controller.recordDetail, user('alice'), { params: { id: other.id }, query: { domain: 'one.example.com' } }); assert.equal(res.code, 404, 'a record of another domain is not found through an authorized one');

  // status lookup
  controller.resetStatusState();
  const mine = await require('../src/services/spfblHistoryRepository').find(require('node:crypto').createHash('sha256').update('ops@example.com').digest('hex'), first.id, 'one.example.com');
  lookup = (key) => ({ key, recipient: mine.recipient, sender: mine.sender, from: mine.from, replyto: mine.replyto, result: mine.result, arrival: new Date(mine.timestamp * 1000).toISOString(), status: 'WHITELISTED' });
  res = await call(controller.recordStatus, user('alice'), { params: { id: first.id }, body: { domain: 'one.example.com' } }); assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.provider_status, 'WHITELISTED'); assert.equal(res.body.changed_reason, false);
  res = await call(controller.recordStatus, user('alice'), { params: { id: first.id }, body: { domain: 'one.example.com' } }); assert.equal(res.code, 429, 'cool-down between lookups');
  controller.resetStatusState();
  lookup = (key) => ({ key, recipient: 'someone-else@one.example.com', result: 'BLOCK', arrival: iso(5), status: 'NONE' });
  res = await call(controller.recordStatus, user('alice'), { params: { id: first.id }, body: { domain: 'one.example.com' } }); assert.equal(res.code, 409, 'a different record from the provider is refused');
  await access.revokeAccess(ids.alice);
  res = await call(controller.historyList, user('alice'), { query: { domain: 'one.example.com' } }); assert.equal(res.code, 403, 'revoked access applies on the next request');
  assert.ok(calls >= 1);
  console.log('PASS spfbl history: rules, filters in America/Sao_Paulo, stored history, scope per request, no provider keys, status lookup.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
