const db = require('../config/database');
const settings = require('./spfblHistorySettingsService');
const servers = require('./spfblServersService');
const defaultCollectors = require('./spfblCollectors');
const { isModuleEnabled } = require('./modulesService');
const { recordAuditEvent } = require('./auditService');
const { safeLogError } = require('../utils/safeLogger');

// Collection every N hours (1, 2, 4, 8, 12 or 24; set by the Super Admin), per WHM server (each has its own Matrix connection and its
// own 1024-record window). The schedule lives in the database, not in a timer:
//   - a server's turn is CLAIMED with a conditional UPDATE, so a restart (the auto-updater recreates the backend) or a second
//     instance cannot run it twice, and a restart simply catches up;
//   - a failed run gives the claim back, and that server waits RETRY_MS before the next attempt.
const TICK_MS = 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
let timer = null;
const lastFailureAt = new Map();

const claim = async (queryable, serverId, nowSeconds, hours) => (await queryable.query(
  `UPDATE spfbl_whm_servers s SET history_last_run_at = to_timestamp($1)
     FROM (SELECT history_last_run_at AS prev FROM spfbl_whm_servers WHERE id = $3 FOR UPDATE) p
    WHERE s.id = $3 AND (p.prev IS NULL OR p.prev <= to_timestamp($1) - ($2::integer * INTERVAL '1 hour')) RETURNING p.prev`,
  [nowSeconds, hours, serverId])).rows[0] || null;

const tick = async ({ collectors = defaultCollectors, now = Date.now, queryable = db } = {}) => {
  if (collectors.isRunning()) return { skipped: 'busy' };
  if (!(await isModuleEnabled('spfbl', queryable))) return { skipped: 'module_off' };
  const config = await settings.read(queryable);
  const hours = Number(config.history_interval_hours);
  const retention = Number(config.history_retention_days);
  const ran = [];
  for (const server of await servers.matrixServers(queryable)) {
    if (now() - (lastFailureAt.get(server.id) || 0) < RETRY_MS) continue;
    const taken = await claim(queryable, server.id, now() / 1000, hours);
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

const startSpfblHistoryScheduler = ({ collectors = defaultCollectors } = {}) => {
  if (timer) return timer;
  collectors.markInterrupted().catch(() => {});
  // Runs left "running" by a previous process are closed on the first collection of each server; this closes them at once.
  db.query("UPDATE spfbl_history_runs SET status = 'failed', error_code = 'INTERRUPTED', finished_at = CURRENT_TIMESTAMP WHERE status = 'running'").catch(() => {});
  const run = () => tick({ collectors }).catch((error) => safeLogError('Falha no agendamento da coleta do histórico SPFBL.', { name: error?.name, code: error?.code }, { includeStack: false }));
  timer = setInterval(run, TICK_MS);
  timer.unref?.();
  return timer;
};
const resetSchedulerState = () => { lastFailureAt.clear(); };

module.exports = { tick, startSpfblHistoryScheduler, resetSchedulerState, RETRY_MS };
