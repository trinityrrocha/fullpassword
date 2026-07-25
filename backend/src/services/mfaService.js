const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const db = require('../config/database');
const { JWT_SECRET } = require('../config/security');

const encryptionKey = crypto.hkdfSync('sha256', Buffer.from(JWT_SECRET), Buffer.alloc(0), Buffer.from('fullpassword-mfa-encryption-v1'), 32);
authenticator.options = { window: 1 };

class MfaActionError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'MfaActionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const encryptSecret = (secret) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
};

const decryptSecret = (payload) => {
  const [iv, encrypted, tag, extra] = String(payload || '').split('.');
  if (!iv || !encrypted || !tag || extra) throw new Error('Configuração MFA inválida');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
};

const createChallengeToken = (user, purpose) => jwt.sign(
  { sub: user.id, purpose, token_version: user.token_version },
  JWT_SECRET,
  { expiresIn: '5m', audience: 'fullpassword-mfa' }
);

const verifyChallengeToken = (token, purpose) => {
  const payload = jwt.verify(String(token || ''), JWT_SECRET, { audience: 'fullpassword-mfa' });
  if (payload.purpose !== purpose || !payload.sub || !Number.isInteger(payload.token_version)) throw new Error('Desafio MFA inválido');
  return payload;
};

const getMfaSettings = async (userId) => (await db.query('SELECT * FROM user_mfa_settings WHERE user_id = $1', [userId])).rows[0] || null;

const ensureMfaSetup = async (user) => {
  let settings = await getMfaSettings(user.id);
  if (!settings) {
    const secret = authenticator.generateSecret();
    settings = (await db.query(
      `INSERT INTO user_mfa_settings (user_id, totp_secret_encrypted) VALUES ($1, $2) RETURNING *`,
      [user.id, encryptSecret(secret)]
    )).rows[0];
  }
  const secret = decryptSecret(settings.totp_secret_encrypted);
  const otpauthUrl = authenticator.keyuri(user.email, 'FullPassword', secret);
  return { settings, otpauthUrl, qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl) };
};

const verifyTotp = (settings, code) => authenticator.check(String(code || '').replace(/\s/g, ''), decryptSecret(settings.totp_secret_encrypted));

const generateRecoveryCodes = () => Array.from({ length: 10 }, () => {
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
});

const replaceRecoveryCodes = async (client, userId) => {
  const codes = generateRecoveryCodes();
  await client.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);
  for (const code of codes) {
    const hash = await argon2.hash(code, { type: argon2.argon2id });
    await client.query('INSERT INTO user_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hash]);
  }
  return codes;
};

const useRecoveryCode = async (userId, candidate, queryable = db) => {
  const codes = await queryable.query(
    'SELECT id, code_hash FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL FOR UPDATE',
    [userId]
  );
  for (const row of codes.rows) {
    if (await argon2.verify(row.code_hash, String(candidate || '').trim().toUpperCase()).catch(() => false)) {
      const used = await queryable.query(
        'UPDATE user_mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1 AND used_at IS NULL RETURNING id',
        [row.id]
      );
      return used.rows.length === 1;
    }
  }
  return false;
};

const disableMfaWithFactor = async ({
  client,
  userId,
  currentPassword,
  mfaMethod,
  mfaCode,
  recoveryCode
}) => {
  const result = await client.query(
    `SELECT u.hash_senha_login, m.*
     FROM users u
     JOIN user_mfa_settings m ON m.user_id = u.id
     WHERE u.id = $1 AND m.enabled = TRUE
     FOR UPDATE OF u, m`,
    [userId]
  );
  const settings = result.rows[0];
  if (!settings) {
    throw new MfaActionError('MFA não está habilitado.', 'MFA_NOT_ENABLED', 409);
  }

  const passwordValid = typeof currentPassword === 'string'
    && currentPassword.length > 0
    && currentPassword.length <= 1024
    && await argon2.verify(settings.hash_senha_login, currentPassword).catch(() => false);
  if (!passwordValid) {
    throw new MfaActionError('Senha atual inválida.', 'CURRENT_PASSWORD_INVALID', 403);
  }

  let factorValid = false;
  if (mfaMethod === 'totp') {
    factorValid = /^\d{6}$/.test(String(mfaCode || '').replace(/\s/g, ''))
      && verifyTotp(settings, mfaCode);
  } else if (mfaMethod === 'recovery_code') {
    const candidate = String(recoveryCode || '').trim().toUpperCase();
    factorValid = /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(candidate)
      && await useRecoveryCode(userId, candidate, client);
  } else {
    throw new MfaActionError('Método MFA inválido.', 'MFA_METHOD_INVALID');
  }

  if (!factorValid) {
    throw new MfaActionError('Código MFA inválido ou já utilizado.', 'MFA_FACTOR_INVALID', 403);
  }

  await client.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);
  const disabled = await client.query(
    'DELETE FROM user_mfa_settings WHERE user_id = $1 RETURNING user_id',
    [userId]
  );
  if (disabled.rows.length !== 1) {
    throw new MfaActionError('Não foi possível desativar o MFA.', 'MFA_DISABLE_FAILED', 500);
  }

  return { mfaMethod };
};

module.exports = {
  MfaActionError,
  encryptSecret,
  decryptSecret,
  createChallengeToken,
  verifyChallengeToken,
  getMfaSettings,
  ensureMfaSetup,
  verifyTotp,
  replaceRecoveryCodes,
  useRecoveryCode,
  disableMfaWithFactor
};
