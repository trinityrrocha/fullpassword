const db = require('../config/database');

const recordAuditEvent = async ({ user, action, status, req, metadata = {} }) => {
  try {
    await db.query(
      `INSERT INTO system_audit_events
         (user_id, user_email, action, status, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user?.id || null,
        user?.email || null,
        action,
        status,
        req?.ip || null,
        String(req?.get?.('user-agent') || '').slice(0, 1000) || null,
        metadata
      ]
    );
  } catch (error) {
    console.error('Falha ao registrar evento de auditoria:', error.message);
  }
};

module.exports = { recordAuditEvent };
