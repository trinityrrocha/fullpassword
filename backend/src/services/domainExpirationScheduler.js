const { processDomainExpirationNotifications } = require('./domainExpirationService');
const { safeLogError } = require('../utils/safeLogger');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let schedulerTimer = null;

const runDomainExpirationScheduler = async () => {
  try {
    const result = await processDomainExpirationNotifications();
    if (!result.skipped) console.log(`Notificações de vencimento de domínio processadas: ${result.delivered} entrega(s).`);
  } catch (error) {
    safeLogError('Falha segura no scheduler de vencimento de domínio.', { name: error?.name, code: error?.code }, { includeStack: false });
  }
};

const startDomainExpirationScheduler = () => {
  if (schedulerTimer) return schedulerTimer;
  runDomainExpirationScheduler();
  schedulerTimer = setInterval(runDomainExpirationScheduler, ONE_DAY_MS);
  schedulerTimer.unref?.();
  return schedulerTimer;
};

module.exports = { runDomainExpirationScheduler, startDomainExpirationScheduler };
