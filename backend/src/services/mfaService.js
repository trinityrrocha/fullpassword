const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const db = require('../config/database');
const { JWT_SECRET } = require('../config/security');

const encryptionKey = crypto.hkdfSync('sha256', Buffer.from(JWT_SECRET), Buffer.alloc(0), Buffer.from('fullpassword-mfa-encryption-v1'), 32);
authenticator.options = { window: 1 };

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

const useRecoveryCode = async (userId, candidate) => {
  const codes = await db.query('SELECT id, code_hash FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  for (const row of codes.rows) {
    if (await argon2.verify(row.code_hash, String(candidate || '').trim().toUpperCase()).catch(() => false)) {
      const used = await db.query('UPDATE user_mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1 AND used_at IS NULL RETURNING id', [row.id]);
      return used.rows.length === 1;
    }
  }
  return false;
};

module.exports = { encryptSecret, decryptSecret, createChallengeToken, verifyChallengeToken, getMfaSettings, ensureMfaSetup, verifyTotp, replaceRecoveryCodes, useRecoveryCode };
