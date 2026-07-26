// Compatibilidade para imports antigos: todo o agendamento delega ao scheduler
// Cloud singleton. Este arquivo não cria intervalo próprio.
const cloudScheduler = require('./cloudBackupScheduler');

module.exports = {
  getLocalScheduleParts: cloudScheduler.getLocalScheduleParts,
  getScheduledSlot: cloudScheduler.getScheduledSlot,
  getNextExecutionAt: (settings, from) => cloudScheduler.getNextExecutionAt({
    ...settings,
    active_provider: settings?.active_provider || 'google_drive'
  }, from),
  executeSchedulerTick: cloudScheduler.executeSchedulerTick,
  startGoogleDriveBackupScheduler: cloudScheduler.startCloudBackupScheduler
};
