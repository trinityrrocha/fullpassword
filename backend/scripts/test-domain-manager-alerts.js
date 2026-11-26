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
const { BACKUP_TABLES, OPTIONAL_BACKUP_TABLES } = require('../src/config/backupTables');
const alertsModule = require('../src/services/domainManagerAlerts');
const dm = require('../src/services/domainManagerService');
const scheduler = require('../src/services/domainManagerScheduler');
const security = require('../src/controllers/securityController');
const modules = require('../src/services/modulesService');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });

const DAY = 86400000;
const NOW = Date.parse('2026-11-26T15:00:00Z');
const dayFrom = (offset) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

async function run() {
  await pg.exec(read('database/init.sql'));
  const adminId = '00000000-0000-0000-0000-0000000000a1';
  const otherAdminId = '00000000-0000-0000-0000-0000000000a2';
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_super_admin,is_active) VALUES ($1,'A','admin@example.invalid','H','W','S',true,true),($2,'B','inactive@example.invalid','H','W','S',true,false)", [adminId, otherAdminId]);
  await ensureSecuritySchema(); await ensureSecuritySchema();

  // --- Schema: fresh, ensure and migration are idempotent; cascade; backups know the tables.
  const migration = read('database/migrations/36_domain_manager_alerts.sql');
  await pg.exec(migration); await pg.exec(migration);
  for (const table of ['dm_alert_settings', 'dm_notifications_sent']) assert.ok(BACKUP_TABLES.includes(table) && OPTIONAL_BACKUP_TABLES.has(table));

  // --- Steps: each fires on the first pass inside its range; nothing outside 30 days before .. 10 days after.
  const keys = (days) => alertsModule.eventFor(days)?.key ?? null;
  assert.deepEqual([31, 30, 16, 15, 6, 5, 1, 0, -1, -10, -11, null, 1.5].map(keys), [null, 'before-30', 'before-30', 'before-15', 'before-15', 'before-5', 'before-5', 'due', 'expired-1', 'expired-10', null, null, null]);
  assert.equal(alertsModule.eventFor(0).expired, true);
  assert.equal(alertsModule.eventFor(3).expired, false);

  // --- E-mails
  assert.deepEqual(alertsModule.normalizeEmails([' A@x.com ', 'a@x.com', 'b@y.org']), ['a@x.com', 'b@y.org']);
  for (const bad of [['nope'], [''], [5], 'a@x.com', null, Array.from({ length: 21 }, (_, i) => `u${i}@x.com`), [`${'a'.repeat(250)}@x.com`]]) {
    assert.throws(() => alertsModule.normalizeEmails(bad), { code: 'DM_ALERT_EMAILS_INVALID' });
  }

  // --- Settings
  const sent = [];
  let failFor = new Set();
  let now = NOW;
  const send = async (mail) => { if (failFor.has(mail.to)) throw Object.assign(new Error('smtp'), { code: 'SMTP' }); sent.push(mail); };
  const alerts = alertsModule.createAlertService({ send, now: () => now });
  const service = dm.createService({ rdap: { lookup: async () => ({ lookup_status: 'not_found' }) }, ssl: { probe: async () => ({ ssl_state: 'none' }) }, now: () => now });
  const domain = await service.addDomain('alvo.com.br', adminId);
  assert.deepEqual(await alerts.getAlerts(domain.id), { enabled: false, notify_admins: false, emails: [] });
  await assert.rejects(alerts.getAlerts('00000000-0000-0000-0000-00000000ffff'), { code: 'DM_NOT_FOUND' });
  await assert.rejects(alerts.saveAlerts(domain.id, { enabled: true, notify_admins: false, emails: [] }, adminId), { code: 'DM_ALERT_NO_RECIPIENT' });
  for (const bad of [null, [], { enabled: 'yes', notify_admins: false, emails: [] }, { enabled: true, notify_admins: 1, emails: [] }]) {
    await assert.rejects(alerts.saveAlerts(domain.id, bad, adminId), { code: 'DM_ALERT_INVALID' });
  }
  await assert.rejects(alerts.saveAlerts(domain.id, { enabled: true, notify_admins: false, emails: ['x'] }, adminId), { code: 'DM_ALERT_EMAILS_INVALID' });
  assert.deepEqual(await alerts.saveAlerts(domain.id, { enabled: false, notify_admins: false, emails: [] }, adminId), { enabled: false, notify_admins: false, emails: [] }, 'disabled needs no recipient');
  const saved = await alerts.saveAlerts(domain.id, { enabled: true, notify_admins: true, emails: ['Cliente@Empresa.com', 'cliente@empresa.com', 'ti@empresa.com'] }, adminId);
  assert.deepEqual(saved, { enabled: true, notify_admins: true, emails: ['cliente@empresa.com', 'ti@empresa.com'] });
  const row = (await service.list({ search: 'alvo' })).domains[0];
  assert.deepEqual(row.alerts, { enabled: true, notify_admins: true, emails: 2 }, 'the list shows a summary, never the addresses');
  assert.ok(!JSON.stringify(row).includes('empresa.com'));

  const setExpiry = (id, expiresOn) => pg.query(
    `INSERT INTO dm_snapshots (domain_id, checked_at, lookup_status, expires_on) VALUES ($1, $2, 'ok', $3)
     ON CONFLICT (domain_id) DO UPDATE SET expires_on = EXCLUDED.expires_on, lookup_status = 'ok'`, [id, new Date(now), expiresOn]);

  // --- Nothing to send when the expiry is far, unknown or too old.
  await setExpiry(domain.id, dayFrom(45));
  assert.deepEqual(await alerts.processDue(), { sent: 0, bells: 0, failed: 0 });
  await setExpiry(domain.id, dayFrom(-11));
  assert.deepEqual(await alerts.processDue(), { sent: 0, bells: 0, failed: 0 });

  // --- First pass inside the window: both addresses and the active Super Admin (not the inactive one), one bell.
  await setExpiry(domain.id, dayFrom(20));
  assert.deepEqual(await alerts.processDue(), { sent: 3, bells: 1, failed: 0 });
  assert.deepEqual(sent.map((m) => m.to).sort(), ['admin@example.invalid', 'cliente@empresa.com', 'ti@empresa.com']);
  const first = sent[0];
  assert.equal(first.subject, 'Domínio próximo do vencimento: alvo.com.br');
  assert.match(first.text, /vence em 20 dias \(vencimento em \d{2}\/\d{2}\/\d{4}\)/);
  assert.ok(first.text.includes(`vencimento em ${dayFrom(20).split('-').reverse().join('/')}`));
  assert.ok(first.text.includes('https://example.invalid/domains'));
  assert.deepEqual(await alerts.processDue(), { sent: 0, bells: 0, failed: 0 }, 'same step, same expiry: never twice');
  const concurrent = await Promise.all([alerts.processDue(), alerts.processDue()]);
  assert.equal(concurrent.reduce((n, r) => n + r.sent + r.bells, 0), 0);

  // --- Next step on a later day; a missed exact day still alerts.
  now += 17 * DAY; // 3 days left: the 15-day step was never seen, only the current one is sent
  sent.length = 0;
  assert.deepEqual(await alerts.processDue(), { sent: 3, bells: 1, failed: 0 });
  assert.ok(sent.every((m) => /vence em 3 dias/.test(m.text)));
  // Past the expiry: expired wording, daily.
  now += 5 * DAY; // 2 days after
  sent.length = 0;
  assert.deepEqual(await alerts.processDue(), { sent: 3, bells: 1, failed: 0 });
  assert.equal(sent[0].subject, 'Domínio vencido: alvo.com.br');
  assert.match(sent[0].text, /venceu há 2 dias/);
  now -= 22 * DAY; // back to the original day for the rest of the cases

  // --- A renewal (new expiry date) starts a fresh sequence.
  await setExpiry(domain.id, dayFrom(400));
  assert.deepEqual(await alerts.processDue(), { sent: 0, bells: 0, failed: 0 });
  await setExpiry(domain.id, dayFrom(20));
  assert.deepEqual(await alerts.processDue(), { sent: 0, bells: 0, failed: 0 }, 'same date as before: the record is kept');
  await setExpiry(domain.id, dayFrom(21));
  sent.length = 0;
  assert.equal((await alerts.processDue()).sent, 3, 'a different expiry date is a new sequence');

  // --- The bell: a Super Admin sees it with the right text and link.
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const bellReq = { user: { id: adminId, email: 'admin@example.invalid', role: 'admin', is_super_admin: true }, get: () => 'agent', headers: {}, socket: { remoteAddress: '127.0.0.1' }, query: {} };
  const res = response();
  await security.getSecurityNotifications(bellReq, res);
  const bell = res.body.items.find((item) => /vence em 21 dias/.test(item.summary));
  assert.ok(bell, 'the alert reaches the bell');
  assert.equal(bell.title, 'Domínio próximo do vencimento');
  assert.match(bell.summary, /vence em 21 dias — alvo\.com\.br/);
  assert.equal(bell.target_url, '/domains');
  assert.deepEqual([bell.severity, bell.status_label], ['warning', 'Atenção']);
  assert.ok(!JSON.stringify(bell).includes('empresa.com'), 'no recipient addresses in the bell');

  // --- Failure: the claim is released and retried after an hour, not before.
  const domain2 = await service.addDomain('falha.com', adminId);
  await alerts.saveAlerts(domain2.id, { enabled: true, notify_admins: false, emails: ['quebra@x.com', 'ok@x.com'] }, adminId);
  await setExpiry(domain2.id, dayFrom(3));
  failFor = new Set(['quebra@x.com']);
  sent.length = 0;
  assert.deepEqual(await alerts.processDue(), { sent: 1, bells: 0, failed: 1 });
  assert.deepEqual(sent.map((m) => m.to), ['ok@x.com']);
  failFor = new Set();
  assert.deepEqual(await alerts.processDue(), { sent: 0, bells: 0, failed: 0 }, 'no retry before the wait is over');
  now += 61 * 60000;
  assert.deepEqual(await alerts.processDue(), { sent: 1, bells: 0, failed: 0 });
  assert.equal(sent.at(-1).to, 'quebra@x.com');
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM dm_notifications_sent WHERE domain_id = $1 AND recipient = 'bell'", [domain2.id])).rows[0].n, 0, 'no bell without "notify the administrators"');
  now -= 61 * 60000;

  // --- Disabled alerts and inactive domains stay silent.
  const domain3 = await service.addDomain('mudo.com', adminId);
  await alerts.saveAlerts(domain3.id, { enabled: true, notify_admins: false, emails: ['mudo@x.com'] }, adminId);
  await setExpiry(domain3.id, dayFrom(2));
  await alerts.saveAlerts(domain3.id, { enabled: false, notify_admins: false, emails: ['mudo@x.com'] }, adminId);
  sent.length = 0;
  assert.equal((await alerts.processDue()).sent, 0);
  await alerts.saveAlerts(domain3.id, { enabled: true, notify_admins: false, emails: ['mudo@x.com'] }, adminId);
  await pg.query('UPDATE dm_domains SET active = FALSE WHERE id = $1', [domain3.id]);
  assert.equal((await alerts.processDue()).sent, 0);
  await pg.query('UPDATE dm_domains SET active = TRUE WHERE id = $1', [domain3.id]);

  // --- The vault's own expiry notice is not duplicated: an address it already covers for the same domain is skipped.
  const client = (await pg.query("INSERT INTO clients (name) VALUES ('Cliente') RETURNING id")).rows[0].id;
  await pg.query("INSERT INTO domain_expiration_notifications (client_id, hosting_server_id, domain, expiration_date, notify_emails) VALUES ($1, 'srv-1', 'MUDO.com', $2, $3::jsonb)", [client, dayFrom(2), JSON.stringify(['mudo@x.com'])]);
  await alerts.saveAlerts(domain3.id, { enabled: true, notify_admins: false, emails: ['mudo@x.com', 'novo@x.com'] }, adminId);
  sent.length = 0;
  assert.equal((await alerts.processDue()).sent, 1);
  assert.deepEqual(sent.map((m) => m.to), ['novo@x.com'], 'the address of the vault notice is left to the vault notice');

  // --- Review fixes: a failed bell record is retried; one broken domain never stops the others.
  const domain4 = await service.addDomain('sino.com', adminId);
  const domain5 = await service.addDomain('irmao.com', adminId);
  for (const [item, who] of [[domain4, 'sino@x.com'], [domain5, 'irmao@x.com']]) {
    await alerts.saveAlerts(item.id, { enabled: true, notify_admins: true, emails: [who] }, adminId);
    await setExpiry(item.id, dayFrom(2));
  }
  await pg.query('UPDATE dm_alert_settings SET enabled = FALSE WHERE domain_id NOT IN ($1, $2)', [domain4.id, domain5.id]);
  let auditCalls = 0;
  const flaky = alertsModule.createAlertService({ send, now: () => now, audit: async (args) => { auditCalls += 1; if (auditCalls === 1) { assert.equal(args.throwOnError, true, 'the bell record must report its own failure'); throw new Error('db down'); } return require('../src/services/auditService').recordAuditEvent(args); } });
  sent.length = 0;
  const firstPass = await flaky.processDue();
  assert.equal(firstPass.failed, 1, 'the failed bell record is counted');
  assert.equal(firstPass.bells, 1, 'the other domain still got its bell');
  const retryPass = await flaky.processDue();
  assert.equal(retryPass.bells, 1, 'the failed bell is retried on the next pass (its claim was released)');
  assert.equal(retryPass.sent, 0, 'mails already sent are not repeated');
  // A query that blows up for one domain: the rest of the pass continues.
  await setExpiry(domain4.id, dayFrom(1)); await setExpiry(domain5.id, dayFrom(1));
  const broken = { query: (sql, params) => (/INSERT INTO dm_notifications_sent/.test(sql) && params[0] === domain4.id ? Promise.reject(new Error('fk')) : db.query(sql, params)) };
  const isolated = alertsModule.createAlertService({ queryable: broken, send, now: () => now });
  sent.length = 0;
  const isolatedResult = await isolated.processDue();
  assert.ok(isolatedResult.failed >= 1);
  assert.ok(sent.some((mail) => mail.to === 'irmao@x.com'), 'the healthy domain was still processed');

  // --- Removing a domain removes its alert settings and history.
  await service.removeDomain(domain3.id);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_alert_settings WHERE domain_id = $1', [domain3.id])).rows[0].n, 0);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_notifications_sent WHERE domain_id = $1', [domain3.id])).rows[0].n, 0);

  // --- Scheduler: the alert pass runs on its own beat (not every minute) and a failure never stops the lookups.
  scheduler.resetSchedulerState();
  await modules.setModuleEnabled('domain_manager', true, adminId);
  let passes = 0;
  const stubService = { syncFromSpfbl: async () => 0, checkDomain: async () => ({ snapshot: {} }) };
  const stubAlerts = { processDue: async () => { passes += 1; } };
  await pg.query('UPDATE dm_domains SET next_check_at = $1', [new Date(now + DAY)]);
  await scheduler.tick({ service: stubService, alerts: stubAlerts, queryable: db, now: () => now });
  await scheduler.tick({ service: stubService, alerts: stubAlerts, queryable: db, now: () => now + 60000 });
  assert.equal(passes, 1, 'one pass per ten minutes');
  await scheduler.tick({ service: stubService, alerts: stubAlerts, queryable: db, now: () => now + 11 * 60000 });
  assert.equal(passes, 2);
  scheduler.resetSchedulerState();
  const brokenAlerts = { processDue: async () => { throw new Error('boom'); } };
  await pg.query('UPDATE dm_domains SET next_check_at = $1', [new Date(now - DAY)]);
  const afterFailure = await scheduler.tick({ service: stubService, alerts: brokenAlerts, queryable: db, now: () => now });
  assert.ok(afterFailure.claimed > 0, 'lookups still run when the alert pass fails');

  // --- Routes
  const router = require('../src/routes/domainManagerRoutes');
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.ok(routes.includes('GET /domains/:id/alerts') && routes.includes('PUT /domains/:id/alerts'));
  const controllerSource = read('backend/src/controllers/domainManagerController.js');
  assert.ok(!/emails:\s*alerts\.emails\s*[,}]/.test(controllerSource.split('domain_manager_alerts_saved')[1].split('\n')[0]), 'the audit keeps only the number of addresses');

  console.log('domain manager alerts tests passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
