const db = require('../config/database');
const { recordAuditEvent } = require('./auditService');

const COMMON_PASSWORDS = new Set([
  '123456', 'password', 'admin123', 'qwerty', 'senha123', 'empresa123', 'fullpassword123'
]);

const getPasswordPolicy = async (client = db) => {
  const result = await client.query('SELECT * FROM password_policy_settings WHERE id = 1');
  return result.rows[0] || {
    min_length: 12,
    require_uppercase: true,
    require_lowercase: true,
    require_number: true,
    require_special: true,
    block_common_passwords: true,
    password_change_notice_months: null
  };
};

const evaluatePassword = (password, policy) => {
  const value = String(password || '');
  const errors = [];
  if (value.length < Math.max(12, policy.min_length)) errors.push(`A senha deve ter ao menos ${Math.max(12, policy.min_length)} caracteres.`);
  if (policy.require_uppercase && !/[A-Z]/.test(value)) errors.push('A senha precisa conter uma letra maiúscula.');
  if (policy.require_lowercase && !/[a-z]/.test(value)) errors.push('A senha precisa conter uma letra minúscula.');
  if (policy.require_number && !/[0-9]/.test(value)) errors.push('A senha precisa conter um número.');
  if (policy.require_special && !/[^A-Za-z0-9]/.test(value)) errors.push('A senha precisa conter um caractere especial.');
  if (policy.block_common_passwords && COMMON_PASSWORDS.has(value.trim().toLowerCase())) errors.push('Esta senha é muito comum e não pode ser usada.');
  return { valid: errors.length === 0, errors, policy };
};

const validatePassword = async (password, client = db) => evaluatePassword(password, await getPasswordPolicy(client));

const rejectWeakPassword = async ({ req, res, password, context, user = null, client = db }) => {
  const validation = await validatePassword(password, client);
  if (validation.valid) return false;
  await recordAuditEvent({
    user: user || req.user, action: 'weak_password_rejected', status: 'denied', req,
    metadata: { context, failed_requirements: validation.errors.length }
  });
  res.status(400).json({ error: validation.errors.join(' '), code: 'WEAK_PASSWORD', requirements: validation.errors });
  return true;
};

module.exports = { COMMON_PASSWORDS, getPasswordPolicy, evaluatePassword, validatePassword, rejectWeakPassword };
