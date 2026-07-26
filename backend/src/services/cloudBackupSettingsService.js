const db = require('../config/database');
const {
  encryptConfigSecret,
  decryptConfigSecret
} = require('./configSecretCrypto');
const {
  getSettings: getGoogleDriveSettings
} = require('./googleDriveBackupSettingsService');
const { isValidEmail } = require('./smtpSettingsService');

const PROVIDERS = Object.freeze(['google_drive', 'backblaze_b2', 'mega_s3', 'ftp']);
const PROVIDER_SET = new Set(PROVIDERS);
const PROVIDER_SELECTION_SET = new Set(['none', ...PROVIDERS]);
const S3_PROVIDERS = new Set(['backblaze_b2', 'mega_s3']);
const ALLOWED_RETENTION_DAYS = new Set([7, 15, 30, 60]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_FAILURE_EMAIL_RECIPIENTS = 10;

class CloudBackupSettingsError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'CloudBackupSettingsError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const assertProvider = (provider) => {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!PROVIDER_SET.has(normalized)) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_PROVIDER', 'Selecione um provedor de backup válido.');
  }
  return normalized;
};

const assertProviderSelection = (provider) => {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!PROVIDER_SELECTION_SET.has(normalized)) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_PROVIDER', 'Selecione um provedor de backup válido.');
  }
  return normalized;
};

const normalizeFailureEmailRecipients = (value) => {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const recipients = [...new Set(values
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean))];
  if (recipients.length > MAX_FAILURE_EMAIL_RECIPIENTS) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_TOO_MANY_EMAIL_RECIPIENTS',
      `Informe no máximo ${MAX_FAILURE_EMAIL_RECIPIENTS} destinatários.`
    );
  }
  if (recipients.some((email) => !isValidEmail(email))) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_INVALID_EMAIL_RECIPIENTS',
      'Informe somente destinatários de e-mail válidos.'
    );
  }
  return recipients;
};

const normalizeDays = (value) => {
  if (!Array.isArray(value)) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_DAYS', 'Selecione ao menos um dia da semana.');
  }
  const days = [...new Set(value.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort();
  if (!days.length) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_DAYS', 'Selecione ao menos um dia da semana.');
  }
  return days;
};

const normalizeTimes = (value) => {
  if (!Array.isArray(value)) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_TIMES', 'Informe ao menos um horário de backup.');
  }
  const times = [...new Set(value.map((time) => String(time || '').trim()))].sort();
  if (times.length < 1 || times.length > 3 || times.some((time) => !TIME_PATTERN.test(time))) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_INVALID_TIMES',
      'Informe de um a três horários válidos no formato HH:mm.'
    );
  }
  return times;
};

const normalizePrefix = (value, fallback = 'fullpassword/backups/') => {
  const raw = String(value || fallback).trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.includes('..') || raw.length > 512) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_REMOTE_PATH', 'Informe um prefixo remoto válido.');
  }
  return `${raw.replace(/\/+$/, '')}/`;
};

const normalizeRemotePath = (value) => {
  const raw = String(value || '/fullpassword/backups').trim().replace(/\\/g, '/');
  if (!raw.startsWith('/') || raw.includes('..') || raw.includes('\0') || raw.length > 512) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_REMOTE_PATH', 'Informe uma pasta remota válida.');
  }
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
};

const validateS3Endpoint = (value) => {
  let endpoint;
  try {
    endpoint = new URL(String(value || '').trim());
  } catch {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_ENDPOINT', 'Informe um endpoint S3 HTTPS válido.');
  }
  if (
    endpoint.protocol !== 'https:'
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || endpoint.pathname !== '/'
  ) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_ENDPOINT', 'O endpoint S3 deve usar HTTPS e não pode conter caminho ou credenciais.');
  }
  return endpoint.origin;
};

const validateS3Config = (provider, input = {}, currentCredentials = null) => {
  const endpoint = validateS3Endpoint(input.endpoint);
  const region = String(input.region || '').trim();
  const bucket = String(input.bucket || '').trim();
  const accessKeyId = String(input.access_key || '').trim() || currentCredentials?.accessKeyId || '';
  const secretAccessKey = String(input.secret_key || '') || currentCredentials?.secretAccessKey || '';
  if (!region || region.length > 128 || !/^[a-zA-Z0-9._-]+$/.test(region)) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_REGION', 'Informe uma região S3 válida.');
  }
  if (!bucket || bucket.length > 255 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bucket)) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_BUCKET', 'Informe um bucket válido.');
  }
  if (!accessKeyId || !secretAccessKey || accessKeyId.length > 512 || secretAccessKey.length > 1024) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_CREDENTIALS_REQUIRED', 'Informe a chave de acesso e a chave secreta.');
  }
  return {
    publicConfig: {
      vendor: provider,
      endpoint,
      region,
      bucket,
      prefix: normalizePrefix(input.prefix),
      force_path_style: true
    },
    credentials: { accessKeyId, secretAccessKey }
  };
};

const validateFtpConfig = (input = {}, currentCredentials = null) => {
  const host = String(input.host || '').trim();
  const port = Number(input.port || 21);
  const username = String(input.username || '').trim() || currentCredentials?.username || '';
  const password = String(input.password || '') || currentCredentials?.password || '';
  if (!host || host.includes('://') || host.includes('/') || host.includes('\\') || host.length > 255) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_FTP_HOST', 'Informe um host FTP sem protocolo ou caminho.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_FTP_PORT', 'Informe uma porta FTP entre 1 e 65535.');
  }
  if (!username || !password || username.length > 512 || password.length > 1024) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_CREDENTIALS_REQUIRED', 'Informe usuário e senha do servidor FTP.');
  }
  return {
    publicConfig: {
      host,
      port,
      remote_path: normalizeRemotePath(input.remote_path),
      secure: input.secure === true
    },
    credentials: { username, password }
  };
};

const getRawSettings = async (queryable = db) => {
  const result = await queryable.query('SELECT * FROM cloud_backup_settings WHERE id = 1 LIMIT 1');
  if (result.rows[0]) return result.rows[0];
  const inserted = await queryable.query('INSERT INTO cloud_backup_settings (id) VALUES (1) RETURNING *');
  return inserted.rows[0];
};

const getProviderRow = async (provider, queryable = db) => {
  const normalized = assertProvider(provider);
  const result = await queryable.query(
    'SELECT * FROM cloud_backup_providers WHERE provider = $1 LIMIT 1',
    [normalized]
  );
  if (result.rows[0]) return result.rows[0];
  const inserted = await queryable.query(
    'INSERT INTO cloud_backup_providers (provider) VALUES ($1) RETURNING *',
    [normalized]
  );
  return inserted.rows[0];
};

const getProviderRows = async (queryable = db) => {
  const result = await queryable.query(
    'SELECT * FROM cloud_backup_providers ORDER BY provider'
  );
  return Object.fromEntries(result.rows.map((row) => [row.provider, row]));
};

const decryptProviderCredentials = (row) => {
  if (!row?.encrypted_credentials) return null;
  try {
    return JSON.parse(decryptConfigSecret(row.encrypted_credentials));
  } catch {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_CREDENTIALS_INVALID',
      'As credenciais salvas não puderam ser abertas. Salve a configuração novamente.',
      503
    );
  }
};

const maskCredential = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= 6) return `${text.slice(0, 2)}...`;
  return `${text.slice(0, 4)}...${text.slice(-3)}`;
};

const sanitizeProvider = (provider, row, googleStatus = null) => {
  if (provider === 'google_drive') {
    return {
      provider,
      configured: googleStatus?.connected === true,
      connected: googleStatus?.connected === true,
      oauth_configured: googleStatus?.oauth_configured === true,
      oauth_config_source: googleStatus?.oauth_config_source || null,
      google_email: googleStatus?.google_email || null,
      drive_folder_name: googleStatus?.drive_folder_name || 'FullPassword Backups',
      redirect_uri: googleStatus?.redirect_uri || null,
      public_config: {},
      last_test_at: row?.last_test_at || null,
      last_test_status: row?.last_test_status || null,
      last_error_message: row?.last_error_message || null
    };
  }
  let credentialHint = null;
  if (row?.encrypted_credentials) {
    const credentials = decryptProviderCredentials(row);
    credentialHint = maskCredential(
      S3_PROVIDERS.has(provider) ? credentials?.accessKeyId : credentials?.username
    );
  }
  return {
    provider,
    configured: row?.configured === true && Boolean(row?.encrypted_credentials),
    connected: row?.configured === true && Boolean(row?.encrypted_credentials),
    public_config: row?.public_config || {},
    credential_hint: credentialHint,
    last_test_at: row?.last_test_at || null,
    last_test_status: row?.last_test_status || null,
    last_error_message: row?.last_error_message || null
  };
};

const sanitizeSettings = (settings) => ({
  active_provider: settings?.active_provider || 'none',
  enabled: settings?.enabled === true,
  schedule_enabled: settings?.schedule_enabled === true,
  schedule_days: Array.isArray(settings?.schedule_days) ? settings.schedule_days.map(Number) : [0, 1, 2, 3, 4, 5, 6],
  schedule_times: Array.isArray(settings?.schedule_times) ? settings.schedule_times : ['02:00'],
  retention_days: ALLOWED_RETENTION_DAYS.has(Number(settings?.retention_days))
    ? Number(settings.retention_days)
    : 30,
  failure_email_enabled: settings?.failure_email_enabled === true,
  failure_email_recipients: Array.isArray(settings?.failure_email_recipients)
    ? settings.failure_email_recipients
    : [],
  failure_email_on_recovery: settings?.failure_email_on_recovery === true,
  has_backup_passphrase: Boolean(settings?.encrypted_backup_passphrase),
  backup_format: 'v2',
  last_success_at: settings?.last_success_at || null,
  last_error_at: settings?.last_error_at || null,
  last_error_message: settings?.last_error_message || null
});

const getStatus = async (queryable = db) => {
  const [settings, rows, googleStatus] = await Promise.all([
    getRawSettings(queryable),
    getProviderRows(queryable),
    getGoogleDriveSettings(queryable)
  ]);
  const providers = Object.fromEntries(PROVIDERS.map((provider) => [
    provider,
    sanitizeProvider(provider, rows[provider], googleStatus)
  ]));
  return {
    ...sanitizeSettings(settings),
    providers
  };
};

const saveProviderConfiguration = async (provider, input, userId, queryable = db) => {
  const normalized = assertProvider(provider);
  if (normalized === 'google_drive') {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_GOOGLE_USES_OAUTH',
      'Configure o Google Drive pelo formulário OAuth.',
      409
    );
  }
  const current = await getProviderRow(normalized, queryable);
  const currentCredentials = decryptProviderCredentials(current);
  const validated = S3_PROVIDERS.has(normalized)
    ? validateS3Config(normalized, input, currentCredentials)
    : validateFtpConfig(input, currentCredentials);
  const encryptedCredentials = encryptConfigSecret(JSON.stringify(validated.credentials));
  await queryable.query(
    `UPDATE cloud_backup_providers
     SET configured = TRUE,
         public_config = $2::jsonb,
         encrypted_credentials = $3,
         last_error_at = NULL,
         last_error_message = NULL,
         updated_by = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE provider = $1`,
    [normalized, JSON.stringify(validated.publicConfig), encryptedCredentials, userId || null]
  );
  return getProviderRow(normalized, queryable);
};

const selectProvider = async (provider, userId, queryable = db) => {
  const normalized = assertProviderSelection(provider);
  await queryable.query(
    `UPDATE google_drive_backup_settings
     SET enabled = FALSE,
         schedule_enabled = FALSE,
         updated_at = CURRENT_TIMESTAMP
     WHERE enabled = TRUE OR schedule_enabled = TRUE`
  );
  if (normalized === 'none') {
    await queryable.query(
      `UPDATE cloud_backup_settings
       SET active_provider = 'none',
           enabled = FALSE,
           schedule_enabled = FALSE,
           updated_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [userId || null]
    );
    await queryable.query(
      'UPDATE cloud_backup_providers SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP'
    );
    return getStatus(queryable);
  }
  const providerRow = await getProviderRow(normalized, queryable);
  const googleStatus = normalized === 'google_drive'
    ? await getGoogleDriveSettings(queryable)
    : null;
  const configured = normalized === 'google_drive'
    ? googleStatus.connected === true
    : providerRow.configured === true && Boolean(providerRow.encrypted_credentials);

  await queryable.query(
    `UPDATE cloud_backup_settings
     SET active_provider = $1,
         enabled = CASE WHEN $2 THEN enabled ELSE FALSE END,
         schedule_enabled = CASE WHEN $2 THEN schedule_enabled ELSE FALSE END,
         updated_by = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [normalized, configured, userId || null]
  );
  await queryable.query(
    'UPDATE cloud_backup_providers SET enabled = (provider = $1), updated_at = CURRENT_TIMESTAMP',
    [normalized]
  );
  return getStatus(queryable);
};

const updateSettings = async (input, userId, queryable = db) => {
  let current = await getRawSettings(queryable);
  const enabled = input.enabled === true;
  const scheduleEnabled = input.schedule_enabled === true;
  const requestedProvider = input.active_provider === undefined
    ? current.active_provider
    : assertProviderSelection(input.active_provider);
  if (requestedProvider === 'none' && (enabled || scheduleEnabled)) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_PROVIDER_REQUIRED',
      'Selecione um provedor antes de ativar o backup em nuvem.',
      409
    );
  }
  if (requestedProvider !== current.active_provider) {
    await selectProvider(requestedProvider, userId, queryable);
    current = await getRawSettings(queryable);
  }
  const status = await getStatus(queryable);
  const activeProvider = status.providers[status.active_provider];
  if ((enabled || scheduleEnabled) && (!activeProvider || activeProvider.configured !== true)) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_PROVIDER_NOT_CONFIGURED',
      'Configure o provedor ativo antes de habilitar o Backup Nuvem.',
      409
    );
  }
  const passphrase = typeof input.backup_passphrase === 'string'
    ? input.backup_passphrase
    : '';
  if (passphrase && passphrase.length < 16) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_PASSPHRASE_TOO_SHORT',
      'A frase de criptografia deve ter pelo menos 16 caracteres.'
    );
  }
  const encryptedPassphrase = passphrase
    ? encryptConfigSecret(passphrase)
    : current.encrypted_backup_passphrase;
  if ((enabled || scheduleEnabled) && !encryptedPassphrase) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_PASSPHRASE_REQUIRED',
      'Defina a frase de criptografia do Backup V2 antes de ativar a rotina.',
      409
    );
  }
  const retentionDays = Number(input.retention_days ?? current.retention_days);
  if (!ALLOWED_RETENTION_DAYS.has(retentionDays)) {
    throw new CloudBackupSettingsError('CLOUD_BACKUP_INVALID_RETENTION', 'Selecione uma retenção válida.');
  }
  const failureEmailEnabled = input.failure_email_enabled === true;
  const failureEmailOnRecovery = failureEmailEnabled && input.failure_email_on_recovery === true;
  const failureEmailRecipients = normalizeFailureEmailRecipients(
    input.failure_email_recipients ?? current.failure_email_recipients
  );
  if (failureEmailEnabled && failureEmailRecipients.length === 0) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_EMAIL_RECIPIENT_REQUIRED',
      'Informe ao menos um destinatário para ativar as notificações por e-mail.'
    );
  }
  await queryable.query(
    `UPDATE cloud_backup_settings
     SET enabled = $1,
         schedule_enabled = $2,
         schedule_days = $3::jsonb,
         schedule_times = $4::jsonb,
         retention_days = $5,
         encrypted_backup_passphrase = $6,
         failure_email_enabled = $7,
         failure_email_recipients = $8::jsonb,
         failure_email_on_recovery = $9,
         updated_by = $10,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [
      enabled,
      scheduleEnabled,
      JSON.stringify(normalizeDays(input.schedule_days ?? current.schedule_days)),
      JSON.stringify(normalizeTimes(input.schedule_times ?? current.schedule_times)),
      retentionDays,
      encryptedPassphrase,
      failureEmailEnabled,
      JSON.stringify(failureEmailRecipients),
      failureEmailOnRecovery,
      userId || null
    ]
  );
  return getStatus(queryable);
};

const disconnectProvider = async (provider, userId, queryable = db) => {
  const normalized = assertProvider(provider);
  if (normalized === 'google_drive') {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_GOOGLE_DISCONNECT_REQUIRED',
      'Use a desconexão segura do Google Drive.',
      409
    );
  }
  await queryable.query(
    `UPDATE cloud_backup_providers
     SET configured = FALSE,
         encrypted_credentials = NULL,
         public_config = '{}'::jsonb,
         enabled = FALSE,
         last_test_at = NULL,
         last_test_status = NULL,
         last_error_at = NULL,
         last_error_message = NULL,
         updated_by = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE provider = $1`,
    [normalized, userId || null]
  );
  await queryable.query(
    `UPDATE cloud_backup_settings
     SET enabled = CASE WHEN active_provider = $1 THEN FALSE ELSE enabled END,
         schedule_enabled = CASE WHEN active_provider = $1 THEN FALSE ELSE schedule_enabled END,
         updated_by = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [normalized, userId || null]
  );
  return getStatus(queryable);
};

const getResolvedProviderConfig = async (provider, queryable = db) => {
  const normalized = assertProvider(provider);
  if (normalized === 'google_drive') return { provider: normalized };
  const row = await getProviderRow(normalized, queryable);
  if (row.configured !== true || !row.encrypted_credentials) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_PROVIDER_NOT_CONFIGURED',
      'Configure o provedor ativo antes de continuar.',
      409
    );
  }
  return {
    provider: normalized,
    ...(row.public_config || {}),
    ...decryptProviderCredentials(row)
  };
};

const getBackupPassphrase = (settings) => {
  if (!settings?.encrypted_backup_passphrase) {
    throw new CloudBackupSettingsError(
      'CLOUD_BACKUP_PASSPHRASE_REQUIRED',
      'Defina a frase de criptografia do Backup V2 antes de executar o backup.',
      409
    );
  }
  return decryptConfigSecret(settings.encrypted_backup_passphrase);
};

const listRuns = async (limit = 10, queryable = db) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const result = await queryable.query(
    `SELECT id, provider, status, trigger_type, backup_format, file_name,
            remote_id, remote_path, size_bytes, retention_removed,
            scheduled_slot, started_at, finished_at, error_message
     FROM cloud_backup_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [safeLimit]
  );
  return result.rows;
};

module.exports = {
  PROVIDERS,
  S3_PROVIDERS,
  MAX_FAILURE_EMAIL_RECIPIENTS,
  CloudBackupSettingsError,
  assertProvider,
  assertProviderSelection,
  normalizeFailureEmailRecipients,
  normalizeDays,
  normalizeTimes,
  normalizePrefix,
  normalizeRemotePath,
  validateS3Endpoint,
  validateS3Config,
  validateFtpConfig,
  getRawSettings,
  getProviderRow,
  getProviderRows,
  getStatus,
  saveProviderConfiguration,
  selectProvider,
  updateSettings,
  disconnectProvider,
  getResolvedProviderConfig,
  getBackupPassphrase,
  listRuns,
  sanitizeSettings,
  sanitizeProvider
};
