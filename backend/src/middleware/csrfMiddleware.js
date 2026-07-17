const crypto = require('crypto');
const { recordAuditEvent } = require('../services/auditService');
const { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, isValidCsrfToken } = require('../services/csrfService');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/bootstrap',
  '/api/auth/mfa/verify-login',
  '/api/auth/mfa/setup/confirm'
]);
const deniedMessage = 'Token CSRF inválido ou ausente. Recarregue a página e tente novamente.';

const equalText = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const csrfProtection = async (req, res, next) => {
  const requestPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(requestPath) || !req.cookies?.fp_session) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER_NAME);
  if (cookieToken && headerToken && equalText(cookieToken, headerToken) && isValidCsrfToken(cookieToken)) return next();

  await recordAuditEvent({
    action: 'csrf_denied', status: 'denied', req,
    metadata: { method: req.method, path: requestPath, reason: 'invalid_or_missing' }
  });
  return res.status(403).json({ error: deniedMessage });
};

module.exports = { csrfProtection };
