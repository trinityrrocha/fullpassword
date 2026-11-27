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
const sent = require('../src/services/spfblSentService');
const store = require('../src/services/spfblSentStore');
const settings = require('../src/services/spfblHistorySettingsService');
const scheduler = require('../src/services/spfblHistoryScheduler');
const { SPFBL_SENT_STATEMENTS } = require('../src/config/spfblSchema');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });

// All data below is invented.
const NOW = Date.parse('2026-11-27T12:00:00Z');
const sec = (minutesAgo) => Math.floor(NOW / 1000) - minutesAgo * 60;
const raw = (n, extra = {}) => ({
  actionunixtime: String(sec(n)), sendunixtime: String(sec(n)), deliveredto: '', domain: 'exemplo.test', email: 'financeiro@exemplo.test', host: 'mx.destino.example', message: 'Accepted',
  msgid: `m${n}`, recipient: `dest${n}@destino.example`, sender: 'financeiro@exemplo.test', type: 'success', user: 'exemplo01', transport_is_remote: 1, ...extra
});
const S1 = '00000000-0000-0000-0000-0000000000a1';
const S2 = '00000000-0000-0000-0000-0000000000a2';

async function run() {
  await pg.exec(read('database/init.sql'));
  await ensureSecuritySchema();
  // The migration and the runtime statements can run again without changing anything.
  const migration = read('database/migrations/42_spfbl_sent_history.sql');
  await pg.exec(migration); await pg.exec(migration);
  for (const statement of SPFBL_SENT_STATEMENTS) await pg.query(statement);
  await pg.query("UPDATE spfbl_settings SET history_retention_days = 30 WHERE id = 1");
  for (const [id, name, host] of [[S1, 'srv-um', 'um.example.com'], [S2, 'srv-dois', 'dois.example.com']]) {
    await pg.query("INSERT INTO spfbl_whm_servers (id, name, host, whm_user, encrypted_token) VALUES ($1, $2, $3, 'root', 'x')", [id, name, host]);
  }
  await pg.query("UPDATE spfbl_settings SET modules = modules WHERE false").catch(() => {});

  // ---------- settings: 15 and 30 minutes, kept in step with the older column in hours ----------
  assert.deepEqual((await settings.get()).interval_options, [15, 30, 60, 120, 240, 480, 720, 1440]);
  assert.equal((await settings.get()).interval_minutes, 1440, 'the default is daily');
  for (const minutes of [15, 30, 60, 240]) assert.equal((await settings.update({ interval_minutes: minutes })).interval_minutes, minutes);
  assert.equal((await pg.query('SELECT history_interval_hours h FROM spfbl_settings WHERE id = 1')).rows[0].h, 4);
  await settings.update({ interval_minutes: 15 });
  assert.equal((await pg.query('SELECT history_interval_hours h FROM spfbl_settings WHERE id = 1')).rows[0].h, 1, '15 minutes count as 1 hour in the older column');
  for (const statement of SPFBL_SENT_STATEMENTS) await pg.query(statement);
  assert.equal((await settings.get()).interval_minutes, 15, 'running the runtime schema again does not undo the choice');
  for (const bad of [7, 0, 45, '15', null, 1441]) await assert.rejects(settings.update({ interval_minutes: bad }), { code: 'SPFBL_HISTORY_INTERVAL_INVALID' }, String(bad));
  await assert.rejects(pg.query('UPDATE spfbl_settings SET history_interval_minutes = 10'), /./, 'only the offered intervals are accepted by the database');

  // ---------- store: idempotent upsert, scope, filters, paging ----------
  const norm = (item) => sent.normalizeRecord(item);
  const batch = [norm(raw(5)), norm(raw(10, { type: 'failure', domain: '', message: '550 5.1.1 User unknown' })), norm(raw(20, { type: 'defer', message: '452 4.2.2 over quota' })),
    norm(raw(30, { domain: 'outro.test', email: 'x@outro.test', sender: 'x@outro.test' })), norm(raw(40, { sender: 'vendas@exemplo.test', email: 'vendas@exemplo.test' }))];
  assert.equal(await store.upsert(S1, batch), 5);
  assert.equal(await store.upsert(S1, batch), 5, 'the same lines read again are the same rows');
  assert.equal(await store.count(), 5);
  assert.equal(await store.upsert(S2, [norm(raw(5))]), 1, 'the same line on another server is another row');
  const all = await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1] });
  assert.deepEqual([all.period, all.filtered, all.rows.length], [5, 5, 5]);
  assert.deepEqual(all.rows.map((r) => r.detail.msgid), ['m5', 'm10', 'm20', 'm30', 'm40'], 'newest first');
  assert.deepEqual((await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], domains: ['exemplo.test'] })).rows.map((r) => r.detail.msgid), ['m5', 'm10', 'm20', 'm40'], 'a failure without the domain field is attributed through the sender address');
  assert.deepEqual((await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], domains: ['outro.test'] })).rows.map((r) => r.detail.msgid), ['m30']);
  assert.equal((await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], domains: [] })).filtered, 0, 'no domain in scope shows nothing');
  const failed = await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], types: ['failure'] });
  assert.deepEqual([failed.filtered, failed.period], [1, 5], 'the count of the period ignores the result filter');
  assert.deepEqual((await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], q: 'VENDAS'.toLowerCase(), by: 'sender' })).rows.map((r) => r.detail.msgid), ['m40']);
  assert.equal((await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], q: 'dest10', by: 'recipient' })).filtered, 1);
  assert.equal((await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], q: 'dest10', by: 'sender' })).filtered, 0);
  assert.equal((await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], q: '%' })).filtered, 0, 'wildcard characters are searched as text');
  assert.equal((await store.search({ sinceUnix: sec(25), serverIds: [S1] })).filtered, 3, 'the period start');
  const paged = await store.search({ sinceUnix: sec(24 * 60), serverIds: [S1], page: 99, pageSize: 2 });
  assert.deepEqual([paged.page, paged.pages, paged.rows.length], [3, 3, 1], 'a page past the end lands on the last one');
  assert.equal((await store.search({ sinceUnix: sec(24 * 60) })).period, 6, 'no server filter: every server');

  // ---------- service: reads from the database, collects in windows, tops up, scope ----------
  let clock = NOW; const asked = []; let serverRecords = []; let fail = null;
  const settingsRetention = async () => Number((await settings.read()).history_retention_days);
  const make = (extra = {}) => sent.createService({
    credentialsFor: async (id) => ({ id }), serverIdOf: async (domain) => (domain === 'semservidor.test' ? null : S1), allServers: async () => [{ id: S1, name: 'srv-um' }, { id: S2, name: 'srv-dois' }],
    serverIdsOf: async (names) => new Set(names.includes('exemplo.test') ? [S1] : []), now: () => clock, retentionDays: settingsRetention,
    createClient: () => ({ emailTrack: async (args) => {
      asked.push(args); if (fail) throw fail;
      return { records: serverRecords.filter((r) => Number(r.sendunixtime) > args.sinceUnix && Number(r.sendunixtime) < args.untilUnix), truncated: false, stats: [{ kind: 'delivered', chunks: 1, records: 1, ms: 5, error: null }] };
    } }), ...extra });
  await pg.query('DELETE FROM spfbl_sent_records');
  const service = make();
  serverRecords = [raw(5), raw(10, { type: 'failure', domain: '', message: '550 5.1.1 User unknown' }), raw(50, { type: 'defer', message: '452 4.2.2 Over quota' }), raw(60, { domain: 'outro.test', email: 'x@outro.test', sender: 'x@outro.test' }), raw(70, { type: 'rejected' }), raw(24 * 60 * 3)];
  // First use: nothing collected yet -> a background collection starts and the answer says so.
  const first = await service.search({ domain: 'exemplo.test', scope: ['exemplo.test'], admin: false, query: {} });
  assert.equal(first.collecting, true, 'the first use triggers the collection and says so');
  await service.collect(S1); // joins the collection already running
  const state = await store.getState(S1);
  assert.equal(state.through, Math.floor(NOW / 1000), 'the server is collected up to now');
  assert.ok(asked.length >= 10, 'the first collection goes back day by day, not in one call');
  assert.ok(asked.every((call) => call.untilUnix - call.sinceUnix <= 86400 + 60 && call.domain === undefined), 'no call spans more than a day and none carries a domain');
  clock += 10 * 60 * 1000;
  const one = await service.search({ domain: 'exemplo.test', scope: ['exemplo.test', 'outro.test'], admin: false, query: {} });
  assert.equal(one.collecting, false);
  assert.deepEqual(one.rows.map((r) => r.detail.msgid), ['m5', 'm10', 'm50'], 'stored, translated again at read time, without other domains or refused mail');
  assert.deepEqual(one.rows.map((r) => r.result.label), ['Enviado', 'Destinatário inexistente', 'Adiado: caixa cheia']);
  assert.deepEqual([one.retention_days, one.truncated, one.partial, one.servers_failed], [30, false, false, 0]);
  assert.equal('diagnostics' in one, false, 'no diagnostics unless asked');
  assert.deepEqual((await service.search({ domain: 'exemplo.test', scope: ['exemplo.test'], admin: false, query: { period: '90d' } })).rows.length, 4, 'a longer period reaches older stored mail (capped by the retention)');
  const calls = asked.length; await service.search({ domain: 'exemplo.test', scope: ['exemplo.test'], admin: false, query: {} });
  assert.equal(asked.length, calls, 'a second look within two minutes does not call the WHM again');
  clock += 3 * 60 * 1000; serverRecords.push(raw(1, { msgid: 'mnew', sendunixtime: String(Math.floor(clock / 1000) - 30), actionunixtime: String(Math.floor(clock / 1000) - 30) }));
  const topped = await service.search({ domain: 'exemplo.test', scope: ['exemplo.test'], admin: false, query: {}, diagnostics: true });
  assert.ok(asked.length > calls && topped.rows[0].detail.msgid === 'mnew', 'newer than the last collection is fetched when the page is opened');
  assert.ok(asked.slice(calls).every((call) => call.untilUnix - call.sinceUnix < 2 * 86400), 'the top-up asks for a short window only');
  assert.deepEqual([topped.diagnostics.returned.success > 0, typeof topped.diagnostics.stored_period, Array.isArray(topped.diagnostics.calls)], [true, 'number', true]);
  assert.ok(!JSON.stringify(topped.diagnostics).includes('@'), 'the diagnostics carry counts, never addresses');
  // all domains: the Super Admin sees everything, any other account only its scope
  const admin = await service.search({ domain: sent.ALL, scope: [], admin: true, query: { page_size: '100' } });
  assert.ok(admin.rows.some((r) => r.sender_domain === 'outro.test') && admin.rows.every((r) => r.server), 'admin: every domain, with the server name');
  const mine = await service.search({ domain: sent.ALL, scope: ['exemplo.test'], admin: false, query: { page_size: '100' } });
  assert.ok(mine.rows.length > 0 && mine.rows.every((r) => r.sender_domain === 'exemplo.test') && mine.rows.every((r) => !('server' in r)), 'other accounts: their domains only');
  await assert.rejects(service.search({ domain: 'semservidor.test', scope: ['semservidor.test'], query: {} }), { code: 'SPFBL_SENT_NO_SERVER', statusCode: 409 });
  await assert.rejects(service.search({ domain: sent.ALL, scope: ['x.test'], admin: false, query: {} }), { code: 'SPFBL_SENT_NO_SERVER' });
  await assert.rejects(service.search({ domain: 'exemplo.test', scope: ['exemplo.test'], query: { period: 'x' } }), { code: 'SPFBL_SENT_PERIOD' });
  // a failing server: what is stored is still shown, flagged as partial; the admin sees which one
  clock += 3 * 60 * 1000; fail = Object.assign(new Error('x'), { code: 'WHM_AUTH_REFUSED' });
  const degraded = await service.search({ domain: sent.ALL, scope: [], admin: true, query: { page_size: '100' } });
  assert.deepEqual([degraded.partial, degraded.servers_failed > 0, degraded.rows.length > 0, degraded.servers_failed_names[0].code], [true, true, true, 'WHM_AUTH_REFUSED']);
  assert.equal((await store.getState(S1)).through, Math.floor((NOW + 10 * 60 * 1000 + 3 * 60 * 1000) / 1000), 'a failed top-up does not advance the collection');
  fail = null;
  // a window that fails halfway keeps the progress already made
  await pg.query('UPDATE spfbl_whm_servers SET sent_collected_through = NULL WHERE id = $1', [S1]);
  let n = 0; const flaky = make({ createClient: () => ({ emailTrack: async () => { n += 1; if (n === 4) throw Object.assign(new Error('x'), { code: 'WHM_TIMEOUT' }); return { records: [], truncated: false, stats: [] }; } }) });
  const partialRun = await flaky.collect(S1, { backfill: true });
  assert.deepEqual([partialRun.failed, partialRun.windows], [true, 3]);
  assert.ok((await store.getState(S1)).through > 0, 'the windows that worked are kept');
  const second = make({ createClient: () => ({ emailTrack: async (args) => { asked.push(args); return { records: [], truncated: false, stats: [] }; } }) });
  const resumedFrom = (await store.getState(S1)).through; asked.length = 0; await second.collect(S1);
  assert.ok(asked[0].sinceUnix >= resumedFrom - 7200 && asked.length < 10, 'the next run resumes from where it stopped');

  // ---------- retention ----------
  await pg.query('DELETE FROM spfbl_sent_records');
  await store.upsert(S1, [norm(raw(5)), norm(raw(24 * 60 * 40, { msgid: 'old' }))]);
  assert.equal(await store.prune(30), 1); assert.equal(await store.count(), 1);
  await store.upsert(S1, [norm(raw(24 * 60 * 20, { msgid: 'mid' }))]);
  const shrink = await settings.update({ retention_days: 60 });
  assert.equal(shrink.retention_days, 60);

  // ---------- scheduler: every server with a token, own claim, interval in minutes ----------
  await pg.query('UPDATE spfbl_whm_servers SET sent_last_run_at = NULL, sent_collected_through = NULL');
  await pg.query("INSERT INTO system_modules (module_key, enabled) VALUES ('spfbl', TRUE) ON CONFLICT (module_key) DO UPDATE SET enabled = TRUE").catch(async () => pg.query("UPDATE system_modules SET enabled = TRUE WHERE module_key = 'spfbl'"));
  await settings.update({ interval_minutes: 15, retention_days: 30, confirm_shrink: true });
  const ran = [];
  const fakeSent = { collect: async (id, options) => { ran.push([id, options.backfill]); return { stored: 3, windows: 1, truncated: false, failed: false }; } };
  let t = NOW; scheduler.resetSchedulerState();
  const first1 = await scheduler.tickSent({ sentService: fakeSent, now: () => t });
  assert.equal(first1.ran.length, 2, 'both servers are collected (Matrix connection is not needed)');
  assert.deepEqual(ran.map((r) => r[1]), [true, true]);
  assert.equal((await scheduler.tickSent({ sentService: fakeSent, now: () => t })).skipped, 'not_due');
  t += 14 * 60 * 1000; assert.equal((await scheduler.tickSent({ sentService: fakeSent, now: () => t })).skipped, 'not_due', '14 minutes is not due on a 15-minute interval');
  t += 2 * 60 * 1000; assert.equal((await scheduler.tickSent({ sentService: fakeSent, now: () => t })).ran.length, 2, '16 minutes is due');
  await settings.update({ interval_minutes: 60 }); t += 30 * 60 * 1000;
  assert.equal((await scheduler.tickSent({ sentService: fakeSent, now: () => t })).skipped, 'not_due', '30 minutes is not due on an hourly interval');
  const failing = { collect: async () => { throw Object.assign(new Error('x'), { code: 'WHM_TIMEOUT' }); } };
  t += 40 * 60 * 1000; const bad = await scheduler.tickSent({ sentService: failing, now: () => t });
  assert.equal(bad.ran[0].outcome.status, 'failed');
  assert.equal((await scheduler.tickSent({ sentService: fakeSent, now: () => t + 60 * 1000 })).skipped, 'not_due', 'a failed server waits before the next attempt');
  const audited = (await pg.query("SELECT metadata FROM system_audit_events WHERE action = 'spfbl_sent_collected' ORDER BY created_at DESC LIMIT 1")).rows[0];
  assert.ok(audited && !JSON.stringify(audited.metadata).includes('@'), 'the collection is audited, without addresses');
  console.log('PASS spfbl sent history: stored lines, idempotent upsert, scope, day windows, top-up, partial progress, retention, 15/30-minute interval and scheduler.');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
