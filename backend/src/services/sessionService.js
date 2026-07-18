const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { UAParser } = require('ua-parser-js');
const db = require('../config/database');
const { JWT_SECRET } = require('../config/security');
const { recordAuditEvent } = require('./auditService');

const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
const IDLE_SESSION_MS = 60 * 60 * 1000;
const LAST_SEEN_UPDATE_MS = 5 * 60 * 1000;

const hashSessionToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const safeEqualHash = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const parseClient = (userAgent) => {
  const parsed = new UAParser(String(userAgent || '')).getResult();
  return {
    browser: [parsed.browser.name, parsed.browser.version].filter(Boolean).join(' ').slice(0, 160) || 'Não identificado',
    os: [parsed.os.name, parsed.os.version].filter(Boolean).join(' ').slice(0, 160) || 'Não identificado',
    device: [parsed.device.vendor, parsed.device.model, parsed.device.type].filter(Boolean).join(' ').slice(0, 160) || 'Computador'
  };
};

const createUserSession = async (req, user) => {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(now + ABSOLUTE_SESSION_MS);
  const idleExpiresAt = new Date(now + IDLE_SESSION_MS);
  const token = jwt.sign(
    { id: user.id, token_version: user.token_version, session_id: id },
    JWT_SECRET,
    { expiresIn: Math.floor(ABSOLUTE_SESSION_MS / 1000) }
  );
  const userAgent = String(req.get?.('user-agent') || '').slice(0, 1000);
  const client = parseClient(userAgent);
  await db.query(
    `INSERT INTO user_sessions
       (id, user_id, token_version, session_hash, ip_address, user_agent, browser, os, device, expires_at, idle_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, user.id, user.token_version, hashSessionToken(token), req.ip || null, userAgent || null,
      client.browser, client.os, client.device, expiresAt, idleExpiresAt]
  );
  const metadata = { browser: client.browser, os: client.os, device: client.device };
  await recordAuditEvent({ user, action: 'session_created', status: 'success', req, metadata });
  await recordAuditEvent({ user, action: 'new_login_detected', status: 'success', req, metadata });
  return { token, id, expiresAt };
};

const validateUserSession = async (req, token, decoded) => {
  if (!decoded.session_id) return null;
  const result = await db.query('SELECT * FROM user_sessions WHERE id = $1 AND user_id = $2 LIMIT 1', [decoded.session_id, decoded.id]);
  const session = result.rows[0];
  if (!session || session.revoked_at || !safeEqualHash(session.session_hash, hashSessionToken(token))) return null;

  const now = new Date();
  const expiredReason = new Date(session.expires_at) <= now
    ? 'absolute_expiration'
    : new Date(session.idle_expires_at) <= now ? 'idle_expiration' : null;
  if (expiredReason) {
    await db.query(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = $1
       WHERE id = $2 AND revoked_at IS NULL`,
      [expiredReason, session.id]
    );
    await recordAuditEvent({
      user: { id: decoded.id }, action: 'session_expired', status: 'expired', req,
      metadata: { reason: expiredReason }
    });
    return null;
  }

  if (now.getTime() - new Date(session.last_seen_at).getTime() >= LAST_SEEN_UPDATE_MS) {
    await db.query(
      `UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP,
       idle_expires_at = CURRENT_TIMESTAMP + ($1 * INTERVAL '1 millisecond') WHERE id = $2`,
      [IDLE_SESSION_MS, session.id]
    );
  }
  return session;
};

const revokeTokenSession = async (token, reason = 'logout') => {
  if (!token) return null;
  let decoded;
  try {
    decoded = jwt.decode(token);
  } catch {
    return null;
  }
  if (!decoded?.session_id || !decoded?.id) return null;
  const result = await db.query(
    `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = $1
     WHERE id = $2 AND user_id = $3 AND session_hash = $4 AND revoked_at IS NULL RETURNING id, user_id`,
    [reason, decoded.session_id, decoded.id, hashSessionToken(token)]
  );
  return result.rows[0] || null;
};

module.exports = {
  ABSOLUTE_SESSION_MS,
  IDLE_SESSION_MS,
  createUserSession,
  validateUserSession,
  revokeTokenSession
};
