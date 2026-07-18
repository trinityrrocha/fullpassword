const argon2 = require('argon2');
const crypto = require('crypto');
const db = require('../config/database');
const { recordAuditEvent } = require('../services/auditService');
const { applyAutomaticBlockForLoginFailure } = require('../services/ipSecurityService');
const { getTrustedCountry } = require('../services/securityMetadataService');
const { issueCsrfCookie, clearCsrfCookie } = require('../services/csrfService');
const { getMfaSettings, ensureMfaSetup, createChallengeToken } = require('../services/mfaService');
const { ABSOLUTE_SESSION_MS, createUserSession, revokeTokenSession } = require('../services/sessionService');
const { rejectWeakPassword } = require('../services/passwordPolicyService');
const {
  ADMIN_BOOTSTRAP_TOKEN,
  SUPER_ADMIN_EMAIL,
  normalizeEmail,
  timingSafeEqualText
} = require('../config/security');

const LEGACY_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
const LEGACY_ADMIN_HASH = '$argon2id$v=19$m=65536,t=3,p=4$PLACEHOLDER_HASH_FOR_@dmin123';

const SESSION_COOKIE_NAME = 'fp_session';

const isPasswordChangeRecommended = (user) => {
  const months = Number(user.password_change_notice_months);
  if (!months || !user.password_changed_at) return false;
  const dueAt = new Date(user.password_changed_at);
  dueAt.setMonth(dueAt.getMonth() + months);
  return dueAt <= new Date();
};

const auditLoginFailure = async (req, emailAttempted, reason, user = null) => {
  await recordAuditEvent({
    user,
    userEmail: emailAttempted || null,
    action: 'login_failed',
    status: 'denied',
    req,
    metadata: { email_attempted: emailAttempted || null, reason, country: getTrustedCountry(req) }
  });
  await applyAutomaticBlockForLoginFailure(req);
};

const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: ABSOLUTE_SESSION_MS
});

const serializeUser = (user, groups = []) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  is_active: user.is_active,
  is_super_admin: user.is_super_admin === true,
  must_change_password: user.must_change_password === true,
  mfa_required: user.mfa_required === true,
  mfa_enabled: user.mfa_enabled === true,
  password_change_recommended: isPasswordChangeRecommended(user),
  wrapped_key: user.wrapped_key,
  crypto_salt: user.crypto_salt,
  public_key: user.public_key,
  encrypted_private_key: user.encrypted_private_key,
  groups
});

const getBootstrapState = async (client = db) => {
  const result = await client.query(
    `SELECT
       COUNT(*)::integer AS total_users,
       COUNT(*) FILTER (WHERE role = 'admin' AND is_super_admin = TRUE AND hash_senha_login <> $1)::integer AS secure_super_admins,
       COUNT(*) FILTER (WHERE email = $2 AND hash_senha_login = $1)::integer AS legacy_admins
     FROM users`,
    [LEGACY_ADMIN_HASH, LEGACY_ADMIN_EMAIL]
  );
  const state = result.rows[0];
  return {
    required: state.secure_super_admins === 0,
    empty: state.total_users === 0,
    legacyOnly: state.total_users === 1 && state.legacy_admins === 1
  };
};

const bootstrapStatus = async (_req, res) => {
  try {
    const state = await getBootstrapState();
    return res.status(200).json({
      required: state.required,
      super_admin_email: SUPER_ADMIN_EMAIL
    });
  } catch (error) {
    console.error('Erro ao consultar bootstrap:', error);
    return res.status(500).json({ error: 'Não foi possível consultar a configuração inicial' });
  }
};

const bootstrapAdmin = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { name, email, password, bootstrap_token: bootstrapToken } = req.body || {};
    const adminEmail = normalizeEmail(email);

    if (!timingSafeEqualText(bootstrapToken, ADMIN_BOOTSTRAP_TOKEN)) {
      return res.status(403).json({ error: 'Token de configuração inicial inválido' });
    }
    if (!String(name || '').trim() || !adminEmail || !password) {
      return res.status(400).json({ error: 'Nome, e-mail e senha com ao menos 12 caracteres são obrigatórios' });
    }
    if (await rejectWeakPassword({ req, res, password, context: 'bootstrap' })) return;
    if (adminEmail !== SUPER_ADMIN_EMAIL) {
      return res.status(400).json({
        error: `O primeiro administrador deve usar o e-mail inicial configurado: ${SUPER_ADMIN_EMAIL}`
      });
    }

    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const state = await getBootstrapState(client);
    if (!state.required) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A configuração inicial já foi concluída' });
    }
    if (!state.empty && !state.legacyOnly) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Instalação legada detectada. A migração automática foi bloqueada para preservar dados criptografados.'
      });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    let user;
    if (state.legacyOnly) {
      const ownership = await client.query(
        `SELECT
           EXISTS(SELECT 1 FROM clients c JOIN users u ON u.id = c.created_by WHERE u.email = $1) OR
           EXISTS(SELECT 1 FROM vault_items v JOIN users u ON u.id = v.created_by WHERE u.email = $1) AS owns_data`,
        [LEGACY_ADMIN_EMAIL]
      );
      if (ownership.rows[0].owns_data) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'O administrador legado possui dados criptografados. Use o procedimento seguro de migração.'
        });
      }
      const updated = await client.query(
        `UPDATE users
         SET name = $1, email = $2, hash_senha_login = $3, wrapped_key = NULL,
             crypto_salt = NULL, public_key = NULL, encrypted_private_key = NULL,
             role = 'admin', is_active = TRUE, is_super_admin = TRUE, must_change_password = FALSE,
             token_version = token_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE email = $4 AND hash_senha_login = $5
         RETURNING id, name, email, role, is_active, is_super_admin, must_change_password`,
        [String(name).trim(), adminEmail, passwordHash, LEGACY_ADMIN_EMAIL, LEGACY_ADMIN_HASH]
      );
      user = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO users (name, email, hash_senha_login, role, is_super_admin, must_change_password)
         VALUES ($1, $2, $3, 'admin', TRUE, FALSE)
         RETURNING id, name, email, role, is_active, is_super_admin, must_change_password`,
        [String(name).trim(), adminEmail, passwordHash]
      );
      user = inserted.rows[0];
    }

    const group = await client.query(
      `INSERT INTO groups (name, description, can_view, can_edit, can_add, can_delete)
       SELECT 'Administradores', 'Acesso total ao sistema', TRUE, TRUE, TRUE, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM groups WHERE name = 'Administradores')
       RETURNING id`
    );
    const groupId = group.rows[0]?.id || (await client.query(
      "SELECT id FROM groups WHERE name = 'Administradores' ORDER BY created_at LIMIT 1"
    )).rows[0].id;
    await client.query(
      'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [user.id, groupId]
    );
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Super Admin configurado com sucesso', user });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro no bootstrap:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'Este e-mail já está em uso' });
    return res.status(500).json({ error: 'Erro ao concluir a configuração inicial' });
  } finally {
    client.release();
  }
};

const login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || !password) {
      await auditLoginFailure(req, email, 'missing_credentials');
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const result = await db.query(
      `SELECT id, name, email, hash_senha_login, role, wrapped_key, crypto_salt,
              is_active, is_super_admin, must_change_password, mfa_required,
              public_key, encrypted_private_key, token_version, password_changed_at,
              (SELECT password_change_notice_months FROM password_policy_settings WHERE id = 1) AS password_change_notice_months
       FROM users WHERE LOWER(email) = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || user.hash_senha_login === LEGACY_ADMIN_HASH) {
      await auditLoginFailure(req, email, user ? 'legacy_admin_blocked' : 'invalid_credentials');
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    if (user.is_active === false) {
      await auditLoginFailure(req, email, 'inactive_account', user);
      return res.status(403).json({ error: 'Conta inativa. Contate o administrador.' });
    }

    let isPasswordValid = false;
    try {
      isPasswordValid = await argon2.verify(user.hash_senha_login, password);
    } catch (error) {
      console.error('Erro ao verificar senha com Argon2:', error);
    }
    if (!isPasswordValid) {
      await auditLoginFailure(req, email, 'invalid_credentials', user);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    let finalWrappedKey = user.wrapped_key;
    let finalCryptoSalt = user.crypto_salt;

    if (!user.wrapped_key) {
      finalCryptoSalt = crypto.randomBytes(32).toString('hex');
      const masterKeyBuffer = crypto.randomBytes(32);
      const kekBuffer = crypto.pbkdf2Sync(password, finalCryptoSalt, 100000, 32, 'sha256');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', kekBuffer, iv);
      const ciphertext = Buffer.concat([cipher.update(masterKeyBuffer), cipher.final(), cipher.getAuthTag()]);
      finalWrappedKey = `${iv.toString('base64')}:${ciphertext.toString('base64')}`;
      await db.query(
        'UPDATE users SET wrapped_key = $1, crypto_salt = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [finalWrappedKey, finalCryptoSalt, user.id]
      );
    }

    const sessionUser = { ...user, wrapped_key: finalWrappedKey, crypto_salt: finalCryptoSalt };
    const mfaSettings = await getMfaSettings(user.id);
    if (mfaSettings?.enabled) {
      await recordAuditEvent({
        user, action: 'mfa_login_required', status: 'pending', req,
        metadata: { country: getTrustedCountry(req) }
      });
      return res.status(200).json({
        mfa_required: true,
        mfa_setup_required: false,
        challenge_token: createChallengeToken(sessionUser, 'login')
      });
    }
    if (user.mfa_required === true) {
      const setup = await ensureMfaSetup(sessionUser);
      await recordAuditEvent({
        user, action: 'mfa_setup_started', status: 'pending', req,
        metadata: { country: getTrustedCountry(req) }
      });
      return res.status(200).json({
        mfa_required: true,
        mfa_setup_required: true,
        setup_token: createChallengeToken(sessionUser, 'setup'),
        otpauth_url: setup.otpauthUrl,
        qr_code_data_url: setup.qrCodeDataUrl
      });
    }
    return completeLoginSession(req, res, sessionUser);
  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({ error: 'Erro interno no servidor durante a autenticação' });
  }
};

const me = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, role, is_active, is_super_admin, must_change_password, mfa_required,
              wrapped_key, crypto_salt, public_key, encrypted_private_key, password_changed_at,
              (SELECT password_change_notice_months FROM password_policy_settings WHERE id = 1) AS password_change_notice_months,
              EXISTS(SELECT 1 FROM user_mfa_settings m WHERE m.user_id = users.id AND m.enabled = TRUE) AS mfa_enabled
       FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    return res.status(200).json({ user: serializeUser(result.rows[0], req.user.groups) });
  } catch (error) {
    console.error('Erro ao restaurar sessão:', error);
    return res.status(500).json({ error: 'Não foi possível restaurar a sessão' });
  }
};

const csrf = async (_req, res) => {
  issueCsrfCookie(res);
  return res.status(200).json({ message: 'Token CSRF renovado.' });
};

const completeLoginSession = async (req, res, user, extraResponse = {}) => {
  const groupsResult = await db.query('SELECT group_id FROM user_groups WHERE user_id = $1', [user.id]);
  const groups = groupsResult.rows.map((row) => row.group_id);
  const { token } = await createUserSession(req, user);
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
  issueCsrfCookie(res);
  await recordAuditEvent({
    user, action: 'login_success', status: 'success', req,
    metadata: { email: user.email, method: 'password', country: getTrustedCountry(req) }
  });
  return res.status(200).json({ message: 'Login realizado com sucesso', user: serializeUser(user, groups), ...extraResponse });
};

const logout = async (req, res) => {
  try {
    const revoked = await revokeTokenSession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (revoked) {
      await recordAuditEvent({
        user: { id: revoked.user_id }, action: 'session_revoked', status: 'success', req,
        metadata: { reason: 'logout' }
      });
    }
  } catch (error) {
    console.error('Falha ao revogar sessão durante logout:', error.message);
  }
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });
  clearCsrfCookie(res);
  return res.status(200).json({ message: 'Logout realizado com sucesso' });
};

module.exports = { login, completeLoginSession, logout, me, csrf, bootstrapStatus, bootstrapAdmin };
