const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');

const sessionFields = `s.id, s.user_id, u.email, u.name, s.token_version, u.token_version AS current_token_version,
  s.ip_address, s.browser, s.os, s.device,
  s.created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.revoked_at, s.revoke_reason`;

const serializeSessions = (rows, currentSessionId) => rows.map((row) => ({
  ...row,
  is_current: row.id === currentSessionId,
  status: row.revoked_at || row.token_version !== row.current_token_version
    ? 'revoked'
    : new Date(row.expires_at) <= new Date() || new Date(row.idle_expires_at) <= new Date() ? 'expired' : 'active'
}));

const listOwnSessions = async (req, res) => {
  const result = await db.query(
    `SELECT ${sessionFields} FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  return res.status(200).json(serializeSessions(result.rows, req.user.session_id));
};

const revokeOwnSession = async (req, res) => {
  const result = await db.query(
    `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $1, revoke_reason = 'revoked_by_user'
     WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL RETURNING id`,
    [req.user.id, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Sessão ativa não encontrada' });
  const isCurrent = req.params.id === req.user.session_id;
  await recordAuditEvent({
    user: req.user, action: 'session_revoked', status: 'success', req,
    metadata: { current_session: isCurrent }
  });
  return res.status(200).json({ message: 'Sessão encerrada', current_session_revoked: isCurrent });
};

const revokeOtherSessions = async (req, res) => {
  const result = await db.query(
    `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $1, revoke_reason = 'all_other_sessions_revoked'
     WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id`,
    [req.user.id, req.user.session_id]
  );
  await recordAuditEvent({
    user: req.user, action: 'all_other_sessions_revoked', status: 'success', req,
    metadata: { revoked_count: result.rowCount }
  });
  return res.status(200).json({ message: 'Outras sessões encerradas', revoked_count: result.rowCount });
};

const listAllSessions = async (req, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Apenas o Super Admin pode listar todas as sessões' });
  const result = await db.query(
    `SELECT ${sessionFields} FROM user_sessions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 1000`
  );
  return res.status(200).json(serializeSessions(result.rows, req.user.session_id));
};

const revokeSessionByAdmin = async (req, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Apenas o Super Admin pode encerrar sessões de terceiros' });
  const result = await db.query(
    `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $1, revoke_reason = 'revoked_by_admin'
     WHERE id = $2 AND revoked_at IS NULL RETURNING user_id`,
    [req.user.id, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Sessão ativa não encontrada' });
  const isCurrent = req.params.id === req.user.session_id;
  await recordAuditEvent({
    user: req.user, action: 'session_revoked_by_admin', status: 'success', req,
    metadata: { target_user_id: result.rows[0].user_id, current_session: isCurrent }
  });
  return res.status(200).json({ message: 'Sessão encerrada', current_session_revoked: isCurrent });
};

module.exports = { listOwnSessions, revokeOwnSession, revokeOtherSessions, listAllSessions, revokeSessionByAdmin };
