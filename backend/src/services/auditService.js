const db = require('../config/database');
const { safeLogError } = require('../utils/safeLogger');

const recordAuditEvent = async ({
  user,
  userEmail,
  action,
  status,
  req,
  metadata = {},
  queryable = db,
  throwOnError = false
}) => {
  try {
    await queryable.query(
      `INSERT INTO system_audit_events
         (user_id, user_email, action, status, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user?.id || null,
        user?.email || userEmail || null,
        action,
        status,
        req?.ip || null,
        String(req?.get?.('user-agent') || '').slice(0, 1000) || null,
        metadata
      ]
    );
  } catch (error) {
    safeLogError('Falha ao registrar evento de auditoria.', error);
    if (throwOnError) throw error;
  }
};

module.exports = { recordAuditEvent };
