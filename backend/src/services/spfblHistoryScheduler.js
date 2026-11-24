const db = require('../config/database');
const settings = require('./spfblHistorySettingsService');
const { isModuleEnabled } = require('./modulesService');
const { recordAuditEvent } = require('./auditService');
const { safeLogError } = require('../utils/safeLogger');

// Collection every N hours (1, 2, 4, 8, 12 or 24; set by the Super Admin). The schedule lives in the database, not in a timer:
//   - the turn is CLAIMED with a conditional UPDATE, so a restart (the auto-updater recreates the backend) or a second
//     instance cannot run it twice, and a restart simply catches up;
//   - a failed run gives the claim back, and the next attempt waits RETRY_MS.
const TICK_MS = 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
let timer = null;
let lastFailureAt = 0;

const localParts = (ms) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: settings.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};

const tick = async ({ collector, now = Date.now, queryable = db } = {}) => {
  if (collector.isRunning() || now() - lastFailureAt < RETRY_MS) return { skipped: 'busy' };
  if (!(await isModuleEnabled('spfbl', queryable))) return { skipped: 'module_off' };
  const config = await settings.read(queryable);
  const hours = Number(config.history_interval_hours);
  // The turn is CLAIMED with a conditional UPDATE (a restart or a second instance cannot run it twice); `prev` lets a failure give it back.
  const claim = await queryable.query(`UPDATE spfbl_settings s SET history_last_run_at = to_timestamp($1)
      FROM (SELECT history_last_run_at AS prev FROM spfbl_settings WHERE id = 1 FOR UPDATE) p
      WHERE s.id = 1 AND (p.prev IS NULL OR p.prev <= to_timestamp($1) - ($2::integer * INTERVAL '1 hour')) RETURNING p.prev`, [now() / 1000, hours]);
  if (!claim.rows[0]) return { skipped: 'not_due' };
  const previous = claim.rows[0].prev;
  const retention = Number(config.history_retention_days);
  let outcome;
  try {
    const started = await collector.start({ trigger: 'schedule', windowStartTs: now() / 1000 - retention * 86400, retentionDays: retention });
    outcome = await started.done;
  } catch (error) {
    outcome = { status: 'failed', error: error?.code || 'COLLECT_FAILED', pages: 0, stored: 0 };
  }
  if (outcome.status === 'failed') {
    lastFailureAt = now();
    await queryable.query('UPDATE spfbl_settings SET history_last_run_at = $1 WHERE id = 1', [previous]).catch(() => {});
  }
  await recordAuditEvent({ action: 'spfbl_history_collected', status: outcome.status === 'failed' ? 'failed' : 'success',
    metadata: { run: 'schedule', pages: outcome.pages, rows: outcome.stored, capped: outcome.status === 'capped', gap: Boolean(outcome.gap), ...(outcome.error ? { reason: String(outcome.error) } : {}) }, queryable });
  return { ran: true, outcome };
};

const startSpfblHistoryScheduler = ({ collector }) => {
  if (timer) return timer;
  collector.markInterrupted().catch(() => {});
  const run = () => tick({ collector }).catch((error) => safeLogError('Falha no agendamento da coleta do histórico SPFBL.', { name: error?.name, code: error?.code }, { includeStack: false }));
  timer = setInterval(run, TICK_MS);
  timer.unref?.();
  return timer;
};
const resetSchedulerState = () => { lastFailureAt = 0; };

module.exports = { tick, startSpfblHistoryScheduler, localParts, resetSchedulerState, RETRY_MS };
