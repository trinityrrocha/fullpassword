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

const getEnvironmentRedirectUri = () => {
  const explicit = String(process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const origin = String(process.env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  return origin ? `${origin}/api/integrations/google-drive/oauth/callback` : '';
};

const getEnvironmentOAuthConfig = () => {
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const redirectUri = getEnvironmentRedirectUri();
  return {
    configured: Boolean(clientId && clientSecret && redirectUri),
    source: clientId && clientSecret && redirectUri ? 'env' : null,
    clientId,
    clientSecret,
    redirectUri
  };
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

const resolveGoogleDriveOAuthConfig = async (queryable = db, providedSettings = null) => {
  const settings = providedSettings || await getRawSettings(queryable);
  const clientId = String(settings?.google_oauth_client_id || '').trim();
  const encryptedClientSecret = String(settings?.encrypted_google_oauth_client_secret || '').trim();
  const redirectUri = String(settings?.google_oauth_redirect_uri || '').trim();

  if (clientId && encryptedClientSecret && redirectUri) {
    return {
      configured: true,
      source: 'database',
      clientId,
      clientSecret: decryptConfigSecret(encryptedClientSecret),
      redirectUri,
      configuredAt: settings.google_oauth_configured_at || null,
      configuredBy: settings.google_oauth_configured_by || null
    };
  }

  const environment = getEnvironmentOAuthConfig();
  return {
    ...environment,
    configuredAt: null,
    configuredBy: null
  };
};

const maskClientId = (value) => {
  const clientId = String(value || '').trim();
  if (!clientId) return null;
  if (clientId.length <= 16) return `${clientId.slice(0, 4)}...`;
  return `${clientId.slice(0, 8)}...${clientId.slice(-24)}`;
};

const sanitizeOAuthConfig = (config) => ({
  configured: config?.configured === true,
  source: config?.source || null,
  client_id_masked: maskClientId(config?.clientId),
  redirect_uri: config?.redirectUri || getEnvironmentRedirectUri() || null,
  configured_at: config?.configuredAt || null,
  configured_by: config?.configuredBy || null
});

const getOAuthConfigStatus = async (queryable = db) => (
  sanitizeOAuthConfig(await resolveGoogleDriveOAuthConfig(queryable))
);

const sanitizeSettings = (settings, oauthConfig = getEnvironmentOAuthConfig()) => ({
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
  server_configured: oauthConfig?.configured === true,
  oauth_configured: oauthConfig?.configured === true,
  oauth_config_source: oauthConfig?.source || null,
  redirect_uri: oauthConfig?.redirectUri || getEnvironmentRedirectUri() || null
});

const getSettings = async (queryable = db) => {
  const settings = await getRawSettings(queryable);
  const oauthConfig = await resolveGoogleDriveOAuthConfig(queryable, settings);
  return sanitizeSettings(settings, oauthConfig);
};

const validateOAuthRedirectUri = (value) => {
  const redirectUri = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_INVALID_REDIRECT_URI',
      'Informe uma Redirect URI válida.'
    );
  }
  const expectedPath = '/api/integrations/google-drive/oauth/callback';
  const localDevelopment = ['development', 'test'].includes(String(process.env.NODE_ENV || '').toLowerCase())
    && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !(localDevelopment && parsed.protocol === 'http:'))
    || parsed.pathname !== expectedPath
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_INVALID_REDIRECT_URI',
      `A Redirect URI deve usar HTTPS e terminar com ${expectedPath}.`
    );
  }
  return parsed.toString();
};

const saveOAuthConfig = async (input, userId, queryable = db) => {
  const clientId = String(input?.client_id || '').trim();
  const clientSecret = String(input?.client_secret || '');
  if (!clientId || clientId.length > 512 || /\s/.test(clientId)) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_INVALID_CLIENT_ID',
      'Informe um Client ID OAuth válido.'
    );
  }
  if (!clientSecret || clientSecret.length > 1024) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_INVALID_CLIENT_SECRET',
      'Informe o Client Secret OAuth.'
    );
  }
  const redirectUri = validateOAuthRedirectUri(input?.redirect_uri);
  const current = await getRawSettings(queryable);
  const wasConfigured = Boolean(
    current.google_oauth_client_id
    && current.encrypted_google_oauth_client_secret
    && current.google_oauth_redirect_uri
  );
  const encryptedClientSecret = encryptConfigSecret(clientSecret);
  await queryable.query(
    `UPDATE google_drive_backup_settings
     SET google_oauth_client_id = $1,
         encrypted_google_oauth_client_secret = $2,
         google_oauth_redirect_uri = $3,
         google_oauth_configured_at = CURRENT_TIMESTAMP,
         google_oauth_configured_by = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [clientId, encryptedClientSecret, redirectUri, userId]
  );
  return {
    status: await getOAuthConfigStatus(queryable),
    wasConfigured
  };
};

const removeOAuthConfig = async (queryable = db) => {
  const current = await getRawSettings(queryable);
  if (current.connected === true || current.encrypted_refresh_token) {
    throw new GoogleDriveSettingsError(
      'GOOGLE_DRIVE_OAUTH_CONFIG_IN_USE',
      'Desconecte a conta Google Drive antes de remover a configuração OAuth.',
      409
    );
  }
  await queryable.query(
    `UPDATE google_drive_backup_settings
     SET google_oauth_client_id = NULL,
         encrypted_google_oauth_client_secret = NULL,
         google_oauth_redirect_uri = NULL,
         google_oauth_configured_at = NULL,
         google_oauth_configured_by = NULL,
         enabled = FALSE,
         schedule_enabled = FALSE,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`
  );
  return getOAuthConfigStatus(queryable);
};

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

  await queryable.query(
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
     RETURNING id`,
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
  return getSettings(queryable);
};

const saveConnection = async ({ refreshToken, googleEmail }, userId, queryable = db) => {
  const encryptedRefreshToken = encryptConfigSecret(refreshToken);
  await queryable.query(
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
     RETURNING id`,
    [googleEmail || null, encryptedRefreshToken, DRIVE_SCOPE, userId]
  );
  return getSettings(queryable);
};

const disconnect = async (userId, queryable = db) => {
  await queryable.query(
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
     RETURNING id`,
    [userId]
  );
  return getSettings(queryable);
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
  getEnvironmentRedirectUri,
  getEnvironmentOAuthConfig,
  getRawSettings,
  resolveGoogleDriveOAuthConfig,
  getOAuthConfigStatus,
  saveOAuthConfig,
  removeOAuthConfig,
  getSettings,
  sanitizeSettings,
  updateSettings,
  saveConnection,
  disconnect,
  getRefreshToken,
  getBackupPassphrase,
  listRuns
};
