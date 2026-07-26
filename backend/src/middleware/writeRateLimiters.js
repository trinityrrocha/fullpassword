const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const ipaddr = require('ipaddr.js');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RATE_LIMIT_MESSAGE = 'Muitas requisições. Aguarde alguns instantes e tente novamente.';
const SMTP_TEST_RATE_LIMIT_MESSAGE = 'Limite de testes SMTP atingido. Aguarde alguns minutos antes de tentar novamente.';
const PASSWORD_RESET_RATE_LIMIT_MESSAGE = 'Muitas tentativas de recuperação. Aguarde alguns minutos e tente novamente.';
const SHORT_RATE_LIMIT_MESSAGE = 'Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente novamente.';

const normalizeIpKey = (value) => {
  try {
    const parsed = ipaddr.process(String(value || ''));
    if (parsed.kind() === 'ipv4') return parsed.toString();
    return parsed.toNormalizedString().split(':').slice(0, 4).join(':');
  } catch {
    return 'unknown';
  }
};

const hashRateLimitValue = (value) => (
  crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex')
);

const passwordResetRateLimitResponse = {
  code: 'PASSWORD_RESET_RATE_LIMITED',
  error: PASSWORD_RESET_RATE_LIMIT_MESSAGE,
  message: PASSWORD_RESET_RATE_LIMIT_MESSAGE
};

const createPasswordResetLimiter = ({ limit, keyGenerator }) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  message: passwordResetRateLimitResponse
});

const createWriteRateLimiter = ({
  windowMs,
  limit,
  code = 'RATE_LIMIT_EXCEEDED',
  message = RATE_LIMIT_MESSAGE,
  keyPrefix = 'write',
  keyGenerator
}) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => !MUTATING_METHODS.has(req.method),
  keyGenerator: keyGenerator || ((req) => `${keyPrefix}:${req.user?.id || normalizeIpKey(req.ip)}`),
  message: {
    code,
    error: message,
    message
  },
  handler: (req, res, _next, options) => {
    const resetTime = req.rateLimit?.resetTime instanceof Date
      ? req.rateLimit.resetTime.getTime()
      : Date.now() + windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(options.statusCode).json({
      ...options.message,
      retry_after_seconds: retryAfterSeconds
    });
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
  limit: 5,
  keyPrefix: 'sensitive-operation'
});

const cloudBackupConfigLimiter = createWriteRateLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  code: 'CLOUD_BACKUP_CONFIG_RATE_LIMITED',
  message: SHORT_RATE_LIMIT_MESSAGE,
  keyPrefix: 'cloud-backup-config'
});

const cloudBackupOperationLimiter = createWriteRateLimiter({
  windowMs: 60 * 1000,
  limit: 5,
  code: 'CLOUD_BACKUP_OPERATION_RATE_LIMITED',
  message: SHORT_RATE_LIMIT_MESSAGE,
  keyPrefix: 'cloud-backup-operation'
});

const systemUpdateLimiter = createWriteRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  code: 'SYSTEM_UPDATE_RATE_LIMITED',
  message: SHORT_RATE_LIMIT_MESSAGE,
  keyPrefix: 'system-update'
});

const smtpTestLimiter = createWriteRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  code: 'SMTP_TEST_RATE_LIMITED',
  message: SMTP_TEST_RATE_LIMIT_MESSAGE
});

const passwordResetRequestIpLimiter = createPasswordResetLimiter({
  limit: 3,
  keyGenerator: (req) => `password-reset-request-ip:${normalizeIpKey(req.ip)}`
});

const passwordResetRequestLimiter = createPasswordResetLimiter({
  limit: 3,
  keyGenerator: (req) => (
    `password-reset-request-email:${hashRateLimitValue(req.body?.email)}`
  )
});

const passwordResetValidateLimiter = createPasswordResetLimiter({
  limit: 20,
  keyGenerator: (req) => `password-reset-validate:${normalizeIpKey(req.ip)}`
});

const passwordResetCompleteLimiter = createPasswordResetLimiter({
  limit: 5,
  keyGenerator: (req) => (
    `password-reset-complete:${normalizeIpKey(req.ip)}:${hashRateLimitValue(req.body?.token)}`
  )
});

module.exports = {
  RATE_LIMIT_MESSAGE,
  SMTP_TEST_RATE_LIMIT_MESSAGE,
  PASSWORD_RESET_RATE_LIMIT_MESSAGE,
  SHORT_RATE_LIMIT_MESSAGE,
  createWriteRateLimiter,
  generalWriteLimiter,
  vaultWriteLimiter,
  sensitiveOperationLimiter,
  cloudBackupConfigLimiter,
  cloudBackupOperationLimiter,
  systemUpdateLimiter,
  smtpTestLimiter,
  passwordResetRequestIpLimiter,
  passwordResetRequestLimiter,
  passwordResetValidateLimiter,
  passwordResetCompleteLimiter
};
