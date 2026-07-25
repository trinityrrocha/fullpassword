const { validatePassword } = require('../services/passwordPolicyService');
const { recordAuditEvent } = require('../services/auditService');
const {
  PASSWORD_RESET_GENERIC_MESSAGE,
  PasswordResetError,
  requestPasswordReset,
  validatePasswordResetToken,
  completePasswordReset
} = require('../services/passwordResetService');
const { safeLogError } = require('../utils/safeLogger');

const requestReset = async (req, res) => {
  // A entrega acontece fora do tempo da resposta para que latência SMTP,
  // conta inexistente e SMTP indisponível não criem um oráculo de enumeração.
  void requestPasswordReset(req, req.body?.email).catch((error) => {
    safeLogError('Falha sanitizada no processamento assíncrono da recuperação.', {
      name: error?.name,
      code: error?.code
    }, { includeStack: false });
  });
  return res.status(200).json({ message: PASSWORD_RESET_GENERIC_MESSAGE });
};

const validateReset = async (req, res) => {
  try {
    const result = await validatePasswordResetToken(req, req.body?.token);
    return res.status(200).json(result);
  } catch (error) {
    safeLogError('Falha sanitizada ao validar recuperação de acesso.', {
      name: error?.name,
      code: error?.code
    }, { includeStack: false });
    return res.status(200).json({ valid: false, error: 'Link inválido ou expirado.' });
  }
};

const completeReset = async (req, res) => {
  let resetResult;
  try {
    const passwordValidation = await validatePassword(req.body?.new_password);
    resetResult = await completePasswordReset(req, req.body || {}, passwordValidation);

    const auditMetadata = {
      revoked_sessions: resetResult.revokedSessions,
      invalidated_client_key_shares: resetResult.removedClientShares,
      invalidated_vault_shares: resetResult.removedVaultShares,
      mfa_method: resetResult.mfaMethod
    };
    await recordAuditEvent({
      user: resetResult.user,
      action: 'password_reset_completed',
      status: 'success',
      req,
      metadata: auditMetadata
    });
    await recordAuditEvent({
      user: resetResult.user,
      action: 'password_reset_crypto_identity_rotated',
      status: 'success',
      req,
      metadata: auditMetadata
    });
    if (resetResult.mfaMethod === 'recovery_code') {
      await recordAuditEvent({
        user: resetResult.user,
        action: 'mfa_recovery_code_used',
        status: 'success',
        req,
        metadata: { context: 'password_reset' }
      });
    }
    return res.status(200).json({
      message: 'Acesso redefinido com sucesso. Entre novamente com a nova senha.'
    });
  } catch (error) {
    const isMfaFailure = error?.code === 'PASSWORD_RESET_MFA_INVALID';
    await recordAuditEvent({
      user: error?.resetUser || resetResult?.user,
      action: isMfaFailure ? 'password_reset_mfa_failed' : 'password_reset_failed',
      status: 'denied',
      req,
      metadata: { reason: error?.code || 'reset_processing_failed' }
    });
    if (isMfaFailure && typeof req.body?.recovery_code === 'string' && req.body.recovery_code.trim()) {
      await recordAuditEvent({
        user: error?.resetUser || resetResult?.user,
        action: 'mfa_recovery_code_failed',
        status: 'denied',
        req,
        metadata: { context: 'password_reset', reason: 'invalid_or_used' }
      });
    }
    if (error instanceof PasswordResetError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    safeLogError('Falha sanitizada ao concluir recuperação de acesso.', {
      name: error?.name,
      code: error?.code
    }, { includeStack: false });
    return res.status(500).json({
      error: 'Não foi possível redefinir o acesso. Solicite um novo link e tente novamente.',
      code: 'PASSWORD_RESET_FAILED'
    });
  }
};

module.exports = { requestReset, validateReset, completeReset };
