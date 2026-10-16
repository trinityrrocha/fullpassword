const db = require('../config/database');
const { recordAuditEvent } = require('./auditService');

const COMMON_PASSWORDS = new Set([
  '123456', 'password', 'admin123', 'qwerty', 'senha123', 'empresa123', 'fullpassword123'
]);

const MIN_LENGTH_OPTIONS = [8, 12, 16, 20];
const ROTATION_OPTIONS = [6, 12, 18];
const legacyMinimum = value => {
  const minimum = Math.max(12, Number(value) || 12);
  const supported = MIN_LENGTH_OPTIONS.find(option => option >= minimum);
  if (!supported) throw new Error('PASSWORD_POLICY_LEGACY_MINIMUM_UNSUPPORTED');
  return supported;
};
const normalizePolicy = policy => ({...policy,
  login_min_length: policy.login_min_length ?? legacyMinimum(policy.min_length),
  login_rotation_months: policy.login_rotation_months ?? (policy.password_change_notice_months == null ? 12 : ROTATION_OPTIONS.find(value => value >= policy.password_change_notice_months) || 18),
  vault_min_length: policy.vault_min_length ?? 16,
  vault_rotation_months: policy.vault_rotation_months ?? 12
});
const publicPolicy = policy => Object.fromEntries(['login_min_length','login_rotation_months','vault_min_length','vault_rotation_months',
  'require_uppercase','require_lowercase','require_number','require_special','block_common_passwords'].map(key => [key, policy[key]]));
const isExpired = (value, months, now = new Date()) => {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last));
  return new Date(now) >= date;
};
const rotationStatus = (user, policy = user, now = new Date()) => ({
  password_change_required: user.must_change_password === true || isExpired(user.password_changed_at, policy.login_rotation_months || 12, now),
  vault_secret_change_required: Boolean(user.crypto_identity) && isExpired(user.vault_secret_changed_at, policy.vault_rotation_months || 12, now)
});

const getPasswordPolicy = async (client = db) => {
  const result = await client.query('SELECT * FROM password_policy_settings WHERE id = 1');
  return normalizePolicy(result.rows[0] || {
    min_length: 12,
    require_uppercase: true,
    require_lowercase: true,
    require_number: true,
    require_special: true,
    block_common_passwords: true,
    password_change_notice_months: null
  });
};

const evaluatePassword = (password, policy) => {
  const value = String(password || '');
  const errors = [];
  const minimum = normalizePolicy(policy).login_min_length;
  if (value.length < minimum) errors.push(`A senha deve ter ao menos ${minimum} caracteres.`);
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

module.exports = { COMMON_PASSWORDS, MIN_LENGTH_OPTIONS, ROTATION_OPTIONS, normalizePolicy, publicPolicy, isExpired, rotationStatus, getPasswordPolicy, evaluatePassword, validatePassword, rejectWeakPassword };
