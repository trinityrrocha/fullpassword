const db = require('../config/database');
const { isModuleEnabled } = require('./modulesService');
const { getService } = require('./domainManagerService');
const { getAlertService } = require('./domainManagerAlerts');
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
let lastAlertPassAt = 0;
const ALERT_EVERY_MS = 10 * 60 * 1000;

const MAIL_BATCH = 10;

// Order: alerts and mail checks first (they never depend on a registry), the registry lookups last. A registry that throttles
// (the breaker below) pauses ONLY its own lookups, never the alerts or the DNS checks.
const tick = async ({ service = getService(), alerts = getAlertService(), queryable = db, now = Date.now } = {}) => {
  if (busy) return { skipped: 'busy' };
  if (!(await isModuleEnabled('domain_manager', queryable))) return { skipped: 'module_off' };
  busy = true;
  try {
    await service.syncFromSpfbl();
    // The periodic import of the WHM domains (when enabled and due) comes first, so a new domain enters this very round.
    try { await service.autoSyncDomains(); } catch (error) { safeLogError('Falha na sincronização de domínios com os servidores.', { name: error?.name, code: error?.code }, { includeStack: false }); }
    // Alerts run on their own, slower beat, independent of the registry lookups.
    if (now() - lastAlertPassAt >= ALERT_EVERY_MS) {
      lastAlertPassAt = now();
      try { await alerts.processDue(); } catch (error) { safeLogError('Falha nos alertas do Domain Manager.', { name: error?.name, code: error?.code }, { includeStack: false }); }
    }
    let mailChecked = 0;
    try {
      for (const id of await service.claimMailBatch(MAIL_BATCH)) {
        try { if (await service.checkMail(id)) mailChecked += 1; } catch (error) {
          safeLogError('Falha na verificação de e-mail de um domínio.', { name: error?.name, code: error?.code }, { includeStack: false });
        }
      }
    } catch (error) { safeLogError('Falha ao reservar verificações de e-mail.', { name: error?.name, code: error?.code }, { includeStack: false }); }
    if (now() < pausedUntil) return { skipped: 'paused', mail_checked: mailChecked };
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
    return { checked, claimed: due.length, mail_checked: mailChecked };
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
const resetSchedulerState = () => { pausedUntil = 0; busy = false; lastAlertPassAt = 0; };

module.exports = { tick, startDomainManagerScheduler, resetSchedulerState, PAUSE_MS, BATCH, MAIL_BATCH };
