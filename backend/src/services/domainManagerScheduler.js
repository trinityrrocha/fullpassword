const db = require('../config/database');
const { isModuleEnabled } = require('./modulesService');
const { getService } = require('./domainManagerService');
const { safeLogError } = require('../utils/safeLogger');

// Lookups are scheduled in the database, not by timers: a domain's turn is CLAIMED with a conditional UPDATE (SKIP LOCKED), so a restart
// or a second instance cannot run it twice. A claimed domain that never finishes comes back after CLAIM_MS. Three registry throttles in a
// row pause the whole round for PAUSE_MS.
const TICK_MS = 60 * 1000;
const BATCH = 5;
const CLAIM_MS = 30 * 60 * 1000;
const PAUSE_MS = 15 * 60 * 1000;
const BREAKER_LIMIT = 3;
let timer = null;
let pausedUntil = 0;
let busy = false;

const tick = async ({ service = getService(), queryable = db, now = Date.now } = {}) => {
  if (busy) return { skipped: 'busy' };
  if (now() < pausedUntil) return { skipped: 'paused' };
  if (!(await isModuleEnabled('domain_manager', queryable))) return { skipped: 'module_off' };
  busy = true;
  try {
    await service.syncFromSpfbl();
    const due = (await queryable.query(
      `UPDATE dm_domains SET next_check_at = $2 WHERE id IN (
         SELECT id FROM dm_domains WHERE active AND next_check_at <= $1 ORDER BY next_check_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
       RETURNING id`, [new Date(now()), new Date(now() + CLAIM_MS)])).rows;
    let throttled = 0;
    let checked = 0;
    for (const { id } of due) {
      try {
        const result = await service.checkDomain(id);
        checked += 1;
        throttled = result.snapshot?.error_code === 'RATE_LIMITED' ? throttled + 1 : 0;
      } catch (error) {
        safeLogError('Falha na consulta agendada de domínio.', { name: error?.name, code: error?.code }, { includeStack: false });
      }
      if (throttled >= BREAKER_LIMIT) { pausedUntil = now() + PAUSE_MS; break; }
    }
    return { checked, claimed: due.length };
  } finally {
    busy = false;
  }
};

const startDomainManagerScheduler = () => {
  if (timer) return timer;
  const run = () => tick().catch((error) => safeLogError('Falha no agendamento do Domain Manager.', { name: error?.name, code: error?.code }, { includeStack: false }));
  timer = setInterval(run, TICK_MS);
  timer.unref?.();
  return timer;
};
const resetSchedulerState = () => { pausedUntil = 0; busy = false; };

module.exports = { tick, startDomainManagerScheduler, resetSchedulerState, PAUSE_MS, BATCH };
