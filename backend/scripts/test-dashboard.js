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
  APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid', NODE_ENV: 'production', BACKEND_APP_COMMIT: 'a'.repeat(40)
});
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
const db = require('../src/config/database');
const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const authMiddleware = require('../src/middleware/authMiddleware');
authMiddleware.verifyToken = async (req, res, next) => {
  const id = req.get('x-test-user');
  const row = id ? (await pg.query('SELECT id, email, role, is_super_admin FROM users WHERE id = $1', [id])).rows[0] : null;
  if (!row) return res.status(401).json({ error: 'sem sessão' });
  req.user = { id: row.id, email: row.email, role: row.role, is_super_admin: row.is_super_admin };
  return next();
};
const { ensureSecuritySchema } = require('../src/config/securitySchema');
const modules = require('../src/services/modulesService');
const dm = require('../src/services/domainManagerService');
const dash = require('../src/services/dashboardService');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1); const ALICE = id(2);
const hours = (n) => new Date(Date.now() - n * 3600 * 1000);
const days = (n) => new Date(Date.now() - n * 86400 * 1000);

async function run() {
  await pg.exec(read('database/init.sql'));
  await pg.query(`INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,role,is_super_admin,is_active) VALUES
    ($1,'Admin','admin@example.invalid','H','W','S','admin',true,true), ($2,'Alice','alice@example.invalid','H','W','S','user',false,true)`, [ADMIN, ALICE]);
  await ensureSecuritySchema(); await ensureSecuritySchema();
  const migration = read('database/migrations/40_dashboard_layouts.sql');
  await pg.exec(migration); await pg.exec(migration);
  const service = dash.getService();

  // --- Layout: unknown ids are dropped, repeats count once, new cards are appended, bad shapes are refused.
  assert.deepEqual(await service.getLayout(ADMIN), { order: dash.CARD_IDS, hidden: [] }, 'the default layout is every card in the default order');
  assert.equal(await service.saveLayout(ADMIN, null), null);
  for (const bad of [{}, { order: 'x', hidden: [] }, { order: ['nope'], hidden: [] }, { order: [], hidden: ['nope'] }, { order: dash.CARD_IDS.concat('a'), hidden: [] }, [], { order: [1], hidden: [] }]) {
    assert.equal(await service.saveLayout(ADMIN, bad), null, JSON.stringify(bad));
  }
  const saved = await service.saveLayout(ADMIN, { order: ['last_backup', 'security_alerts', 'security_alerts'], hidden: ['spam_senders', 'spam_senders'] });
  assert.deepEqual(saved.order.slice(0, 2), ['last_backup', 'security_alerts']);
  assert.deepEqual([...saved.order].sort(), [...dash.CARD_IDS].sort(), 'cards missing from the saved order are appended');
  assert.deepEqual(saved.hidden, ['spam_senders']);
  assert.deepEqual(await service.getLayout(ADMIN), saved);
  assert.deepEqual(await service.getLayout(ALICE), { order: dash.CARD_IDS, hidden: [] }, 'layouts are per account');
  assert.deepEqual(await service.resetLayout(ADMIN), { order: dash.CARD_IDS, hidden: [] });
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM user_dashboard_layouts')).rows[0].n, 0);

  // --- Cards with the modules off: only the system cards are available.
  let cards = await service.overview();
  assert.deepEqual(Object.keys(cards).sort(), [...dash.CARD_IDS].sort());
  for (const card of ['domains_health', 'domain_expirations', 'unlock_requests', 'spam_senders']) assert.deepEqual(cards[card], { available: false }, `${card} needs its module`);
  assert.equal(cards.security_alerts.available, true);
  assert.deepEqual(cards.last_backup.data, { last_success: null, last_run: null });
  assert.deepEqual(cards.recent_logins.data.items, []);

  // --- Domain Manager cards.
  await modules.setModuleEnabled('domain_manager', true, ADMIN);
  const domainService = dm.getService();
  const made = {};
  for (const name of ['ok.com', 'vencido.com', 'logo.com', 'novo.com', 'ssl.com']) made[name] = (await domainService.addDomain(name, ADMIN)).id;
  const snap = (name, offset, ssl = 'valid') => pg.query(`INSERT INTO dm_snapshots (domain_id, checked_at, lookup_status, expires_on, ssl_state) VALUES ($1, now(), 'ok', (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + $2::int, $3)`, [made[name], offset, ssl]);
  await snap('ok.com', 200); await snap('vencido.com', -5); await snap('logo.com', 10); await snap('ssl.com', 300, 'expired');
  const mail = (name, spf, dmarc, dkim) => pg.query('INSERT INTO dm_mail_checks (domain_id, checked_at, spf_status, dmarc_status, dkim_status) VALUES ($1, now(), $2, $3, $4)', [made[name], spf, dmarc, dkim]);
  await mail('ok.com', 'ok', 'ok', 'ok'); await mail('vencido.com', 'ok', 'ok', 'ok'); await mail('logo.com', 'warning', 'absent', 'ok'); await mail('ssl.com', 'ok', 'ok', 'ok');
  cards = await service.overview();
  const health = cards.domains_health.data;
  assert.deepEqual([health.total, health.expired, health.expiring, health.waiting, health.ssl_problem, health.healthy], [5, 1, 1, 1, 1, 2], 'ok.com and ssl.com are healthy by registry and mail (the certificate has its own counter)');
  assert.deepEqual(health.mail.spf, { ok: 3, warning: 1 }); assert.deepEqual(health.mail.dmarc, { ok: 3, absent: 1 });
  const expirations = cards.domain_expirations.data.items;
  assert.deepEqual(expirations.map((row) => [row.name, row.days_left]), [['vencido.com', -5], ['logo.com', 10], ['ok.com', 200], ['ssl.com', 300]], 'ascending by date, expired first, no date = not listed');
  assert.match(expirations[0].expires_on, /^\d{4}-\d{2}-\d{2}$/);
  await domainService.removeDomain(made['logo.com']);
  assert.equal((await service.overview()).domains_health.data.total, 4, 'removed domains leave the numbers');
  await pg.query('UPDATE dm_domains SET active = FALSE WHERE id = $1', [made['novo.com']]);
  assert.equal((await service.overview()).domains_health.data.waiting, 0, 'inactive domains are not counted');

  // --- Security cards from the audit trail.
  const audit = (action, status, email, ip, at) => pg.query('INSERT INTO system_audit_events (action, status, user_email, ip_address, created_at) VALUES ($1,$2,$3,$4,$5)', [action, status, email, ip, at]);
  for (let i = 0; i < 3; i += 1) await audit('login_failed', 'failed', 'x@example.invalid', i === 2 ? '203.0.113.9' : '203.0.113.7', hours(1 + i));
  await audit('login_failed', 'failed', 'old@example.invalid', '203.0.113.8', hours(30));
  await audit('login_success', 'success', 'admin@example.invalid', '198.51.100.1', hours(2));
  await audit('login_success', 'success', 'alice@example.invalid', '198.51.100.2', hours(1));
  await audit('ip_blocked', 'success', null, '203.0.113.7', hours(1));
  await pg.query(`INSERT INTO ip_security_rules (ip_address, rule_type, is_active, expires_at) VALUES ('203.0.113.7','temporary_block',TRUE, now() + interval '1 hour'), ('203.0.113.8','temporary_block',TRUE, now() - interval '1 hour'), ('203.0.113.9','block',FALSE,NULL), ('203.0.113.10','allow',TRUE,NULL)`);
  cards = await service.overview();
  assert.deepEqual([cards.login_activity.data.failed, cards.login_activity.data.failed_ips, cards.login_activity.data.success, cards.login_activity.data.auto_blocks, cards.login_activity.data.active_blocks], [3, 2, 2, 1, 1], 'last 24 h only; only active, unexpired block rules');
  assert.deepEqual(cards.recent_logins.data.items.map((row) => row.user_email), ['alice@example.invalid', 'admin@example.invalid'], 'newest first');
  assert.ok(cards.security_alerts.data.total >= 3 && cards.security_alerts.data.items.length <= 6);
  assert.ok(cards.security_alerts.data.items.every((item) => item.title && item.target_url && item.severity));
  assert.equal(JSON.stringify(cards.security_alerts).includes('user_agent'), false);

  // --- Backup card: newest success, and a newer failure shows up separately.
  await pg.query(`INSERT INTO cloud_backup_runs (provider, status, trigger_type, size_bytes, started_at, finished_at) VALUES ('ftp','success','scheduled',2048,$1,$1), ('ftp','failed','scheduled',NULL,$2,$2)`, [days(2), hours(3)]);
  await pg.query(`INSERT INTO google_drive_backup_runs (status, trigger_type, size_bytes, started_at, finished_at) VALUES ('success','manual',4096,$1,$1)`, [days(1)]);
  cards = await service.overview();
  assert.deepEqual([cards.last_backup.data.last_success.provider, cards.last_backup.data.last_success.size_bytes], ['google_drive', 4096], 'the newest success across both backup tables');
  assert.deepEqual([cards.last_backup.data.last_run.status, cards.last_backup.data.last_run.provider], ['failed', 'ftp'], 'a newer failure is visible');

  // --- SPFBL cards.
  await modules.setModuleEnabled('spfbl', true, ADMIN);
  const hist = (n, domain, sender, status, at) => pg.query(
    `INSERT INTO spfbl_history_records (record_id, integration_hash, domain, recipient, sender, from_address, provider_status, provider_key, arrival_at) VALUES ($1,$2,$3,'r@x.com',$4,'',$5,'k',$6)`,
    [String(n).padStart(64, '0'), 'h'.repeat(64), domain, sender, status, at]);
  let n = 0;
  for (let i = 0; i < 4; i += 1) await hist(++n, i % 2 ? 'a.com' : 'b.com', 'bot@spam.example', 'BLOCKED', days(20 - i));
  for (let i = 0; i < 2; i += 1) await hist(++n, 'a.com', 'x@other.example', 'BLOCKED', days(2));
  await hist(++n, 'a.com', 'ok@friend.example', 'WHITELISTED', days(1));
  await hist(++n, 'a.com', '', 'BLOCKED', days(1));
  await hist(++n, 'a.com', 'old@ancient.example', 'BLOCKED', days(40));
  cards = await service.overview();
  const spam = cards.spam_senders.data.items;
  assert.deepEqual(spam.map((row) => [row.sender_domain, row.blocked, row.targets]), [['spam.example', 4, 2], ['other.example', 2, 1]], 'only BLOCKED, only the last 30 days, no empty sender, most blocked first');
  assert.ok(new Date(spam[0].last_at) > new Date(spam[0].first_at), 'it reports for how long the sender has been seen');
  assert.equal(JSON.stringify(cards.spam_senders).includes('country'), false, 'no country is invented');
  assert.deepEqual([cards.unlock_requests.data.pending, cards.unlock_requests.data.items], [0, []]);
  const request = (status, domain, at) => pg.query(`INSERT INTO spfbl_requests (record_id, domain, recipient, sender, provider_key, integration_hash, status, requested_at) VALUES ($1,$2,'r@x.com','s@spam.example','k',$3,$4,$5)`, [`${domain}${status}`.padEnd(64, '0'), domain, 'h'.repeat(64), status, at]);
  await request('pending', 'a.com', days(3)); await request('reopened', 'b.com', days(1)); await request('unlocked', 'c.com', days(5)); await request('kept', 'd.com', days(5));
  cards = await service.overview();
  assert.equal(cards.unlock_requests.data.pending, 2, 'pending and reopened count; finished ones do not');
  assert.deepEqual(cards.unlock_requests.data.items.map((row) => [row.domain, row.reopened]), [['a.com', false], ['b.com', true]], 'oldest first');

  // --- One failing card never takes the others down.
  const broken = dash.createService({ queryable: { query: async (sql, params) => { if (/FROM dm_mail_checks/.test(sql)) throw new Error('boom'); return query(sql, params); } } });
  const partial = await broken.overview();
  assert.deepEqual(partial.domains_health, { available: true, error: true });
  assert.equal(partial.last_backup.available && !partial.last_backup.error, true);

  // --- The router: Super Admin only, one request for the page, layout saved and reset.
  const app = express(); app.use(express.json()); app.use('/api/dashboard', require('../src/routes/dashboardRoutes'));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const call = async (method, url, user, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard${url}`, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  assert.equal((await call('GET', '', null)).status, 401);
  for (const [method, url, body] of [['GET', ''], ['PUT', '/layout', { order: [], hidden: [] }], ['DELETE', '/layout']]) assert.equal((await call(method, url, ALICE, body)).status, 403, `${method} ${url} is Super Admin only`);
  const page = await call('GET', '', ADMIN);
  assert.equal(page.status, 200);
  assert.deepEqual(Object.keys(page.body).sort(), ['cards', 'generated_at', 'layout']);
  assert.equal(page.body.cards.domains_health.available, true);
  assert.equal((await call('PUT', '/layout', ADMIN, { order: ['last_backup'], hidden: 'x' })).status, 422);
  const put = await call('PUT', '/layout', ADMIN, { order: ['last_backup', 'login_activity'], hidden: ['recent_logins'] });
  assert.deepEqual([put.status, put.body.layout.order.slice(0, 2), put.body.layout.hidden], [200, ['last_backup', 'login_activity'], ['recent_logins']]);
  assert.deepEqual((await call('GET', '', ADMIN)).body.layout, put.body.layout, 'the saved layout comes back with the page');
  assert.equal((await call('DELETE', '/layout', ADMIN)).body.layout.hidden.length, 0);
  const stack = require('../src/routes/dashboardRoutes').stack;
  assert.ok(stack[0].handle === authMiddleware.verifyToken && stack[1].handle === require('../src/middleware/requireSuperAdmin'), 'authentication, then the Super Admin gate, before any route');
  server.close();
  console.log('dashboard tests passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
