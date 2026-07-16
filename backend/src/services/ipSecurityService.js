const net = require('net');
const db = require('../config/database');
const { recordAuditEvent } = require('./auditService');

const normalizeIp = (value) => {
  const candidate = String(value || '').trim();
  const normalized = candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
  return net.isIP(normalized) ? normalized.toLowerCase() : null;
};

const getLoginSecurityPolicy = async () => {
  const result = await db.query('SELECT * FROM login_security_policy WHERE id = 1');
  return result.rows[0];
};

const hasActiveAllowRule = async (ipAddress) => {
  const result = await db.query(
    `SELECT EXISTS(
       SELECT 1 FROM ip_security_rules
       WHERE ip_address = $1 AND rule_type = 'allow' AND is_active = TRUE
     ) AS allowed`,
    [ipAddress]
  );
  return result.rows[0]?.allowed === true;
};

const applyAutomaticBlockForLoginFailure = async (req) => {
  const ipAddress = normalizeIp(req?.ip);
  if (!ipAddress) return;

  try {
    const policy = await getLoginSecurityPolicy();
    if (!policy?.auto_block_enabled || await hasActiveAllowRule(ipAddress)) return;

    const failures = await db.query(
      `SELECT COUNT(*)::integer AS total
       FROM system_audit_events
       WHERE action = 'login_failed' AND ip_address = $1
         AND created_at >= CURRENT_TIMESTAMP - ($2::integer * INTERVAL '1 minute')`,
      [ipAddress, policy.observation_window_minutes]
    );
    if ((failures.rows[0]?.total || 0) < policy.failed_attempts_threshold) return;

    const expiresAt = new Date(Date.now() + policy.block_duration_minutes * 60000);
    const updated = await db.query(
      `UPDATE ip_security_rules
       SET expires_at = $2, reason = 'automatic_login_failures', updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM ip_security_rules
         WHERE ip_address = $1 AND rule_type = 'temporary_block' AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 1
       ) RETURNING id`,
      [ipAddress, expiresAt]
    );
    if (updated.rows.length === 0) {
      await db.query(
        `INSERT INTO ip_security_rules (ip_address, rule_type, reason, expires_at)
         VALUES ($1, 'temporary_block', 'automatic_login_failures', $2)`,
        [ipAddress, expiresAt]
      );
    }
    await recordAuditEvent({
      action: 'ip_blocked', status: 'success', req,
      metadata: {
        ip_address: ipAddress,
        reason: 'automatic_login_failures',
        threshold: policy.failed_attempts_threshold,
        observation_window_minutes: policy.observation_window_minutes,
        block_duration_minutes: policy.block_duration_minutes
      }
    });
  } catch (error) {
    console.error('Falha ao avaliar bloqueio automático de login:', error.message);
  }
};

module.exports = { normalizeIp, getLoginSecurityPolicy, hasActiveAllowRule, applyAutomaticBlockForLoginFailure };
