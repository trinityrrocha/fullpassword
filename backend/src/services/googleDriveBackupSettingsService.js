const db = require('../config/database');
const {
  encryptConfigSecret,
  decryptConfigSecret
} = require('./configSecretCrypto');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ALLOWED_RETENTION_DAYS = new Set([7, 15, 30, 60]);
const DEFAULT_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const DEFAULT_TIMES = Object.freeze(['02:00']);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

class GoogleDriveSettingsError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'GoogleDriveSettingsError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const normalizeDays = (value) => {
  if (!Array.isArray(value)) {
    throw new GoogleDriveSettingsError('GOOGLE_DRIVE_INVALID_DAYS', 'Selecione ao menos um dia da semana.');
  }
  const days = [...new Set(value.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
  if (days.length === 0) {
    throw new GoogleDriveSettingsError('GOOGLE_DRIVE_INVALID_DAYS', 'Selecione ao menos um dia da semana.');
  }
  return days;
};

const normalizeTimes = (value) => {
  if (!Array.isArray(value)) {
    throw new GoogleDriveSettingsError('GOOGLE_DRIVE_INVALID_TIMES', 'Informe ao menos um horário de backup.');
  }
  const times = [...new Set(value.map((time) => String(time || '').trim()))].sort();
  if (times.length < 1 || times.length > 3 || times.some((time) => !TIME_PATTERN.test(time))) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_INVALID_TIMES',
      'Informe de um a três horários válidos no formato HH:mm.'
    );
  }
  return times;
};

const isServerConfigured = () => Boolean(
  String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim()
  && String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim()
  && (
    String(process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim()
    || String(process.env.APP_ORIGIN || '').trim()
  )
);

const getRedirectUri = () => {
  const explicit = String(process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const origin = String(process.env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  return origin ? `${origin}/api/integrations/google-drive/oauth/callback` : '';
};

const getRawSettings = async (queryable = db) => {
  const result = await queryable.query(
    'SELECT * FROM google_drive_backup_settings WHERE id = 1 LIMIT 1'
  );
  if (result.rows[0]) return result.rows[0];
  const inserted = await queryable.query(
    'INSERT INTO google_drive_backup_settings (id) VALUES (1) RETURNING *'
  );
  return inserted.rows[0];
};

const sanitizeSettings = (settings) => ({
  enabled: settings?.enabled === true,
  connected: settings?.connected === true && Boolean(settings?.encrypted_refresh_token),
  google_email: settings?.google_email || null,
  drive_folder_id: settings?.drive_folder_id || null,
  drive_folder_name: settings?.drive_folder_name || 'FullPassword Backups',
  scope: DRIVE_SCOPE,
  backup_format: 'v2',
  schedule_enabled: settings?.schedule_enabled === true,
  schedule_days: Array.isArray(settings?.schedule_days) ? settings.schedule_days : [...DEFAULT_DAYS],
  schedule_times: Array.isArray(settings?.schedule_times) ? settings.schedule_times : [...DEFAULT_TIMES],
  retention_days: ALLOWED_RETENTION_DAYS.has(Number(settings?.retention_days))
    ? Number(settings.retention_days)
    : 30,
  has_backup_passphrase: Boolean(settings?.encrypted_backup_passphrase),
  last_success_at: settings?.last_success_at || null,
  last_error_at: settings?.last_error_at || null,
  last_error_message: settings?.last_error_message || null,
  server_configured: isServerConfigured(),
  redirect_uri: getRedirectUri() || null
});

const getSettings = async (queryable = db) => sanitizeSettings(await getRawSettings(queryable));

const updateSettings = async (input, userId, queryable = db) => {
  const current = await getRawSettings(queryable);
  const scheduleDays = normalizeDays(input.schedule_days ?? current.schedule_days);
  const scheduleTimes = normalizeTimes(input.schedule_times ?? current.schedule_times);
  const retentionDays = Number(input.retention_days ?? current.retention_days);
  if (!ALLOWED_RETENTION_DAYS.has(retentionDays)) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_INVALID_RETENTION',
      'A retenção deve ser de 7, 15, 30 ou 60 dias.'
    );
  }

  const passphrase = typeof input.backup_passphrase === 'string'
    ? input.backup_passphrase
    : '';
  if (passphrase && passphrase.length < 16) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_INVALID_PASSPHRASE',
      'A frase de criptografia do Backup V2 deve ter ao menos 16 caracteres.'
    );
  }
  const encryptedPassphrase = passphrase
    ? encryptConfigSecret(passphrase)
    : current.encrypted_backup_passphrase;
  const enabled = input.enabled === true;
  const scheduleEnabled = input.schedule_enabled === true;
  if ((enabled || scheduleEnabled) && !current.encrypted_refresh_token) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_NOT_CONNECTED',
      'Conecte uma conta Google Drive antes de ativar o backup.',
      409
    );
  }
  if ((enabled || scheduleEnabled) && !encryptedPassphrase) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_PASSPHRASE_REQUIRED',
      'Defina uma frase de criptografia para os backups automáticos.',
      409
    );
  }

  const result = await queryable.query(
    `UPDATE google_drive_backup_settings
     SET enabled = $1,
         schedule_enabled = $2,
         schedule_days = $3::jsonb,
         schedule_times = $4::jsonb,
         retention_days = $5,
         encrypted_backup_passphrase = $6,
         updated_by = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING *`,
    [
      enabled,
      scheduleEnabled,
      JSON.stringify(scheduleDays),
      JSON.stringify(scheduleTimes),
      retentionDays,
      encryptedPassphrase,
      userId
    ]
  );
  return sanitizeSettings(result.rows[0]);
};

const saveConnection = async ({ refreshToken, googleEmail }, userId, queryable = db) => {
  const encryptedRefreshToken = encryptConfigSecret(refreshToken);
  const result = await queryable.query(
    `UPDATE google_drive_backup_settings
     SET connected = TRUE,
         google_email = $1,
         encrypted_refresh_token = $2,
         scope = $3,
         updated_by = $4,
         last_error_at = NULL,
         last_error_message = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING *`,
    [googleEmail || null, encryptedRefreshToken, DRIVE_SCOPE, userId]
  );
  return sanitizeSettings(result.rows[0]);
};

const disconnect = async (userId, queryable = db) => {
  const result = await queryable.query(
    `UPDATE google_drive_backup_settings
     SET enabled = FALSE,
         connected = FALSE,
         schedule_enabled = FALSE,
         google_email = NULL,
         drive_folder_id = NULL,
         encrypted_refresh_token = NULL,
         updated_by = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING *`,
    [userId]
  );
  return sanitizeSettings(result.rows[0]);
};

const getRefreshToken = (settings) => decryptConfigSecret(settings.encrypted_refresh_token);
const getBackupPassphrase = (settings) => decryptConfigSecret(settings.encrypted_backup_passphrase);

const listRuns = async (limit = 10, queryable = db) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const result = await queryable.query(
    `SELECT id, status, trigger_type, backup_format, file_name, drive_file_id,
            drive_folder_id, size_bytes, started_at, finished_at, error_message
     FROM google_drive_backup_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [safeLimit]
  );
  return result.rows;
};

module.exports = {
  DRIVE_SCOPE,
  GoogleDriveSettingsError,
  normalizeDays,
  normalizeTimes,
  isServerConfigured,
  getRedirectUri,
  getRawSettings,
  getSettings,
  sanitizeSettings,
  updateSettings,
  saveConnection,
  disconnect,
  getRefreshToken,
  getBackupPassphrase,
  listRuns
};
