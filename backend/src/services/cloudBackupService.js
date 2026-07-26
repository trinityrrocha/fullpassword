const fsp = require('fs/promises');
const db = require('../config/database');
const {
  createBackupPackageV2,
  cleanupBackupWorkspace
} = require('./backupPackageV2Service');
const {
  getRawSettings,
  getProviderRow,
  getResolvedProviderConfig,
  getBackupPassphrase,
  CloudBackupSettingsError
} = require('./cloudBackupSettingsService');
const {
  buildDriveBackupFilename,
  testConnection: testGoogleDriveConnection,
  runBackup: runGoogleDriveBackup,
  GoogleDriveBackupError
} = require('./googleDriveBackupService');
const s3StorageProvider = require('./remoteStorage/s3StorageProvider');
const ftpStorageProvider = require('./remoteStorage/ftpStorageProvider');
const { ConfigEncryptionError } = require('./configSecretCrypto');

const ADAPTERS = Object.freeze({
  backblaze_b2: s3StorageProvider,
  mega_s3: s3StorageProvider,
  ftp: ftpStorageProvider
});

class CloudBackupError extends Error {
  constructor(code, message = 'Não foi possível concluir a operação de Backup Nuvem.', statusCode = 502) {
    super(message);
    this.name = 'CloudBackupError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const sanitizeCloudError = (error, fallbackCode = 'CLOUD_BACKUP_OPERATION_FAILED') => {
  if (
    error instanceof CloudBackupError
    || error instanceof CloudBackupSettingsError
    || error instanceof GoogleDriveBackupError
    || error instanceof ConfigEncryptionError
  ) return error;
  return new CloudBackupError(fallbackCode);
};

const assertActiveProvider = (settings) => {
  if (!settings?.active_provider || settings.active_provider === 'none') {
    throw new CloudBackupError(
      'CLOUD_BACKUP_PROVIDER_REQUIRED',
      'Selecione e configure um provedor de Backup Nuvem.',
      409
    );
  }
  return settings.active_provider;
};

const getAdapter = (provider, adapters = ADAPTERS) => {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new CloudBackupError('CLOUD_BACKUP_PROVIDER_UNSUPPORTED', 'O provedor selecionado não é suportado.', 400);
  }
  return adapter;
};

const beginRun = async ({ provider, triggerType, userId, scheduledSlot }, queryable = db) => {
  const result = await queryable.query(
    `INSERT INTO cloud_backup_runs
       (provider, status, trigger_type, backup_format, scheduled_slot, created_by)
     VALUES ($1, 'running', $2, 'v2', $3, $4)
     ON CONFLICT (scheduled_slot) DO NOTHING
     RETURNING id`,
    [provider, triggerType, scheduledSlot || null, userId || null]
  );
  return result.rows[0]?.id || null;
};

const finishRun = async (runId, status, values = {}, queryable = db) => {
  await queryable.query(
    `UPDATE cloud_backup_runs
     SET status = $2,
         file_name = $3,
         remote_id = $4,
         remote_path = $5,
         size_bytes = $6,
         retention_removed = $7,
         error_message = $8,
         finished_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      runId,
      status,
      values.fileName || null,
      values.remoteId || null,
      values.remotePath || null,
      values.sizeBytes || null,
      Number(values.retentionRemoved || 0),
      values.errorMessage || null
    ]
  );
};

const markProviderTest = async (provider, status, message = null, queryable = db) => {
  await queryable.query(
    `UPDATE cloud_backup_providers
     SET last_test_at = CURRENT_TIMESTAMP,
         last_test_status = $2,
         last_error_at = CASE WHEN $2 = 'success' THEN NULL ELSE CURRENT_TIMESTAMP END,
         last_error_message = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE provider = $1`,
    [provider, status, message]
  );
};

const testActiveProvider = async (queryable = db, adapters = ADAPTERS) => {
  const settings = await getRawSettings(queryable);
  const provider = assertActiveProvider(settings);
  try {
    const result = provider === 'google_drive'
      ? await testGoogleDriveConnection(queryable)
      : await getAdapter(provider, adapters).testConnection(
        await getResolvedProviderConfig(provider, queryable)
      );
    await markProviderTest(provider, 'success', null, queryable);
    return { provider, ...result };
  } catch (error) {
    const safeError = sanitizeCloudError(error, 'CLOUD_BACKUP_TEST_FAILED');
    await markProviderTest(provider, 'failed', safeError.message, queryable).catch(() => {});
    throw safeError;
  }
};

const runCloudBackup = async ({
  triggerType = 'manual',
  userId = null,
  scheduledSlot = null
} = {}, queryable = db, adapters = ADAPTERS) => {
  const settings = await getRawSettings(queryable);
  const provider = assertActiveProvider(settings);
  const providerRow = await getProviderRow(provider, queryable);
  if (provider !== 'google_drive' && (providerRow.configured !== true || !providerRow.encrypted_credentials)) {
    throw new CloudBackupError(
      'CLOUD_BACKUP_PROVIDER_NOT_CONFIGURED',
      'Configure o provedor ativo antes de executar o backup.',
      409
    );
  }
  const passphrase = getBackupPassphrase(settings);
  const runId = await beginRun({ provider, triggerType, userId, scheduledSlot }, queryable);
  if (!runId) return { skipped: true, reason: 'already_executed', provider };

  let workspace;
  try {
    if (provider === 'google_drive') {
      const googleResult = await runGoogleDriveBackup({
        triggerType,
        userId,
        scheduledSlot,
        passphraseOverride: passphrase,
        retentionDaysOverride: settings.retention_days
      }, queryable);
      if (googleResult.skipped) {
        await finishRun(runId, 'skipped', { errorMessage: 'Execução já processada.' }, queryable);
        return { ...googleResult, provider };
      }
      await finishRun(runId, 'success', {
        fileName: googleResult.file_name,
        remoteId: googleResult.drive_file_id,
        remotePath: googleResult.folder_id,
        sizeBytes: googleResult.size_bytes,
        retentionRemoved: googleResult.retention_removed
      }, queryable);
      await queryable.query(
        `UPDATE cloud_backup_settings
         SET last_success_at = CURRENT_TIMESTAMP,
             last_error_at = NULL,
             last_error_message = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`
      );
      return {
        ...googleResult,
        run_id: runId,
        provider
      };
    }

    const config = await getResolvedProviderConfig(provider, queryable);
    const adapter = getAdapter(provider, adapters);
    const generated = await createBackupPackageV2({ generatedBy: userId, passphrase });
    workspace = generated.workspace;
    const stats = await fsp.stat(generated.packagePath);
    const fileName = buildDriveBackupFilename();
    const uploaded = await adapter.upload({
      config,
      localPath: generated.packagePath,
      remoteName: fileName
    });
    let retentionRemoved = 0;
    let retentionWarning = null;
    try {
      retentionRemoved = await adapter.applyRetention({
        config,
        retentionDays: Number(settings.retention_days)
      });
    } catch {
      retentionWarning = 'O backup foi enviado, mas a limpeza de retenção não pôde ser concluída.';
    }
    await finishRun(runId, 'success', {
      fileName,
      remoteId: uploaded.remoteId,
      remotePath: uploaded.remotePath,
      sizeBytes: stats.size,
      retentionRemoved
    }, queryable);
    await queryable.query(
      `UPDATE cloud_backup_settings
       SET last_success_at = CURRENT_TIMESTAMP,
           last_error_at = NULL,
           last_error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`
    );
    return {
      skipped: false,
      run_id: runId,
      provider,
      file_name: fileName,
      remote_id: uploaded.remoteId,
      remote_path: uploaded.remotePath,
      size_bytes: stats.size,
      retention_removed: retentionRemoved,
      retention_warning: retentionWarning
    };
  } catch (error) {
    const safeError = sanitizeCloudError(error, 'CLOUD_BACKUP_RUN_FAILED');
    await finishRun(runId, 'failed', { errorMessage: safeError.message }, queryable).catch(() => {});
    await queryable.query(
      `UPDATE cloud_backup_settings
       SET last_error_at = CURRENT_TIMESTAMP,
           last_error_message = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [safeError.message]
    ).catch(() => {});
    throw safeError;
  } finally {
    await cleanupBackupWorkspace(workspace).catch(() => {});
  }
};

module.exports = {
  ADAPTERS,
  CloudBackupError,
  sanitizeCloudError,
  assertActiveProvider,
  getAdapter,
  beginRun,
  finishRun,
  testActiveProvider,
  runCloudBackup
};
