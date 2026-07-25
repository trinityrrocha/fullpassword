const rateLimit = require('express-rate-limit');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RATE_LIMIT_MESSAGE = 'Muitas requisições. Aguarde alguns instantes e tente novamente.';

const createWriteRateLimiter = ({ windowMs, limit }) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => !MUTATING_METHODS.has(req.method),
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    error: RATE_LIMIT_MESSAGE,
    message: RATE_LIMIT_MESSAGE
  }
});

const generalWriteLimiter = createWriteRateLimiter({
  windowMs: 60 * 1000,
  limit: 60
});

const vaultWriteLimiter = createWriteRateLimiter({
  windowMs: 60 * 1000,
  limit: 30
});

const sensitiveOperationLimiter = createWriteRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5
});

const smtpTestLimiter = createWriteRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5
});

module.exports = {
  RATE_LIMIT_MESSAGE,
  createWriteRateLimiter,
  generalWriteLimiter,
  vaultWriteLimiter,
  sensitiveOperationLimiter,
  smtpTestLimiter
};
