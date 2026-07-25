const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const {
  SmtpSettingsError,
  isValidEmail,
  getSmtpSettings,
  updateSmtpSettings
} = require('../services/smtpSettingsService');
const { ConfigEncryptionError } = require('../services/configSecretCrypto');
const { EmailDeliveryError, sendTestEmail } = require('../services/emailService');
const { safeLogError } = require('../utils/safeLogger');

const CONFIG_ENCRYPTION_ERROR_MESSAGES = {
  CONFIG_ENCRYPTION_KEY_MISSING: 'A chave de criptografia das configurações não está configurada no servidor. Execute a atualização/instalação novamente ou defina CONFIG_ENCRYPTION_KEY no .env.',
  CONFIG_ENCRYPTION_KEY_INVALID: 'A chave de criptografia das configurações é inválida. Defina CONFIG_ENCRYPTION_KEY no .env como uma chave base64 de 32 bytes e reinicie o backend.',
  CONFIG_ENCRYPTION_KEY_PLACEHOLDER: 'A chave de criptografia das configurações ainda contém um placeholder. Gere uma chave base64 de 32 bytes, defina CONFIG_ENCRYPTION_KEY no .env e reinicie o backend.'
};

const configEncryptionErrorResponse = (res, error) => res.status(503).json({
  code: error.code,
  error: CONFIG_ENCRYPTION_ERROR_MESSAGES[error.code]
    || 'A chave de criptografia das configurações não está disponível ou é inválida.'
});

const denySuperAdmin = async (req, res, action) => {
  await recordAuditEvent({
    user: req.user,
    action,
    status: 'denied',
    req,
    metadata: { reason: 'not_super_admin' }
  });
  return res.status(403).json({ error: 'Acesso restrito ao Super Admin.' });
};

const getSettings = async (req, res) => {
  if (!isSuperAdmin(req.user)) return denySuperAdmin(req, res, 'smtp_settings_access');
  return res.status(200).json(await getSmtpSettings());
};

const saveSettings = async (req, res) => {
  if (!isSuperAdmin(req.user)) return denySuperAdmin(req, res, 'smtp_settings_update');

  try {
    const settings = await updateSmtpSettings(req.body || {}, req.user.id);
    await recordAuditEvent({
      user: req.user,
      action: 'smtp_settings_updated',
      status: 'success',
      req,
      metadata: {
        enabled: settings.enabled,
        security: settings.security,
        password_changed: typeof req.body?.password === 'string' && req.body.password.length > 0
      }
    });
    return res.status(200).json(settings);
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      action: 'smtp_settings_updated',
      status: 'failed',
      req,
      metadata: { reason: error?.code || 'internal_error' }
    });
    if (error instanceof SmtpSettingsError) {
      return res.status(error.statusCode).json({ code: error.code, error: error.message });
    }
    if (error instanceof ConfigEncryptionError) {
      return configEncryptionErrorResponse(res, error);
    }
    safeLogError('Falha ao salvar configuração SMTP.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível salvar a configuração SMTP.' });
  }
};

const testSettings = async (req, res) => {
  if (!isSuperAdmin(req.user)) return denySuperAdmin(req, res, 'smtp_test_email');

  const to = String(req.body?.to || req.user.email || '').trim().toLowerCase();
  if (!isValidEmail(to)) {
    return res.status(400).json({ error: 'Informe um destinatário de teste válido.' });
  }

  try {
    await sendTestEmail({ to });
    await recordAuditEvent({
      user: req.user,
      action: 'smtp_test_email_sent',
      status: 'success',
      req
    });
    return res.status(200).json({ message: 'E-mail de teste enviado com sucesso.' });
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      action: 'smtp_test_email_failed',
      status: 'failed',
      req,
      metadata: { reason: error?.code || 'internal_error' }
    });
    if (error instanceof SmtpSettingsError) {
      return res.status(error.statusCode).json({ code: error.code, error: error.message });
    }
    if (error instanceof ConfigEncryptionError) {
      return configEncryptionErrorResponse(res, error);
    }
    if (!(error instanceof EmailDeliveryError)) {
      safeLogError('Falha inesperada no teste SMTP.', error, { includeStack: false });
    }
    return res.status(502).json({
      code: 'SMTP_TEST_FAILED',
      error: 'Não foi possível enviar o e-mail de teste. Revise a configuração SMTP e tente novamente.'
    });
  }
};

module.exports = {
  getSettings,
  saveSettings,
  testSettings
};
