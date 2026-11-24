// Stored SPFBL history on a disposable native PostgreSQL: requests, admin decisions, direct unlock, re-block, uncertainty and — the point of
// the real database — concurrent claims. The Matrix client is stubbed (never a real provider); mail is stubbed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const find = () => {
  const embedded = path.join(__dirname, '../node_modules/@embedded-postgres/linux-x64/native/bin');
  const candidates = [process.env.PG_BIN, ...(fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort().reverse().map((v) => `/usr/lib/postgresql/${v}/bin`) : []), embedded].filter(Boolean);
  const dir = candidates.find((d) => fs.existsSync(path.join(d, 'postgres')) && fs.existsSync(path.join(d, 'initdb')));
  if (!dir) throw new Error('PostgreSQL binaries not found (set PG_BIN).');
  return dir;
};
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const root = process.getuid() === 0;
const asServer = root ? { uid: 65534, gid: 65534 } : {};

async function main() {
  const bin = find();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spfbl-release-pg-'));
  if (root) fs.chownSync(dir, 65534, 65534);
  fs.chmodSync(dir, 0o755);
  const data = path.join(dir, 'data'); const port = await freePort();
  const sh = (cmd, args) => { const r = spawnSync(path.join(bin, cmd), args, { encoding: 'utf8', ...asServer }); if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`); };
  sh('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres']);
  sh('pg_ctl', ['-D', data, '-o', `-p ${port} -h 127.0.0.1 -k ${dir}`, '-l', path.join(dir, 'log'), '-w', 'start']);
  let database;
  try {
    Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'postgres', DB_PASSWORD: 'unused', DB_NAME: 'postgres', NODE_ENV: 'test',
      JWT_SECRET: crypto.randomBytes(64).toString('hex'), CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), ADMIN_BOOTSTRAP_TOKEN: crypto.randomBytes(48).toString('hex'),
      APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid' });
    database = require('../src/config/database');
    const mails = [];
    const emailService = require('../src/services/emailService');
    emailService.sendEmail = async (mail) => { if (mail.to === 'bounce@example.invalid') throw new Error('smtp'); mails.push(mail); };
    const { ensureSecuritySchema } = require('../src/config/securitySchema');
    const matrix = require('../src/services/spfblMatrixClient');
    const settings = require('../src/services/spfblSettingsService');
    const access = require('../src/services/spfblAccessService');
    const domains = require('../src/services/spfblDomainsService');
    const release = require('../src/services/spfblReleaseService');
    const history = require('../src/services/spfblHistoryService');
    const controller = require('../src/controllers/spfblController');
    const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    await database.query(read('database/init.sql'));
    await ensureSecuritySchema();
    const migration30 = read('database/migrations/30_create_spfbl_history_storage.sql');
    await database.query(migration30); await database.query(migration30);
    const migration = read('database/migrations/29_create_spfbl_requests.sql');
    await database.query(migration); await database.query(migration); // idempotent
    await database.query("INSERT INTO system_modules (module_key, enabled) VALUES ('spfbl', TRUE) ON CONFLICT (module_key) DO UPDATE SET enabled = TRUE").catch(async () => database.query("INSERT INTO system_modules (key, enabled) VALUES ('spfbl', TRUE) ON CONFLICT (key) DO UPDATE SET enabled = TRUE"));


    const nowS = Math.floor(Date.now() / 1000);
    const iso = (ago) => new Date((nowS - ago) * 1000).toISOString();
    const D = 86400;
    await settings.updateSettings({ matrix_user: 'ops@example.com', matrix_password: 'MATRIX_SECRET_SENTINEL' }, null).catch(async () => {
      await database.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_active,is_super_admin,role) VALUES ('00000000-0000-0000-0000-000000000001','a','a@example.invalid','H','W','S',TRUE,TRUE,'admin')");
      await settings.updateSettings({ matrix_user: 'ops@example.com', matrix_password: 'MATRIX_SECRET_SENTINEL' }, '00000000-0000-0000-0000-000000000001');
    });
    await database.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_active,is_super_admin,role) VALUES ('00000000-0000-0000-0000-000000000001','a','a@example.invalid','H','W','S',TRUE,TRUE,'admin') ON CONFLICT DO NOTHING");
    await domains.addManualDomain('one.example.com', '00000000-0000-0000-0000-000000000001');
    const { createCollector, integrationOf } = require('../src/services/spfblCollectorService');
    const repository = require('../src/services/spfblHistoryRepository');
    const historySettings = require('../src/services/spfblHistorySettingsService');
    const scheduler = require('../src/services/spfblHistoryScheduler');
    const credentials = await settings.getMatrixCredentials();
    const integration = integrationOf(credentials);
    const msg = (key, recipient, ago, result = 'BLOCK', status = 'NONE') => ({ key, recipient, sender: 'bad@out.example', from: '', replyto: '', result, arrival: iso(ago), status });
    const wipe = async () => { await database.query('DELETE FROM spfbl_history_records'); await database.query('DELETE FROM spfbl_history_runs'); };

    // a provider with 5 pages of 2 rows (newest first, 1 day apart) = 10 days
    let fetches = 0; let fail = false;
    const pageOf = (cursor) => { const n = cursor ? Number(cursor) : 0; return { messages: [msg(`K${n * 2}`, 'a@one.example.com', (n * 2 + 1) * D), msg(`K${n * 2 + 1}`, n === 1 ? 'x@unregistered.example' : 'b@one.example.com', (n * 2 + 2) * D)], next: n >= 4 ? null : String(n + 1), signature: `s${n}` }; };
    const build = (caps = {}) => createCollector({ fetchPage: async (cursor) => { fetches += 1; if (fail) throw new Error('boom'); await new Promise((r) => setTimeout(r, 5)); return pageOf(cursor); },
      credentials: async () => credentials, catalogue: async () => ['one.example.com'], sleep: async () => {}, caps });
    const collector = build();

    // full crawl, only registered domains stored, idempotent re-run
    let started = await collector.start({ trigger: 'manual', windowStartTs: nowS - 30 * D });
    let out = await started.done;
    assert.equal(out.status, 'done'); assert.equal(out.pages, 5); assert.equal(out.reachedEnd, true);
    assert.equal((await repository.stats(integration)).rows, 9, 'the unregistered domain is never stored');
    await (await collector.start({ trigger: 'manual', windowStartTs: nowS - 30 * D })).done;
    assert.equal((await repository.stats(integration)).rows, 9, 'a second run does not duplicate');
    let st = await collector.state(integration, nowS - 30 * D); assert.equal(st.complete, true);

    // single flight: concurrent starts share one crawl
    fetches = 0;
    const [s1, s2] = await Promise.all([collector.start({ trigger: 'manual', windowStartTs: nowS - 30 * D }), collector.start({ trigger: 'schedule', windowStartTs: nowS - 30 * D })]);
    assert.notEqual(s1.started, s2.started); assert.equal(s1.runId, s2.runId); await s1.done; assert.equal(fetches, 5);
    assert.equal(Number((await database.query("SELECT COUNT(*)::integer n FROM spfbl_history_runs WHERE status='running'")).rows[0].n), 0);

    // stops shortly after the wanted window instead of walking the whole history
    await wipe(); fetches = 0;
    out = await (await collector.start({ trigger: 'query', windowStartTs: nowS - 2 * D })).done;
    assert.ok(fetches < 5, `stopped after the window (${fetches} pages)`); assert.equal(out.status, 'done');
    assert.equal((await collector.state(integration, nowS - 2 * D)).complete, true);
    assert.equal((await collector.state(integration, nowS - 9 * D)).complete, false, 'a wider window is not claimed as complete');

    // a cap gives a partial result, never a false "complete"
    await wipe();
    out = await (await build({ maxPages: 2 }).start({ trigger: 'manual', windowStartTs: nowS - 30 * D })).done;
    assert.equal(out.status, 'capped'); st = await collector.state(integration, nowS - 30 * D); assert.equal(st.complete, false); assert.equal(st.capped, true);

    // failure is recorded without leaking the error text
    await wipe(); fail = true;
    out = await (await collector.start({ trigger: 'manual', windowStartTs: nowS - D })).done;
    assert.equal(out.status, 'failed'); st = await collector.state(integration, nowS - D); assert.ok(st.error); assert.ok(!JSON.stringify(st).includes('boom')); fail = false;

    // interrupted runs are closed instead of blocking
    await database.query("INSERT INTO spfbl_history_runs (integration_hash, trigger, status, window_start_at, started_at) VALUES ($1,'manual','running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP - INTERVAL '2 hours')", [integration]);
    await collector.markInterrupted();
    assert.equal(Number((await database.query("SELECT COUNT(*)::integer n FROM spfbl_history_runs WHERE status='running'")).rows[0].n), 0);

    // retention: shrinking asks for confirmation, then deletes; options are fixed
    await wipe(); await (await collector.start({ trigger: 'manual', windowStartTs: nowS - 30 * D })).done;
    await database.query("UPDATE spfbl_history_records SET arrival_at = CURRENT_TIMESTAMP - INTERVAL '45 days' WHERE record_id IN (SELECT record_id FROM spfbl_history_records LIMIT 3)");
    await database.query('UPDATE spfbl_settings SET history_retention_days = 60 WHERE id = 1');
    await assert.rejects(historySettings.update({ retention_days: 45 }, integration), { code: 'SPFBL_HISTORY_RETENTION_INVALID' });
    await assert.rejects(historySettings.update({ schedule_hour: 24 }, integration), { code: 'SPFBL_HISTORY_HOUR_INVALID' });
    await assert.rejects(historySettings.update({ retention_days: 30 }, integration), { code: 'SPFBL_HISTORY_SHRINK_CONFIRM', rows_to_delete: 3 });
    assert.equal((await repository.stats(integration)).rows, 9, 'nothing deleted without confirmation');
    const shrunk = await historySettings.update({ retention_days: 30, schedule_hour: 5, confirm_shrink: true }, integration);
    assert.equal(shrunk.deleted, 3); assert.equal(shrunk.retention_days, 30); assert.equal(shrunk.schedule_hour, 5); assert.equal((await repository.stats(integration)).rows, 6);
    assert.equal((await historySettings.update({ retention_days: 90 }, integration)).retention_days, 90, 'growing needs no confirmation');

    // scope: another integration's rows never come back, and a credential change purges them
    await database.query("INSERT INTO spfbl_history_records (record_id, integration_hash, domain, recipient, sender, from_address, replyto, result, provider_status, provider_key, arrival_at) VALUES ($1,'other','one.example.com','z@one.example.com','s','','','BLOCK','NONE','KZ',CURRENT_TIMESTAMP)", ['f'.repeat(64)]);
    const filters = history.parseFilters({ status: 'Todos' });
    const page = await repository.selectPage({ integration, domain: 'one.example.com', filters });
    assert.ok(page.rows.every((r) => r.id !== 'f'.repeat(64)));
    assert.equal(await repository.find(integration, 'f'.repeat(64), 'one.example.com'), null);
    assert.equal(await repository.purgeOtherIntegrations(integration), 1);

    // scheduler: due once per day, claimed in the database, a failure releases the claim
    await wipe(); await database.query('UPDATE spfbl_settings SET history_schedule_hour = 0, history_last_run_date = NULL WHERE id = 1');
    scheduler.resetSchedulerState();
    const first = await scheduler.tick({ collector }); assert.ok(first.ran, JSON.stringify(first));
    const second = await scheduler.tick({ collector }); assert.equal(second.skipped, 'already_ran');
    assert.ok(Number((await database.query("SELECT COUNT(*)::integer n FROM system_audit_events WHERE action='spfbl_history_collected'")).rows[0].n) >= 1);
    await database.query('UPDATE spfbl_settings SET history_last_run_date = NULL WHERE id = 1'); scheduler.resetSchedulerState(); fail = true;
    const bad = await scheduler.tick({ collector }); assert.equal(bad.outcome.status, 'failed'); fail = false;
    assert.equal((await database.query('SELECT history_last_run_date FROM spfbl_settings WHERE id = 1')).rows[0].history_last_run_date, null, 'failed run releases the claim');
    assert.equal((await scheduler.tick({ collector })).skipped, 'busy', 'waits before retrying');
    scheduler.resetSchedulerState(); await database.query('UPDATE spfbl_settings SET history_schedule_hour = 23 WHERE id = 1');
    const hour = scheduler.localParts(Date.now()).hour;
    if (hour < 23) assert.equal((await scheduler.tick({ collector })).skipped, 'before_hour');
    await database.query("UPDATE system_modules SET enabled = FALSE WHERE module_key = 'spfbl'").catch(() => {});

    console.log('PASS spfbl stored history (native PostgreSQL): crawl, idempotence, scope, cap, failure, interruption, retention confirmation, schedule claim.');
  } finally {
    try { await database?.pool.end(); } catch { /* ignore */ }
    spawnSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { ...asServer });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
