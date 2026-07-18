const db = require('../config/database');
const { recordAuditEvent } = require('../services/auditService');
const { getTrustedCountry } = require('../services/securityMetadataService');
const {
  verifyChallengeToken,
  getMfaSettings,
  ensureMfaSetup,
  verifyTotp,
  replaceRecoveryCodes,
  useRecoveryCode
} = require('../services/mfaService');
const { completeLoginSession } = require('./authController');

const loadChallengeUser = async (challengeToken, purpose) => {
  const challenge = verifyChallengeToken(challengeToken, purpose);
  const result = await db.query(
    `SELECT id, name, email, role, is_active, is_super_admin, must_change_password,
            mfa_required, wrapped_key, crypto_salt, public_key, encrypted_private_key, token_version,
            password_changed_at,
            (SELECT password_change_notice_months FROM password_policy_settings WHERE id = 1) AS password_change_notice_months
     FROM users WHERE id = $1 AND token_version = $2 LIMIT 1`,
    [challenge.sub, challenge.token_version]
  );
  const user = result.rows[0];
  if (!user || user.is_active === false) throw new Error('Desafio MFA invÃ¡lido ou expirado');
  return user;
};

const auditMfaFailure = (req, user, action) => recordAuditEvent({
  user,
  action,
  status: 'denied',
  req,
  metadata: { reason: 'invalid_or_expired_challenge', country: getTrustedCountry(req) }
});

const verifyLogin = async (req, res) => {
  let user = null;
  try {
    user = await loadChallengeUser(req.body?.challenge_token, 'login');
    const settings = await getMfaSettings(user.id);
    if (!settings?.enabled) throw new Error('MFA nÃ£o configurado');

    let recoveryCodeUsed = false;
    const validTotp = req.body?.code ? verifyTotp(settings, req.body.code) : false;
    if (!validTotp && req.body?.recovery_code) {
      recoveryCodeUsed = await useRecoveryCode(user.id, req.body.recovery_code);
    }
    if (!validTotp && !recoveryCodeUsed) {
      await auditMfaFailure(req, user, 'mfa_login_failed');
      return res.status(401).json({ error: 'CÃ³digo MFA invÃ¡lido ou expirado' });
    }

    await db.query('UPDATE user_mfa_settings SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1', [user.id]);
    await recordAuditEvent({
      user,
      action: recoveryCodeUsed ? 'mfa_recovery_code_used' : 'mfa_login_success',
      status: 'success',
      req,
      metadata: { country: getTrustedCountry(req) }
    });
    return completeLoginSession(req, res, { ...user, mfa_enabled: true }, { recovery_code_used: recoveryCodeUsed });
  } catch (error) {
    await auditMfaFailure(req, user, 'mfa_login_failed').catch(() => {});
    return res.status(401).json({ error: 'Desafio MFA invÃ¡lido ou expirado' });
  }
};

const confirmSetup = async (req, res) => {
  let user = null;
  let client;
  try {
    user = await loadChallengeUser(req.body?.setup_token, 'setup');
    const settings = await getMfaSettings(user.id);
    if (!settings || settings.enabled || !verifyTotp(settings, req.body?.code)) {
      await auditMfaFailure(req, user, 'mfa_setup_failed');
      return res.status(401).json({ error: 'CÃ³digo MFA invÃ¡lido ou expirado' });
    }

    client = await db.pool.connect();
    await client.query('BEGIN');
    await client.query(
      `UPDATE user_mfa_settings
       SET enabled = TRUE, confirmed_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [user.id]
    );
    const recoveryCodes = await replaceRecoveryCodes(client, user.id);
    await client.query('COMMIT');
    await recordAuditEvent({
      user, action: 'mfa_setup_confirmed', status: 'success', req,
      metadata: { country: getTrustedCountry(req) }
    });
    return completeLoginSession(req, res, { ...user, mfa_enabled: true }, { recovery_codes: recoveryCodes });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    await auditMfaFailure(req, user, 'mfa_setup_failed').catch(() => {});
    return res.status(401).json({ error: 'Desafio MFA invÃ¡lido ou expirado' });
  } finally {
    if (client) client.release();
  }
};

const getProfileStatus = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.mfa_required,
              COALESCE(m.enabled, FALSE) AS mfa_enabled,
              COUNT(c.id) FILTER (WHERE c.used_at IS NULL)::integer AS recovery_codes_remaining
       FROM users u
       LEFT JOIN user_mfa_settings m ON m.user_id = u.id
       LEFT JOIN user_mfa_recovery_codes c ON c.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.mfa_required, m.enabled`,
      [req.user.id]
    );
    return res.status(200).json(result.rows[0] || { mfa_required: false, mfa_enabled: false, recovery_codes_remaining: 0 });
  } catch (error) {
    console.error('Erro ao consultar status MFA:', error);
    return res.status(500).json({ error: 'Não foi possível consultar o status MFA' });
  }
};

const startProfileSetup = async (req, res) => {
  try {
    const existing = await getMfaSettings(req.user.id);
    if (existing?.enabled) return res.status(409).json({ error: 'MFA já está habilitado' });
    const setup = await ensureMfaSetup(req.user);
    await recordAuditEvent({
      user: req.user, action: 'mfa_setup_started', status: 'pending', req,
      metadata: { country: getTrustedCountry(req) }
    });
    return res.status(200).json({ otpauth_url: setup.otpauthUrl, qr_code_data_url: setup.qrCodeDataUrl });
  } catch (error) {
    console.error('Erro ao iniciar configuração MFA:', error);
    return res.status(500).json({ error: 'Não foi possível iniciar a configuração MFA' });
  }
};

const confirmProfileSetup = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const settings = await getMfaSettings(req.user.id);
    if (!settings || settings.enabled || !verifyTotp(settings, req.body?.code)) {
      await auditMfaFailure(req, req.user, 'mfa_setup_failed');
      return res.status(401).json({ error: 'Código MFA inválido ou expirado' });
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE user_mfa_settings
       SET enabled = TRUE, confirmed_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [req.user.id]
    );
    const recoveryCodes = await replaceRecoveryCodes(client, req.user.id);
    await client.query('COMMIT');
    await recordAuditEvent({
      user: req.user, action: 'mfa_setup_confirmed', status: 'success', req,
      metadata: { country: getTrustedCountry(req) }
    });
    return res.status(200).json({ message: 'MFA habilitado', recovery_codes: recoveryCodes });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao confirmar configuração MFA:', error);
    return res.status(500).json({ error: 'Não foi possível confirmar a configuração MFA' });
  } finally {
    client.release();
  }
};

const regenerateRecoveryCodes = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const settings = await getMfaSettings(req.user.id);
    if (!settings?.enabled || !verifyTotp(settings, req.body?.code)) {
      return res.status(401).json({ error: 'Código MFA inválido ou expirado' });
    }
    await client.query('BEGIN');
    const recoveryCodes = await replaceRecoveryCodes(client, req.user.id);
    await client.query(
      `UPDATE user_mfa_settings SET recovery_codes_version = recovery_codes_version + 1,
       updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [req.user.id]
    );
    await client.query('COMMIT');
    await recordAuditEvent({
      user: req.user, action: 'mfa_recovery_codes_regenerated', status: 'success', req,
      metadata: { country: getTrustedCountry(req) }
    });
    return res.status(200).json({ recovery_codes: recoveryCodes });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao regenerar códigos de recuperação:', error);
    return res.status(500).json({ error: 'Não foi possível regenerar os códigos de recuperação' });
  } finally {
    client.release();
  }
};

module.exports = {
  verifyLogin,
  confirmSetup,
  getProfileStatus,
  startProfileSetup,
  confirmProfileSetup,
  regenerateRecoveryCodes
};
