const db = require('../config/database');
const settings = require('./spfblHistorySettingsService');
const servers = require('./spfblServersService');
const defaultCollectors = require('./spfblCollectors');
const { isModuleEnabled } = require('./modulesService');
const { recordAuditEvent } = require('./auditService');
const { safeLogError } = require('../utils/safeLogger');

// Collection every N minutes (5, 10, 15, 30, 60, 120 or 180; set by the Super Admin), per WHM server (each has its own Matrix connection and its
// own 1024-record window). The schedule lives in the database, not in a timer:
//   - a server's turn is CLAIMED with a conditional UPDATE, so a restart (the auto-updater recreates the backend) or a second
//     instance cannot run it twice, and a restart simply catches up;
//   - a failed run gives the claim back, and that server waits RETRY_MS before the next attempt.
const TICK_MS = 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
let timer = null;
const lastFailureAt = new Map();

const claim = async (queryable, serverId, nowSeconds, minutes, column = 'history_last_run_at') => (await queryable.query(
  `UPDATE spfbl_whm_servers s SET ${column} = to_timestamp($1)
     FROM (SELECT ${column} AS prev FROM spfbl_whm_servers WHERE id = $3 FOR UPDATE) p
    WHERE s.id = $3 AND (p.prev IS NULL OR p.prev <= to_timestamp($1) - ($2::integer * INTERVAL '1 minute')) RETURNING p.prev`,
  [nowSeconds, minutes, serverId])).rows[0] || null;

const tick = async ({ collectors = defaultCollectors, now = Date.now, queryable = db } = {}) => {
  if (collectors.isRunning()) return { skipped: 'busy' };
  if (!(await isModuleEnabled('spfbl', queryable))) return { skipped: 'module_off' };
  const config = await settings.read(queryable);
  const minutes = Number(config.history_interval_minutes);
  const retention = Number(config.history_retention_days);
  const ran = [];
  for (const server of await servers.matrixServers(queryable)) {
    if (now() - (lastFailureAt.get(server.id) || 0) < RETRY_MS) continue;
    const taken = await claim(queryable, server.id, now() / 1000, minutes);
    if (!taken) continue;
    let outcome;
    try {
      const started = await collectors.forServer(server.id).start({ trigger: 'schedule', windowStartTs: now() / 1000 - retention * 86400, retentionDays: retention });
      outcome = await started.done;
    } catch (error) {
      outcome = { status: 'failed', error: error?.code || 'COLLECT_FAILED', pages: 0, stored: 0 };
    }
    if (outcome.status === 'failed') {
      lastFailureAt.set(server.id, now());
      await queryable.query('UPDATE spfbl_whm_servers SET history_last_run_at = $2 WHERE id = $1', [server.id, taken.prev]).catch(() => {});
    }
    await recordAuditEvent({ action: 'spfbl_history_collected', status: outcome.status === 'failed' ? 'failed' : 'success',
      metadata: { run: 'schedule', server: server.name, pages: outcome.pages, rows: outcome.stored, capped: outcome.status === 'capped', gap: Boolean(outcome.gap), ...(outcome.error ? { reason: String(outcome.error) } : {}) }, queryable });
    ran.push({ server_id: server.id, outcome });
  }
  return ran.length ? { ran } : { skipped: 'not_due' };
};

// The sent mail of each WHM server (every server with a token, Matrix or not) is collected on the same interval. Its own claim column keeps it
// apart from the received history; a page load that tops the data up also counts as a run (the service stamps it).
const tickSent = async ({ sentService = require('./spfblSentRuntime'), now = Date.now, queryable = db } = {}) => {
  if (!(await isModuleEnabled('spfbl', queryable))) return { skipped: 'module_off' };
  const minutes = Number((await settings.read(queryable)).history_interval_minutes);
  const ran = [];
  for (const server of await servers.listServers(queryable)) {
    const key = `sent:${server.id}`;
    if (now() - (lastFailureAt.get(key) || 0) < RETRY_MS) continue;
    const taken = await claim(queryable, server.id, now() / 1000, minutes, 'sent_last_run_at');
    if (!taken) continue;
    let outcome;
    try {
      const result = await sentService.collect(server.id, { backfill: true });
      outcome = { status: result.failed ? 'partial' : 'done', stored: result.stored, windows: result.windows, truncated: result.truncated };
    } catch (error) {
      outcome = { status: 'failed', error: error?.code || 'COLLECT_FAILED', stored: 0, windows: 0 };
      lastFailureAt.set(key, now());
      await queryable.query('UPDATE spfbl_whm_servers SET sent_last_run_at = $2 WHERE id = $1', [server.id, taken.prev]).catch(() => {});
    }
    await recordAuditEvent({ action: 'spfbl_sent_collected', status: outcome.status === 'failed' ? 'failed' : 'success',
      metadata: { run: 'schedule', server: server.name, rows: outcome.stored, windows: outcome.windows, capped: Boolean(outcome.truncated), ...(outcome.error ? { reason: String(outcome.error) } : {}) }, queryable });
    ran.push({ server_id: server.id, outcome });
  }
  return ran.length ? { ran } : { skipped: 'not_due' };
};

const startSpfblHistoryScheduler = ({ collectors = defaultCollectors } = {}) => {
  if (timer) return timer;
  collectors.markInterrupted().catch(() => {});
  // Runs left "running" by a previous process are closed on the first collection of each server; this closes them at once.
  db.query("UPDATE spfbl_history_runs SET status = 'failed', error_code = 'INTERRUPTED', finished_at = CURRENT_TIMESTAMP WHERE status = 'running'").catch(() => {});
  const fail = (error) => safeLogError('Falha no agendamento da coleta do histórico SPFBL.', { name: error?.name, code: error?.code }, { includeStack: false });
  const run = () => { tick({ collectors }).catch(fail); tickSent().catch(fail); };
  timer = setInterval(run, TICK_MS);
  timer.unref?.();
  return timer;
};
const resetSchedulerState = () => { lastFailureAt.clear(); };

module.exports = { tick, tickSent, startSpfblHistoryScheduler, resetSchedulerState, RETRY_MS };
