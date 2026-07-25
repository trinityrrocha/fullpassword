const db = require('../config/database');
const { encryptConfigSecret, decryptConfigSecret } = require('./configSecretCrypto');

const SMTP_SECURITY_OPTIONS = new Set(['ssl_tls', 'starttls', 'none']);
const DEFAULT_SMTP_SETTINGS = Object.freeze({
  enabled: false,
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  encrypted_password: null,
  from_name: 'FullPassword',
  from_email: '',
  reply_to: '',
  timeout_seconds: 15
});

class SmtpSettingsError extends Error {
  constructor(message, code = 'SMTP_SETTINGS_INVALID', statusCode = 400) {
    super(message);
    this.name = 'SmtpSettingsError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const normalizeText = (value, maxLength, label, { required = false } = {}) => {
  const normalized = String(value ?? '').trim();
  if (normalized.length > maxLength || /[\r\n\0]/.test(normalized)) {
    throw new SmtpSettingsError(`${label} inválido.`);
  }
  if (required && !normalized) throw new SmtpSettingsError(`${label} é obrigatório.`);
  return normalized;
};

const isValidEmail = (value) => {
  const email = String(value || '').trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const normalizeEmail = (value, label, { required = false } = {}) => {
  const email = normalizeText(value, 254, label, { required });
  if (email && !isValidEmail(email)) throw new SmtpSettingsError(`${label} inválido.`);
  return email.toLowerCase();
};

const sanitizeSmtpSettings = (settings = DEFAULT_SMTP_SETTINGS) => ({
  enabled: settings.enabled === true,
  host: settings.host || '',
  port: Number(settings.port || DEFAULT_SMTP_SETTINGS.port),
  security: settings.security || DEFAULT_SMTP_SETTINGS.security,
  username: settings.username || '',
  has_password: Boolean(settings.encrypted_password),
  from_name: settings.from_name || '',
  from_email: settings.from_email || '',
  reply_to: settings.reply_to || '',
  timeout_seconds: Number(settings.timeout_seconds || DEFAULT_SMTP_SETTINGS.timeout_seconds)
});

const validateDeliveryRequirements = (settings) => {
  if (!settings.host) throw new SmtpSettingsError('O host SMTP é obrigatório para enviar e-mails.');
  if (!settings.from_email) throw new SmtpSettingsError('O e-mail do remetente é obrigatório para enviar e-mails.');
  if (settings.username && !settings.encrypted_password) {
    throw new SmtpSettingsError('Informe a senha SMTP para o usuário configurado.');
  }
  if (!settings.username && settings.encrypted_password) {
    throw new SmtpSettingsError('Informe o usuário SMTP associado à senha configurada.');
  }
};

const normalizeSmtpSettings = (input, current = DEFAULT_SMTP_SETTINGS) => {
  if (input?.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new SmtpSettingsError('O estado da configuração SMTP é inválido.');
  }

  const port = input?.port === undefined ? Number(current.port) : Number(input.port);
  const timeoutSeconds = input?.timeout_seconds === undefined
    ? Number(current.timeout_seconds)
    : Number(input.timeout_seconds);
  const security = input?.security === undefined
    ? current.security
    : normalizeText(input.security, 20, 'Segurança SMTP', { required: true });

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SmtpSettingsError('A porta SMTP deve estar entre 1 e 65535.');
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) {
    throw new SmtpSettingsError('O timeout SMTP deve estar entre 1 e 120 segundos.');
  }
  if (!SMTP_SECURITY_OPTIONS.has(security)) {
    throw new SmtpSettingsError('O modo de segurança SMTP é inválido.');
  }

  let encryptedPassword = current.encrypted_password || null;
  if (input?.password !== undefined && input.password !== null && input.password !== '') {
    if (typeof input.password !== 'string' || input.password.length > 4096 || /[\r\n\0]/.test(input.password)) {
      throw new SmtpSettingsError('A senha SMTP é inválida.');
    }
    encryptedPassword = encryptConfigSecret(input.password);
  }

  const settings = {
    enabled: input?.enabled ?? current.enabled ?? false,
    host: input?.host === undefined
      ? current.host
      : normalizeText(input.host, 255, 'Host SMTP'),
    port,
    security,
    username: input?.username === undefined
      ? current.username
      : normalizeText(input.username, 320, 'Usuário SMTP'),
    encrypted_password: encryptedPassword,
    from_name: input?.from_name === undefined
      ? current.from_name
      : normalizeText(input.from_name, 255, 'Nome do remetente'),
    from_email: input?.from_email === undefined
      ? current.from_email
      : normalizeEmail(input.from_email, 'E-mail do remetente'),
    reply_to: input?.reply_to === undefined
      ? current.reply_to
      : normalizeEmail(input.reply_to, 'Reply-To'),
    timeout_seconds: timeoutSeconds
  };

  if (settings.host && (/\s/.test(settings.host) || settings.host.includes('://'))) {
    throw new SmtpSettingsError('O host SMTP é inválido.');
  }
  if (settings.enabled) validateDeliveryRequirements(settings);
  return settings;
};

const getRawSmtpSettings = async (queryable = db, { forUpdate = false } = {}) => {
  const result = await queryable.query(
    `SELECT * FROM smtp_settings WHERE id = 1${forUpdate ? ' FOR UPDATE' : ''}`
  );
  return result.rows[0] || { ...DEFAULT_SMTP_SETTINGS };
};

const getSmtpSettings = async () => sanitizeSmtpSettings(await getRawSmtpSettings());

const updateSmtpSettings = async (input, updatedBy) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const current = await getRawSmtpSettings(client, { forUpdate: true });
    const settings = normalizeSmtpSettings(input, current);
    const result = await client.query(
      `INSERT INTO smtp_settings
         (id, enabled, host, port, security, username, encrypted_password,
          from_name, from_email, reply_to, timeout_seconds, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         host = EXCLUDED.host,
         port = EXCLUDED.port,
         security = EXCLUDED.security,
         username = EXCLUDED.username,
         encrypted_password = EXCLUDED.encrypted_password,
         from_name = EXCLUDED.from_name,
         from_email = EXCLUDED.from_email,
         reply_to = EXCLUDED.reply_to,
         timeout_seconds = EXCLUDED.timeout_seconds,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        settings.enabled,
        settings.host,
        settings.port,
        settings.security,
        settings.username,
        settings.encrypted_password,
        settings.from_name,
        settings.from_email,
        settings.reply_to || null,
        settings.timeout_seconds,
        updatedBy
      ]
    );
    await client.query('COMMIT');
    return sanitizeSmtpSettings(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const getSmtpDeliverySettings = async ({ allowDisabled = false } = {}) => {
  const settings = await getRawSmtpSettings();
  if (!allowDisabled && !settings.enabled) {
    throw new SmtpSettingsError('O envio SMTP está desativado.', 'SMTP_DISABLED', 503);
  }
  validateDeliveryRequirements(settings);
  return {
    ...settings,
    password: settings.encrypted_password
      ? decryptConfigSecret(settings.encrypted_password)
      : ''
  };
};

module.exports = {
  SMTP_SECURITY_OPTIONS,
  DEFAULT_SMTP_SETTINGS,
  SmtpSettingsError,
  isValidEmail,
  sanitizeSmtpSettings,
  normalizeSmtpSettings,
  getSmtpSettings,
  updateSmtpSettings,
  getSmtpDeliverySettings
};
