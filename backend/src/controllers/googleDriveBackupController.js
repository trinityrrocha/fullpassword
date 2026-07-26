const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const {
  GoogleDriveSettingsError,
  getSettings,
  getRawSettings,
  updateSettings,
  listRuns
} = require('../services/googleDriveBackupSettingsService');
const {
  GoogleDriveBackupError,
  createAuthorizationUrl,
  connectFromAuthorizationCode,
  testConnection,
  runBackup,
  revokeAndDisconnect
} = require('../services/googleDriveBackupService');
const { getNextExecutionAt } = require('../services/googleDriveBackupScheduler');
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
    error instanceof GoogleDriveBackupError
    || error instanceof GoogleDriveSettingsError
    || error instanceof ConfigEncryptionError
  ) {
    return res.status(error.statusCode || 503).json({ code: error.code, error: error.message });
  }
  safeLogError('Falha interna sanitizada na integração Google Drive.', {
    name: 'GoogleDriveIntegrationError'
  }, { includeStack: false });
  return res.status(500).json({ error: fallbackMessage });
};

const getStatus = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'google_drive_status_access');
  const raw = await getRawSettings();
  const [settings, runs] = await Promise.all([getSettings(), listRuns(10)]);
  return res.json({
    ...settings,
    next_execution_at: getNextExecutionAt(raw),
    recent_runs: runs
  });
};

const startOAuth = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'google_drive_oauth_start');
  try {
    const authorizationUrl = await createAuthorizationUrl(req.user.id);
    return res.json({ authorization_url: authorizationUrl });
  } catch (error) {
    return sendSafeError(res, error, 'Não foi possível iniciar a conexão com o Google Drive.');
  }
};

const oauthCallback = async (req, res) => {
  const appOrigin = String(process.env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  const settingsUrl = `${appOrigin}/settings?section=google-drive`;
  if (req.query?.error) {
    return res.redirect(`${settingsUrl}&google_drive=denied`);
  }
  try {
    const user = await connectFromAuthorizationCode({
      code: req.query?.code,
      state: req.query?.state
    });
    await recordAuditEvent({
      user,
      action: 'google_drive_connected',
      status: 'success',
      req
    });
    return res.redirect(`${settingsUrl}&google_drive=connected`);
  } catch (error) {
    await recordAuditEvent({
      action: 'google_drive_connected',
      status: 'failed',
      req,
      metadata: { reason: error?.code || 'operation_failed' }
    });
    return res.redirect(`${settingsUrl}&google_drive=error`);
  }
};

const saveSettings = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'google_drive_backup_settings_updated');
  try {
    const settings = await updateSettings(req.body || {}, req.user.id);
    await recordAuditEvent({
      user: req.user,
      action: 'google_drive_backup_settings_updated',
      status: 'success',
      req,
      metadata: {
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
    return sendSafeError(res, error, 'Não foi possível salvar a configuração do Google Drive.');
  }
};

const disconnect = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'google_drive_disconnected');
  try {
    const settings = await revokeAndDisconnect(req.user.id);
    await recordAuditEvent({
      user: req.user,
      action: 'google_drive_disconnected',
      status: 'success',
      req
    });
    return res.json({ ...settings, message: 'Google Drive desconectado.' });
  } catch (error) {
    return sendSafeError(res, error, 'Não foi possível desconectar o Google Drive.');
  }
};

const test = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'google_drive_test_failed');
  const run = await db.query(
    `INSERT INTO google_drive_backup_runs
       (status, trigger_type, backup_format, created_by)
     VALUES ('running', 'test', 'v2', $1)
     RETURNING id`,
    [req.user.id]
  );
  const runId = run.rows[0].id;
  try {
    const result = await testConnection();
    await db.query(
      `UPDATE google_drive_backup_runs
       SET status = 'success', drive_folder_id = $2, finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [runId, result.folder_id]
    );
    await recordAuditEvent({
      user: req.user,
      action: 'google_drive_test_succeeded',
      status: 'success',
      req
    });
    return res.json({ message: 'Comunicação com o Google Drive validada.', ...result });
  } catch (error) {
    const safeMessage = error instanceof GoogleDriveBackupError
      ? error.message
      : 'Não foi possível validar a comunicação com o Google Drive.';
    await db.query(
      `UPDATE google_drive_backup_runs
       SET status = 'failed', error_message = $2, finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [runId, safeMessage]
    ).catch(() => {});
    await recordAuditEvent({
      user: req.user,
      action: 'google_drive_test_failed',
      status: 'failed',
      req,
      metadata: { reason: error?.code || 'operation_failed' }
    });
    return sendSafeError(res, error, safeMessage);
  }
};

const backupNow = async (req, res) => {
  if (!isSuperAdmin(req.user)) return deny(req, res, 'google_drive_backup_failed');
  try {
    const result = await runBackup({ triggerType: 'manual', userId: req.user.id });
    await recordAuditEvent({
      user: req.user,
      action: 'google_drive_backup_succeeded',
      status: 'success',
      req,
      metadata: {
        trigger_type: 'manual',
        run_id: result.run_id,
        size_bytes: result.size_bytes,
        retention_removed: result.retention_removed
      }
    });
    if (result.retention_removed > 0) {
      await recordAuditEvent({
        user: req.user,
        action: 'google_drive_backup_retention_cleaned',
        status: 'success',
        req,
        metadata: { removed_count: result.retention_removed }
      });
    }
    if (result.retention_warning) {
      await recordAuditEvent({
        user: req.user,
        action: 'google_drive_backup_retention_cleaned',
        status: 'failed',
        req,
        metadata: { reason: 'retention_cleanup_failed' }
      });
    }
    return res.json({
      message: 'Backup V2 enviado ao Google Drive.',
      ...result
    });
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      action: 'google_drive_backup_failed',
      status: 'failed',
      req,
      metadata: { trigger_type: 'manual', reason: error?.code || 'operation_failed' }
    });
    return sendSafeError(res, error, 'Não foi possível enviar o backup ao Google Drive.');
  }
};

module.exports = {
  getStatus,
  startOAuth,
  oauthCallback,
  saveSettings,
  disconnect,
  test,
  backupNow
};
