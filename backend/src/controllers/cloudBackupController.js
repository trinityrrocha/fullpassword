const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const {
  CloudBackupSettingsError,
  assertProvider,
  getStatus,
  getRawSettings,
  saveProviderConfiguration,
  selectProvider,
  updateSettings,
  disconnectProvider,
  listRuns
} = require('../services/cloudBackupSettingsService');
const {
  CloudBackupError,
  testActiveProvider,
  runCloudBackup
} = require('../services/cloudBackupService');
const {
  revokeAndDisconnect,
  GoogleDriveBackupError
} = require('../services/googleDriveBackupService');
const { getNextExecutionAt } = require('../services/cloudBackupScheduler');
const { ConfigEncryptionError } = require('../services/configSecretCrypto');
const { safeLogError } = require('../utils/safeLogger');

const deny = async (req, res, action) => {
  await recordAuditEvent({
    user: req.user,
    action,
    status: 'denied',
    req,
    metadata: { reason: 'not_super_admin' }
  });
  return res.status(403).json({ error: 'Acesso restrito ao Super Admin.' });
};

const sendSafeError = (res, error, fallbackMessage) => {
  if (
    error instanceof CloudBackupSettingsError
    || error instanceof CloudBackupError
    || error instanceof GoogleDriveBackupError
    || error instanceof ConfigEncryptionError
  ) {
    return res.status(error.statusCode || 503).json({ code: error.code, error: error.message });
  }
  safeLogError('Falha interna sanitizada no Backup Nuvem.', {
    name: 'CloudBackupControllerError'
  }, { includeStack: false });
  return res.status(500).json({ error: fallbackMessage });
};

const status = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'cloud_backup_status_access');
  try {
    const [settings, recentRuns] = await Promise.all([getStatus(), listRuns(10)]);
    return res.json({
      ...settings,
      next_execution_at: getNextExecutionAt(settings),
      recent_runs: recentRuns
    });
  } catch (error) {
    return sendSafeError(res, error, 'Não foi possível carregar o status do Backup Nuvem.');
  }
};

const saveSettings = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'cloud_backup_settings_updated');
  try {
    const settings = await updateSettings(req.body || {}, req.user.id);
    await recordAuditEvent({
      user: req.user,
      action: 'cloud_backup_settings_updated',
      status: 'success',
      req,
      metadata: {
        provider: settings.active_provider,
        enabled: settings.enabled,
        schedule_enabled: settings.schedule_enabled,
        schedule_days: settings.schedule_days,
        schedule_times: settings.schedule_times,
        retention_days: settings.retention_days,
        backup_passphrase_changed: Boolean(req.body?.backup_passphrase)
      }
    });
    return res.json(settings);
  } catch (error) {
    return sendSafeError(res, error, 'Não foi possível salvar as configurações do Backup Nuvem.');
  }
};

const saveProvider = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'cloud_backup_provider_changed');
  try {
    const provider = assertProvider(req.body?.provider);
    const before = await getRawSettings();
    if (req.body?.config && provider !== 'google_drive') {
      await saveProviderConfiguration(provider, req.body.config, req.user.id);
      await recordAuditEvent({
        user: req.user,
        action: 'cloud_backup_provider_configured',
        status: 'success',
        req,
        metadata: { provider, vendor: provider }
      });
    }
    const settings = await selectProvider(provider, req.user.id);
    if (before.active_provider !== provider) {
      await recordAuditEvent({
        user: req.user,
        action: 'cloud_backup_provider_changed',
        status: 'success',
        req,
        metadata: {
          previous_provider: before.active_provider,
          provider
        }
      });
    }
    return res.json(settings);
  } catch (error) {
    return sendSafeError(res, error, 'Não foi possível configurar o provedor de Backup Nuvem.');
  }
};

const test = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'cloud_backup_test_failed');
  try {
    const result = await testActiveProvider();
    await recordAuditEvent({
      user: req.user,
      action: 'cloud_backup_test_succeeded',
      status: 'success',
      req,
      metadata: { provider: result.provider }
    });
    return res.json({ message: 'Comunicação com o provedor validada.', ...result });
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      action: 'cloud_backup_test_failed',
      status: 'failed',
      req,
      metadata: { reason: error?.code || 'operation_failed' }
    });
    return sendSafeError(res, error, 'Não foi possível validar o provedor de Backup Nuvem.');
  }
};

const run = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'cloud_backup_run_failed');
  try {
    const result = await runCloudBackup({ triggerType: 'manual', userId: req.user.id });
    await recordAuditEvent({
      user: req.user,
      action: 'cloud_backup_run_succeeded',
      status: 'success',
      req,
      metadata: {
        provider: result.provider,
        run_id: result.run_id,
        size_bytes: result.size_bytes,
        retention_removed: result.retention_removed
      }
    });
    if (result.retention_removed > 0) {
      await recordAuditEvent({
        user: req.user,
        action: 'cloud_backup_retention_cleaned',
        status: 'success',
        req,
        metadata: {
          provider: result.provider,
          removed_count: result.retention_removed
        }
      });
    }
    if (result.retention_warning) {
      await recordAuditEvent({
        user: req.user,
        action: 'cloud_backup_retention_cleaned',
        status: 'failed',
        req,
        metadata: {
          provider: result.provider,
          reason: 'retention_cleanup_failed'
        }
      });
    }
    return res.json({ message: 'Backup V2 enviado ao provedor ativo.', ...result });
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      action: 'cloud_backup_run_failed',
      status: 'failed',
      req,
      metadata: { reason: error?.code || 'operation_failed' }
    });
    return sendSafeError(res, error, 'Não foi possível executar o Backup Nuvem.');
  }
};

const disconnect = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'cloud_backup_provider_disconnected');
  try {
    const provider = assertProvider(req.body?.provider);
    let settings;
    if (provider === 'google_drive') {
      await revokeAndDisconnect(req.user.id);
      await db.query(
        `UPDATE cloud_backup_settings
         SET enabled = CASE WHEN active_provider = 'google_drive' THEN FALSE ELSE enabled END,
             schedule_enabled = CASE WHEN active_provider = 'google_drive' THEN FALSE ELSE schedule_enabled END,
             updated_by = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        [req.user.id]
      );
      settings = await getStatus();
    } else {
      settings = await disconnectProvider(provider, req.user.id);
    }
    await recordAuditEvent({
      user: req.user,
      action: 'cloud_backup_provider_disconnected',
      status: 'success',
      req,
      metadata: { provider }
    });
    return res.json({ ...settings, message: 'Configuração do provedor removida.' });
  } catch (error) {
    return sendSafeError(res, error, 'Não foi possível desconectar o provedor.');
  }
};

const runs = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'cloud_backup_status_access');
  try {
    return res.json({ runs: await listRuns(req.query?.limit) });
  } catch (error) {
    return sendSafeError(res, error, 'Não foi possível carregar o histórico do Backup Nuvem.');
  }
};

module.exports = {
  status,
  saveSettings,
  saveProvider,
  test,
  run,
  disconnect,
  runs
};
