const argon2 = require('argon2');
const crypto = require('crypto');
const db = require('../config/database');
const { normalizeEmail } = require('../config/security');
const {
  CURRENT_KDF_PARAMS,
  CURRENT_RSA_PARAMS,
  matchesCurrentKdfMetadata
} = require('../config/cryptoParameters');
const { validateUserCryptoIdentityPayload } = require('./userCryptoIdentityService');
const { sendEmail } = require('./emailService');
const { verifyTotp, useRecoveryCode } = require('./mfaService');
const { recordAuditEvent } = require('./auditService');

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_GENERIC_MESSAGE = 'Se o e-mail estiver cadastrado, enviaremos instruções para recuperação de acesso.';
const PASSWORD_RESET_INVALID_MESSAGE = 'Link inválido ou expirado.';
const RESET_CONFIRMATION = 'RESETAR ACESSO';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CRYPTO_SALT_PATTERN = /^[a-f0-9]{64}$/;

class PasswordResetError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'PasswordResetError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const hashPasswordResetToken = (token) => (
  crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex')
);

const isValidPasswordResetToken = (token) => TOKEN_PATTERN.test(String(token || ''));

const maskEmail = (value) => {
  const email = normalizeEmail(value);
  const separator = email.lastIndexOf('@');
  if (separator <= 0) return '';
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, 1)}***@${domain}`;
};

const getResetUrl = (token) => {
  const origin = new URL(process.env.APP_ORIGIN);
  const resetUrl = new URL('/reset-password', origin);
  resetUrl.searchParams.set('token', token);
  return resetUrl.toString();
};

const buildPasswordResetEmail = (token) => {
  const link = getResetUrl(token);
  return {
    subject: 'Recuperação de acesso ao FullPassword',
    text: [
      'Foi solicitada uma recuperação de acesso para sua conta FullPassword.',
      '',
      'Acesse o link abaixo para continuar:',
      link,
      '',
      'Este link expira em 30 minutos e pode ser usado apenas uma vez.',
      '',
      'Se você não solicitou esta recuperação, ignore este e-mail.'
    ].join('\n'),
    html: [
      '<p>Foi solicitada uma recuperação de acesso para sua conta FullPassword.</p>',
      `<p><a href="${link}">Continuar recuperação de acesso</a></p>`,
      '<p>Este link expira em 30 minutos e pode ser usado apenas uma vez.</p>',
      '<p>Se você não solicitou esta recuperação, ignore este e-mail.</p>'
    ].join('')
  };
};

const requestPasswordReset = async (req, emailInput) => {
  const email = normalizeEmail(emailInput);
  let user = null;
  let tokenHash = null;

  try {
    if (email && email.length <= 254) {
      user = (await db.query(
        `SELECT id, email
         FROM users
         WHERE LOWER(email) = $1 AND is_active = TRUE
         LIMIT 1`,
        [email]
      )).rows[0] || null;
    }

    await recordAuditEvent({
      user,
      action: 'password_reset_requested',
      status: 'pending',
      req,
      metadata: { account_matched: Boolean(user) }
    });

    if (!user) return;

    const token = crypto.randomBytes(32).toString('base64url');
    tokenHash = hashPasswordResetToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const userAgent = String(req.get?.('user-agent') || '').slice(0, 1000) || null;

    await db.query(
      `INSERT INTO password_reset_tokens
         (user_id, token_hash, expires_at, requested_ip, requested_user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokenHash, expiresAt, req.ip || null, userAgent]
    );
    await db.query(
      `DELETE FROM password_reset_tokens
       WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
          OR used_at < CURRENT_TIMESTAMP - INTERVAL '7 days'`
    );

    try {
      await sendEmail({ to: user.email, ...buildPasswordResetEmail(token) });
      await recordAuditEvent({
        user,
        action: 'password_reset_email_sent',
        status: 'success',
        req,
        metadata: { expires_in_minutes: 30 }
      });
    } catch {
      await db.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE token_hash = $1 AND used_at IS NULL`,
        [tokenHash]
      );
      await recordAuditEvent({
        user,
        action: 'password_reset_email_failed',
        status: 'failed',
        req,
        metadata: { reason: 'smtp_delivery_unavailable' }
      });
    }
  } catch {
    await recordAuditEvent({
      user,
      action: 'password_reset_email_failed',
      status: 'failed',
      req,
      metadata: { reason: 'request_processing_failed' }
    });
  } finally {
    tokenHash = null;
  }
};

const findValidPasswordReset = async (token, queryable = db, { forUpdate = false } = {}) => {
  if (!isValidPasswordResetToken(token)) return null;
  const lockClause = forUpdate ? ' FOR UPDATE OF prt, u' : '';
  const result = await queryable.query(
    `SELECT
       prt.id AS reset_token_id,
       prt.user_id,
       prt.expires_at,
       u.email,
       u.is_active,
       u.is_super_admin,
       EXISTS (
         SELECT 1 FROM user_mfa_settings m
         WHERE m.user_id = u.id AND m.enabled = TRUE
       ) AS requires_mfa
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
       AND prt.used_at IS NULL
       AND prt.expires_at > CURRENT_TIMESTAMP
       AND u.is_active = TRUE
     LIMIT 1${lockClause}`,
    [hashPasswordResetToken(token)]
  );
  return result.rows[0] || null;
};

const validatePasswordResetToken = async (req, token) => {
  const reset = await findValidPasswordReset(token);
  if (!reset) {
    await recordAuditEvent({
      action: 'password_reset_failed',
      status: 'denied',
      req,
      metadata: { reason: 'invalid_or_expired_token' }
    });
    return { valid: false, error: PASSWORD_RESET_INVALID_MESSAGE };
  }

  await recordAuditEvent({
    user: { id: reset.user_id, email: reset.email },
    action: 'password_reset_token_validated',
    status: 'success',
    req,
    metadata: { requires_mfa: reset.requires_mfa }
  });
  return {
    valid: true,
    requires_mfa: reset.requires_mfa,
    email_masked: maskEmail(reset.email),
    privileged_account: reset.is_super_admin === true
  };
};

const validateWrappedKey = (wrappedKey) => {
  if (typeof wrappedKey !== 'string' || wrappedKey.length > 512) return false;
  const parts = wrappedKey.split(':');
  if (parts.length !== 2) return false;
  try {
    return Buffer.from(parts[0], 'base64').length === 12
      && Buffer.from(parts[1], 'base64').length === 48
      && Buffer.from(parts[0], 'base64').toString('base64') === parts[0]
      && Buffer.from(parts[1], 'base64').toString('base64') === parts[1];
  } catch {
    return false;
  }
};

const validateResetCryptoPayload = (payload = {}) => {
  if (!CRYPTO_SALT_PATTERN.test(String(payload.crypto_salt || ''))) {
    throw new PasswordResetError(
      'Identidade criptográfica inválida.',
      'PASSWORD_RESET_CRYPTO_INVALID'
    );
  }
  if (!validateWrappedKey(payload.wrapped_key) || !matchesCurrentKdfMetadata(payload)) {
    throw new PasswordResetError(
      'Identidade criptográfica inválida.',
      'PASSWORD_RESET_CRYPTO_INVALID'
    );
  }

  let identity;
  try {
    identity = validateUserCryptoIdentityPayload(payload);
  } catch {
    throw new PasswordResetError(
      'Identidade criptográfica inválida.',
      'PASSWORD_RESET_CRYPTO_INVALID'
    );
  }
  if (
    identity.rsaKeySize !== CURRENT_RSA_PARAMS.modulusLength
    || identity.rsaKeyVersion !== CURRENT_RSA_PARAMS.version
  ) {
    throw new PasswordResetError(
      'A nova identidade deve usar os parâmetros criptográficos atuais.',
      'PASSWORD_RESET_CRYPTO_INVALID'
    );
  }
  return identity;
};

const completePasswordReset = async (req, payload, passwordValidation) => {
  const token = String(payload.token || '');
  if (!isValidPasswordResetToken(token)) {
    throw new PasswordResetError(PASSWORD_RESET_INVALID_MESSAGE, 'PASSWORD_RESET_TOKEN_INVALID');
  }
  if (payload.confirmation !== RESET_CONFIRMATION) {
    throw new PasswordResetError(
      'Digite RESETAR ACESSO para confirmar.',
      'PASSWORD_RESET_CONFIRMATION_REQUIRED'
    );
  }
  if (typeof payload.new_password !== 'string' || payload.new_password.length > 1024) {
    throw new PasswordResetError(
      'A nova senha é inválida.',
      'WEAK_PASSWORD'
    );
  }
  if (!passwordValidation?.valid) {
    throw new PasswordResetError(
      passwordValidation?.errors?.join(' ') || 'A nova senha não atende à política de segurança.',
      'WEAK_PASSWORD'
    );
  }

  const identity = validateResetCryptoPayload(payload);
  const passwordHash = await argon2.hash(payload.new_password, { type: argon2.argon2id });
  const client = await db.pool.connect();
  let resetUser;
  let removedClientShares = 0;
  let removedVaultShares = 0;
  let mfaMethod = 'not_required';

  try {
    await client.query('BEGIN');
    const reset = await findValidPasswordReset(token, client, { forUpdate: true });
    if (!reset) {
      throw new PasswordResetError(PASSWORD_RESET_INVALID_MESSAGE, 'PASSWORD_RESET_TOKEN_INVALID');
    }
    resetUser = { id: reset.user_id, email: reset.email };

    if (reset.requires_mfa) {
      const settings = (await client.query(
        `SELECT * FROM user_mfa_settings
         WHERE user_id = $1 AND enabled = TRUE
         FOR UPDATE`,
        [reset.user_id]
      )).rows[0];
      let mfaValid = false;
      const mfaCode = typeof payload.mfa_code === 'string'
        ? payload.mfa_code.replace(/\s/g, '')
        : '';
      const recoveryCode = typeof payload.recovery_code === 'string'
        ? payload.recovery_code.trim().toUpperCase()
        : '';
      if (/^\d{6}$/.test(mfaCode) && settings) {
        try {
          mfaValid = verifyTotp(settings, mfaCode);
          if (mfaValid) mfaMethod = 'totp';
        } catch {
          mfaValid = false;
        }
      }
      if (!mfaValid && /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(recoveryCode)) {
        mfaValid = Boolean(settings && await useRecoveryCode(
          reset.user_id,
          recoveryCode,
          client
        ));
        if (mfaValid) mfaMethod = 'recovery_code';
      }
      if (!mfaValid) {
        throw new PasswordResetError(
          'Código MFA ou código de recuperação inválido.',
          'PASSWORD_RESET_MFA_INVALID',
          403
        );
      }
      await client.query(
        `UPDATE user_mfa_settings
         SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [reset.user_id]
      );
    }

    await client.query(
      `UPDATE users
       SET hash_senha_login = $1,
           crypto_salt = $2,
           wrapped_key = $3,
           public_key = $4,
           encrypted_private_key = $5,
           kdf_version = $6,
           kdf_name = $7,
           kdf_hash = $8,
           kdf_iterations = $9,
           rsa_key_size = $10,
           rsa_key_version = $11,
           token_version = token_version + 1,
           must_change_password = FALSE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12`,
      [
        passwordHash,
        payload.crypto_salt,
        payload.wrapped_key,
        identity.publicKey,
        identity.encryptedPrivateKey,
        CURRENT_KDF_PARAMS.version,
        CURRENT_KDF_PARAMS.name,
        CURRENT_KDF_PARAMS.hash,
        CURRENT_KDF_PARAMS.iterations,
        identity.rsaKeySize,
        identity.rsaKeyVersion,
        reset.user_id
      ]
    );

    const sessions = await client.query(
      `UPDATE user_sessions
       SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = 'password_reset'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [reset.user_id]
    );
    const clientShares = await client.query(
      'DELETE FROM client_key_shares WHERE user_id = $1',
      [reset.user_id]
    );
    const vaultShares = await client.query(
      'DELETE FROM vault_shares WHERE user_id = $1',
      [reset.user_id]
    );
    removedClientShares = clientShares.rowCount || 0;
    removedVaultShares = vaultShares.rowCount || 0;

    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = CURRENT_TIMESTAMP,
           used_ip = CASE WHEN id = $2 THEN $3 ELSE used_ip END,
           used_user_agent = CASE WHEN id = $2 THEN $4 ELSE used_user_agent END
       WHERE user_id = $1 AND used_at IS NULL`,
      [
        reset.user_id,
        reset.reset_token_id,
        req.ip || null,
        String(req.get?.('user-agent') || '').slice(0, 1000) || null
      ]
    );

    await client.query('COMMIT');
    return {
      user: resetUser,
      revokedSessions: sessions.rowCount || 0,
      removedClientShares,
      removedVaultShares,
      mfaMethod
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (resetUser) error.resetUser = resetUser;
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  PASSWORD_RESET_TTL_MS,
  PASSWORD_RESET_GENERIC_MESSAGE,
  PASSWORD_RESET_INVALID_MESSAGE,
  RESET_CONFIRMATION,
  PasswordResetError,
  hashPasswordResetToken,
  isValidPasswordResetToken,
  maskEmail,
  buildPasswordResetEmail,
  requestPasswordReset,
  findValidPasswordReset,
  validatePasswordResetToken,
  validateResetCryptoPayload,
  completePasswordReset
};
