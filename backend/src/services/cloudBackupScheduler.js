const db = require('../config/database');
const { recordAuditEvent } = require('./auditService');
const { getRawSettings } = require('./cloudBackupSettingsService');
const { runCloudBackup } = require('./cloudBackupService');
const { safeLogError } = require('../utils/safeLogger');
const {
  notifyCloudBackupFailure,
  notifyCloudBackupRecovery
} = require('./cloudBackupNotificationService');

// Mantém o mesmo lock do scheduler legado para impedir duplicidade durante
// rolling updates onde uma instância antiga ainda possa estar ativa.
const SCHEDULER_LOCK_ID = 8142027;
const CHECK_INTERVAL_MS = 30 * 1000;
const WEEKDAY_NUMBER = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
});

let schedulerStop = null;

const getScheduleTimeZone = () => String(process.env.TZ || 'America/Sao_Paulo').trim();

const getLocalScheduleParts = (date = new Date(), timeZone = getScheduleTimeZone()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === '24' ? '00' : values.hour;
  return {
    weekday: WEEKDAY_NUMBER[values.weekday],
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${hour}:${values.minute}`,
    timeZone
  };
};

const getScheduledSlot = (settings, date = new Date()) => {
  const parts = getLocalScheduleParts(date);
  const days = Array.isArray(settings?.schedule_days) ? settings.schedule_days.map(Number) : [];
  const times = Array.isArray(settings?.schedule_times) ? settings.schedule_times : [];
  if (!days.includes(parts.weekday) || !times.includes(parts.time)) return null;
  return `${parts.date}T${parts.time}@${parts.timeZone}`;
};

const getNextExecutionAt = (settings, from = new Date()) => {
  if (
    !settings?.enabled
    || !settings?.schedule_enabled
    || !settings?.active_provider
    || settings.active_provider === 'none'
  ) return null;
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let index = 0; index < 8 * 24 * 60; index += 1) {
    if (getScheduledSlot(settings, cursor)) return cursor.toISOString();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
};

const executeSchedulerTick = async () => {
  const client = await db.pool.connect();
  let locked = false;
  try {
    const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [SCHEDULER_LOCK_ID]);
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) return;

    const settings = await getRawSettings(client);
    if (
      settings.enabled !== true
      || settings.schedule_enabled !== true
      || settings.active_provider === 'none'
      || !settings.encrypted_backup_passphrase
    ) return;

    const scheduledSlot = getScheduledSlot(settings);
    if (!scheduledSlot) return;
    const result = await runCloudBackup({
      triggerType: 'scheduled',
      userId: settings.updated_by,
      scheduledSlot
    }, client);
    if (result.skipped) return;

    await recordAuditEvent({
      user: settings.updated_by ? { id: settings.updated_by } : null,
      action: 'cloud_backup_run_succeeded',
      status: 'success',
      metadata: {
        provider: result.provider,
        trigger_type: 'scheduled',
        run_id: result.run_id,
        backup_format: result.backup_format,
        size_bytes: result.size_bytes,
        retention_removed: result.retention_removed
      },
      queryable: client
    });
    if (result.retention_removed > 0) {
      await recordAuditEvent({
        user: settings.updated_by ? { id: settings.updated_by } : null,
        action: 'cloud_backup_retention_cleaned',
        status: 'success',
        metadata: {
          provider: result.provider,
          removed_count: result.retention_removed
        },
        queryable: client
      });
    }
    if (result.retention_warning) {
      await recordAuditEvent({
        user: settings.updated_by ? { id: settings.updated_by } : null,
        action: 'cloud_backup_retention_cleaned',
        status: 'failed',
        metadata: {
          provider: result.provider,
          reason: 'retention_cleanup_failed'
        },
        queryable: client
      });
    }
    if (result.recovered_from_failure) {
      await notifyCloudBackupRecovery({
        provider: result.provider,
        triggerType: 'scheduled',
        user: settings.updated_by ? { id: settings.updated_by } : null
      });
    }
  } catch (error) {
    safeLogError('Falha sanitizada no agendador de Backup Nuvem.', {
      name: 'CloudBackupSchedulerError'
    }, { includeStack: false });
    await recordAuditEvent({
      action: 'cloud_backup_run_failed',
      status: 'failed',
      metadata: {
        trigger_type: 'scheduled',
        reason: error?.code || 'operation_failed'
      },
      queryable: client
    }).catch(() => {});
    await notifyCloudBackupFailure({
      triggerType: 'scheduled',
      error
    });
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_ID]).catch(() => {});
    client.release();
  }
};

const startCloudBackupScheduler = () => {
  if (schedulerStop) return schedulerStop;
  const interval = setInterval(() => {
    executeSchedulerTick().catch(() => {});
  }, CHECK_INTERVAL_MS);
  interval.unref?.();
  setImmediate(() => executeSchedulerTick().catch(() => {}));
  schedulerStop = () => {
    clearInterval(interval);
    schedulerStop = null;
  };
  return schedulerStop;
};

module.exports = {
  SCHEDULER_LOCK_ID,
  getLocalScheduleParts,
  getScheduledSlot,
  getNextExecutionAt,
  executeSchedulerTick,
  startCloudBackupScheduler
};
