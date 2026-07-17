const db = require('../config/database');
const { recordAuditEvent } = require('../services/auditService');
const { getTrustedCountry } = require('../services/securityMetadataService');
const {
  verifyChallengeToken,
  getMfaSettings,
  verifyTotp,
  replaceRecoveryCodes,
  useRecoveryCode
} = require('../services/mfaService');
const { completeLoginSession } = require('./authController');

const loadChallengeUser = async (challengeToken, purpose) => {
  const challenge = verifyChallengeToken(challengeToken, purpose);
  const result = await db.query(
    `SELECT id, name, email, role, is_active, is_super_admin, must_change_password,
            mfa_required, wrapped_key, crypto_salt, public_key, encrypted_private_key, token_version
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

module.exports = { verifyLogin, confirmSetup };
