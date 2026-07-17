const crypto = require('crypto');
const { JWT_SECRET } = require('../config/security');

const CSRF_COOKIE_NAME = 'fp_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const csrfKey = crypto.hkdfSync('sha256', Buffer.from(JWT_SECRET), Buffer.alloc(0), Buffer.from('fullpassword-csrf-v1'), 32);

const sign = (randomToken) => crypto.createHmac('sha256', csrfKey).update(randomToken).digest('base64url');
const createCsrfToken = () => {
  const randomToken = crypto.randomBytes(32).toString('base64url');
  return `${randomToken}.${sign(randomToken)}`;
};

const isValidCsrfToken = (value) => {
  const [randomToken, signature, extra] = String(value || '').split('.');
  if (!randomToken || !signature || extra || !/^[A-Za-z0-9_-]{43}$/.test(randomToken)) return false;
  const expected = Buffer.from(sign(randomToken));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

const csrfCookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
});

const issueCsrfCookie = (res) => {
  const token = createCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  return token;
};

const clearCsrfCookie = (res) => res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions());

module.exports = { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, createCsrfToken, isValidCsrfToken, issueCsrfCookie, clearCsrfCookie };
