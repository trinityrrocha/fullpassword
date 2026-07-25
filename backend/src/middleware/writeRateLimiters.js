const rateLimit = require('express-rate-limit');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RATE_LIMIT_MESSAGE = 'Muitas requisições. Aguarde alguns instantes e tente novamente.';
const SMTP_TEST_RATE_LIMIT_MESSAGE = 'Limite de testes SMTP atingido. Aguarde alguns minutos antes de tentar novamente.';

const createWriteRateLimiter = ({
  windowMs,
  limit,
  code = 'RATE_LIMIT_EXCEEDED',
  message = RATE_LIMIT_MESSAGE
}) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => !MUTATING_METHODS.has(req.method),
  message: {
    code,
    error: message,
    message
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
  limit: 5,
  code: 'SMTP_TEST_RATE_LIMITED',
  message: SMTP_TEST_RATE_LIMIT_MESSAGE
});

module.exports = {
  RATE_LIMIT_MESSAGE,
  SMTP_TEST_RATE_LIMIT_MESSAGE,
  createWriteRateLimiter,
  generalWriteLimiter,
  vaultWriteLimiter,
  sensitiveOperationLimiter,
  smtpTestLimiter
};
