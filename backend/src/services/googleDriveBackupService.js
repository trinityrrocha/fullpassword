const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const { google } = require('googleapis');
const db = require('../config/database');
const {
  createBackupPackageV2,
  cleanupBackupWorkspace
} = require('./backupPackageV2Service');
const { createBackupPackageV1 } = require('./backupPackageV1Service');
const {
  DRIVE_SCOPE,
  resolveGoogleDriveOAuthConfig,
  getRawSettings,
  saveConnection,
  disconnect,
  getRefreshToken,
  getBackupPassphrase
} = require('./googleDriveBackupSettingsService');
const { ConfigEncryptionError } = require('./configSecretCrypto');

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const BACKUP_MIME_TYPE = 'application/zip';
const APP_PROPERTIES = Object.freeze({ app: 'fullpassword', type: 'backup', format: 'v2' });
const OAUTH_STATE_TTL_MINUTES = 10;
const SAFE_ERROR_MESSAGE = 'Não foi possível concluir a operação com o Google Drive.';

class GoogleDriveBackupError extends Error {
  constructor(code, message = SAFE_ERROR_MESSAGE, statusCode = 502) {
    super(message);
    this.name = 'GoogleDriveBackupError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const hashState = (state) => crypto.createHash('sha256').update(state).digest('hex');
const sanitizeDriveError = (error, fallbackCode = 'GOOGLE_DRIVE_OPERATION_FAILED') => {
  if (error instanceof GoogleDriveBackupError || error instanceof ConfigEncryptionError) return error;
  const status = Number(error?.response?.status || error?.code);
  if (status === 401 || status === 403 || error?.code === 'invalid_grant') {
    return new GoogleDriveBackupError(
      'GOOGLE_DRIVE_AUTHORIZATION_INVALID',
      'A autorização do Google Drive expirou ou foi revogada. Conecte a conta novamente.',
      401
    );
  }
  return new GoogleDriveBackupError(fallbackCode);
};

const assertOAuthConfigured = (oauthConfig) => {
  if (!oauthConfig?.configured) {
    throw new GoogleDriveBackupError(
      'GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED',
      'Configure as credenciais OAuth do Google Drive antes de conectar a conta.',
      503
    );
  }
};

const createOAuthClient = (oauthConfig) => {
  assertOAuthConfigured(oauthConfig);
  return new google.auth.OAuth2(
    oauthConfig.clientId,
    oauthConfig.clientSecret,
    oauthConfig.redirectUri
  );
};

const createAuthorizationUrl = async (userId, queryable = db) => {
  const oauthConfig = await resolveGoogleDriveOAuthConfig(queryable);
  assertOAuthConfigured(oauthConfig);
  const state = crypto.randomBytes(32).toString('base64url');
  await queryable.query(
    'DELETE FROM google_drive_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP OR user_id = $1',
    [userId]
  );
  await queryable.query(
    `INSERT INTO google_drive_oauth_states (state_hash, user_id, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'))`,
    [hashState(state), userId, OAUTH_STATE_TTL_MINUTES]
  );
  const oauth2Client = createOAuthClient(oauthConfig);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [DRIVE_SCOPE],
    state,
    include_granted_scopes: true
  });
};

const consumeOAuthState = async (state, queryable = db) => {
  if (typeof state !== 'string' || state.length < 32 || state.length > 256) {
    throw new GoogleDriveBackupError('GOOGLE_DRIVE_INVALID_STATE', 'A autorização do Google Drive é inválida ou expirou.', 400);
  }
  const result = await queryable.query(
    `DELETE FROM google_drive_oauth_states
     WHERE state_hash = $1 AND expires_at > CURRENT_TIMESTAMP
     RETURNING user_id`,
    [hashState(state)]
  );
  if (!result.rows[0]) {
    throw new GoogleDriveBackupError('GOOGLE_DRIVE_INVALID_STATE', 'A autorização do Google Drive é inválida ou expirou.', 400);
  }
  return result.rows[0].user_id;
};

const verifyCallbackUser = async (userId, queryable = db) => {
  const result = await queryable.query(
    `SELECT id, email, role, is_super_admin
     FROM users
     WHERE id = $1 AND is_active = TRUE
     LIMIT 1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user || user.role !== 'admin' || user.is_super_admin !== true) {
    throw new GoogleDriveBackupError('GOOGLE_DRIVE_CALLBACK_FORBIDDEN', 'A autorização não pertence a um Super Admin ativo.', 403);
  }
  return user;
};

const connectFromAuthorizationCode = async ({ code, state }, queryable = db) => {
  const userId = await consumeOAuthState(state, queryable);
  const user = await verifyCallbackUser(userId, queryable);
  if (typeof code !== 'string' || !code.trim()) {
    throw new GoogleDriveBackupError('GOOGLE_DRIVE_CODE_MISSING', 'O Google não retornou uma autorização válida.', 400);
  }

  try {
    const oauthConfig = await resolveGoogleDriveOAuthConfig(queryable);
    const oauth2Client = createOAuthClient(oauthConfig);
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens?.refresh_token) {
      throw new GoogleDriveBackupError(
        'GOOGLE_DRIVE_REFRESH_TOKEN_MISSING',
        'O Google não forneceu acesso offline. Remova o acesso anterior na conta Google e conecte novamente.',
        409
      );
    }
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const about = await drive.about.get({ fields: 'user(emailAddress)' });
    await saveConnection({
      refreshToken: tokens.refresh_token,
      googleEmail: about.data?.user?.emailAddress || null
    }, user.id, queryable);
    return user;
  } catch (error) {
    throw sanitizeDriveError(error, 'GOOGLE_DRIVE_OAUTH_EXCHANGE_FAILED');
  }
};

const createDriveClient = async (settings, queryable = db) => {
  try {
    const oauthConfig = await resolveGoogleDriveOAuthConfig(queryable, settings);
    const oauth2Client = createOAuthClient(oauthConfig);
    oauth2Client.setCredentials({ refresh_token: getRefreshToken(settings) });
    return { oauth2Client, drive: google.drive({ version: 'v3', auth: oauth2Client }) };
  } catch (error) {
    throw sanitizeDriveError(error, 'GOOGLE_DRIVE_CREDENTIALS_INVALID');
  }
};

const escapeDriveQueryValue = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const normalizeBackupFormat = (value) => value === 'v1' ? 'v1' : 'v2';
const buildDriveBackupFilename = (formatOrDate = 'v2', providedDate = new Date()) => {
  const backupFormat = formatOrDate instanceof Date ? 'v2' : normalizeBackupFormat(formatOrDate);
  const date = formatOrDate instanceof Date ? formatOrDate : providedDate;
  const compact = date.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return backupFormat === 'v1'
    ? `fullpassword-backup-v1-${compact}.enc.json`
    : `fullpassword-backup-v2-${compact}.zip`;
};

const ensureBackupFolder = async (drive, settings, queryable = db) => {
  if (settings.drive_folder_id) {
    try {
      const existing = await drive.files.get({
        fileId: settings.drive_folder_id,
        fields: 'id,name,mimeType,trashed'
      });
      if (existing.data?.mimeType === FOLDER_MIME_TYPE && existing.data?.trashed !== true) {
        return existing.data.id;
      }
    } catch {
      // O ID ficou obsoleto; a busca segura abaixo recria ou relocaliza a pasta.
    }
  }

  const folderName = settings.drive_folder_name || 'FullPassword Backups';
  const listed = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(folderName)}'`,
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      'trashed = false',
      "appProperties has { key='app' and value='fullpassword' }",
      "appProperties has { key='type' and value='backup-folder' }"
    ].join(' and '),
    spaces: 'drive',
    fields: 'files(id,name)',
    pageSize: 10
  });
  let folderId = listed.data?.files?.[0]?.id;
  if (!folderId) {
    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: FOLDER_MIME_TYPE,
        appProperties: { app: 'fullpassword', type: 'backup-folder' }
      },
      fields: 'id'
    });
    folderId = created.data?.id;
  }
  if (!folderId) throw new GoogleDriveBackupError('GOOGLE_DRIVE_FOLDER_FAILED');
  await queryable.query(
    `UPDATE google_drive_backup_settings
     SET drive_folder_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [folderId]
  );
  return folderId;
};

const testConnection = async (queryable = db) => {
  const settings = await getRawSettings(queryable);
  if (!settings.connected || !settings.encrypted_refresh_token) {
    throw new GoogleDriveBackupError('GOOGLE_DRIVE_NOT_CONNECTED', 'Conecte uma conta Google Drive primeiro.', 409);
  }
  try {
    const { drive } = await createDriveClient(settings, queryable);
    const folderId = await ensureBackupFolder(drive, settings, queryable);
    await drive.about.get({ fields: 'user(emailAddress)' });
    return { folder_id: folderId, folder_name: settings.drive_folder_name };
  } catch (error) {
    throw sanitizeDriveError(error, 'GOOGLE_DRIVE_TEST_FAILED');
  }
};

const uploadBackup = async (drive, folderId, packagePath, filename, backupFormat = 'v2') => {
  const normalizedFormat = normalizeBackupFormat(backupFormat);
  const result = await drive.files.create({
    uploadType: 'resumable',
    requestBody: {
      name: filename,
      parents: [folderId],
      appProperties: { app: 'fullpassword', type: 'backup', format: normalizedFormat }
    },
    media: {
      mimeType: normalizedFormat === 'v1' ? 'application/json' : BACKUP_MIME_TYPE,
      body: fs.createReadStream(packagePath)
    },
    fields: 'id,name,size,createdTime,appProperties,parents'
  });
  if (!result.data?.id) throw new GoogleDriveBackupError('GOOGLE_DRIVE_UPLOAD_FAILED');
  return result.data;
};

const deleteExpiredBackups = async (drive, folderId, retentionDays) => {
  const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  let pageToken;
  let removed = 0;
  do {
    const listed = await drive.files.list({
      q: [
        `'${escapeDriveQueryValue(folderId)}' in parents`,
        'trashed = false',
        "appProperties has { key='app' and value='fullpassword' }",
        "appProperties has { key='type' and value='backup' }"
      ].join(' and '),
      spaces: 'drive',
      fields: 'nextPageToken,files(id,createdTime,parents,appProperties)',
      pageSize: 100,
      pageToken
    });
    for (const file of listed.data?.files || []) {
      const isOwnedBackup = file.parents?.includes(folderId)
        && file.appProperties?.app === 'fullpassword'
        && file.appProperties?.type === 'backup'
        && ['v1', 'v2'].includes(file.appProperties?.format);
      if (isOwnedBackup && Date.parse(file.createdTime) < cutoff) {
        await drive.files.delete({ fileId: file.id });
        removed += 1;
      }
    }
    pageToken = listed.data?.nextPageToken;
  } while (pageToken);
  return removed;
};

const beginRun = async ({ triggerType, userId, scheduledSlot, backupFormat = 'v2' }, queryable = db) => {
  const result = await queryable.query(
    `INSERT INTO google_drive_backup_runs
       (status, trigger_type, backup_format, scheduled_slot, created_by)
     VALUES ('running', $1, $2, $3, $4)
     ON CONFLICT (scheduled_slot) DO NOTHING
     RETURNING id`,
    [triggerType, normalizeBackupFormat(backupFormat), scheduledSlot || null, userId || null]
  );
  return result.rows[0]?.id || null;
};

const finishRun = async (runId, status, values = {}, queryable = db) => {
  await queryable.query(
    `UPDATE google_drive_backup_runs
     SET status = $2,
         file_name = $3,
         drive_file_id = $4,
         drive_folder_id = $5,
         size_bytes = $6,
         error_message = $7,
         finished_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      runId,
      status,
      values.fileName || null,
      values.driveFileId || null,
      values.folderId || null,
      values.sizeBytes || null,
      values.errorMessage || null
    ]
  );
};

const runBackup = async ({
  triggerType = 'manual',
  userId = null,
  scheduledSlot = null,
  passphraseOverride = null,
  retentionDaysOverride = null,
  backupFormatOverride = 'v2'
} = {}, queryable = db) => {
  const backupFormat = normalizeBackupFormat(backupFormatOverride);
  const runId = await beginRun({ triggerType, userId, scheduledSlot, backupFormat }, queryable);
  if (!runId) return { skipped: true, reason: 'already_executed' };

  let workspace;
  try {
    const settings = await getRawSettings(queryable);
    if (!settings.connected || !settings.encrypted_refresh_token) {
      throw new GoogleDriveBackupError('GOOGLE_DRIVE_NOT_CONNECTED', 'Conecte uma conta Google Drive primeiro.', 409);
    }
    if (!passphraseOverride && !settings.encrypted_backup_passphrase) {
      throw new GoogleDriveBackupError(
        'GOOGLE_DRIVE_PASSPHRASE_REQUIRED',
        'Defina a frase de criptografia do backup antes de executar a rotina.',
        409
      );
    }
    const passphrase = passphraseOverride || getBackupPassphrase(settings);
    const generated = backupFormat === 'v1'
      ? await createBackupPackageV1({ generatedBy: userId, passphrase, queryable })
      : await createBackupPackageV2({ generatedBy: userId, passphrase });
    workspace = generated.workspace;
    const stats = await fsp.stat(generated.packagePath);
    const { drive } = await createDriveClient(settings, queryable);
    const folderId = await ensureBackupFolder(drive, settings, queryable);
    const fileName = buildDriveBackupFilename(backupFormat);
    const uploaded = await uploadBackup(drive, folderId, generated.packagePath, fileName, backupFormat);

    await finishRun(runId, 'success', {
      fileName,
      driveFileId: uploaded.id,
      folderId,
      sizeBytes: stats.size
    }, queryable);
    await queryable.query(
      `UPDATE google_drive_backup_settings
       SET last_success_at = CURRENT_TIMESTAMP,
           last_error_at = NULL,
           last_error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`
    );

    let retentionRemoved = 0;
    let retentionWarning = null;
    try {
      retentionRemoved = await deleteExpiredBackups(
        drive,
        folderId,
        Number(retentionDaysOverride || settings.retention_days)
      );
    } catch {
      retentionWarning = 'O backup foi enviado, mas a limpeza de retenção não pôde ser concluída.';
      await queryable.query(
        `INSERT INTO google_drive_backup_runs
           (status, trigger_type, backup_format, drive_folder_id, finished_at, error_message, created_by)
         VALUES ('failed', 'retention_cleanup', $1, $2, CURRENT_TIMESTAMP, $3, $4)`,
        [backupFormat, folderId, retentionWarning, userId]
      );
    }

    return {
      skipped: false,
      run_id: runId,
      file_name: fileName,
      drive_file_id: uploaded.id,
      folder_id: folderId,
      size_bytes: stats.size,
      backup_format: backupFormat,
      retention_removed: retentionRemoved,
      retention_warning: retentionWarning
    };
  } catch (error) {
    const safeError = sanitizeDriveError(error, 'GOOGLE_DRIVE_BACKUP_FAILED');
    await finishRun(runId, 'failed', { errorMessage: safeError.message }, queryable).catch(() => {});
    await queryable.query(
      `UPDATE google_drive_backup_settings
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

const revokeAndDisconnect = async (userId, queryable = db) => {
  const settings = await getRawSettings(queryable);
  if (settings.encrypted_refresh_token) {
    try {
      const token = getRefreshToken(settings);
      const oauthConfig = await resolveGoogleDriveOAuthConfig(queryable, settings);
      const oauth2Client = createOAuthClient(oauthConfig);
      await oauth2Client.revokeToken(token);
    } catch {
      // A remoção local é obrigatória; revogação remota é best-effort.
    }
  }
  return disconnect(userId, queryable);
};

module.exports = {
  APP_PROPERTIES,
  GoogleDriveBackupError,
  sanitizeDriveError,
  hashState,
  createOAuthClient,
  createAuthorizationUrl,
  consumeOAuthState,
  connectFromAuthorizationCode,
  createDriveClient,
  buildDriveBackupFilename,
  ensureBackupFolder,
  testConnection,
  uploadBackup,
  deleteExpiredBackups,
  beginRun,
  runBackup,
  revokeAndDisconnect
};
