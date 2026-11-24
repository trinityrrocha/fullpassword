const db = require('../config/database');
const settings = require('./spfblHistorySettingsService');
const { isModuleEnabled } = require('./modulesService');
const { recordAuditEvent } = require('./auditService');
const { safeLogError } = require('../utils/safeLogger');

// Daily collection at the configured hour (America/Sao_Paulo). The schedule lives in the database, not in a timer:
//   - "today's run" is CLAIMED with a conditional UPDATE, so a restart (the auto-updater recreates the backend) or a second
//     instance cannot run it twice, and a restart after the hour still catches up the same day;
//   - a failed run releases the claim, and the next attempt waits RETRY_MS.
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
  const local = localParts(now());
  if (local.hour < Number(config.history_schedule_hour)) return { skipped: 'before_hour' };
  const claim = await queryable.query('UPDATE spfbl_settings SET history_last_run_date = $1::date WHERE id = 1 AND history_last_run_date IS DISTINCT FROM $1::date RETURNING id', [local.date]);
  if (!claim.rows[0]) return { skipped: 'already_ran' };
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
    await queryable.query('UPDATE spfbl_settings SET history_last_run_date = NULL WHERE id = 1').catch(() => {});
  }
  await recordAuditEvent({ action: 'spfbl_history_collected', status: outcome.status === 'failed' ? 'failed' : 'success',
    metadata: { run: 'schedule', pages: outcome.pages, rows: outcome.stored, capped: outcome.status === 'capped', ...(outcome.error ? { reason: String(outcome.error) } : {}) }, queryable });
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
