const db = require('../config/database');
const { recordAuditEvent } = require('../services/auditService');
const { normalizeIp, ruleTargetMatchesIp } = require('../services/ipSecurityService');

const ipSecurityMiddleware = async (req, res, next) => {
  const ipAddress = normalizeIp(req.ip);
  if (!ipAddress) return next();

  try {
    await db.query(
      `UPDATE ip_security_rules SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE rule_type = 'temporary_block' AND is_active = TRUE
         AND expires_at <= CURRENT_TIMESTAMP`,
      []
    );
    const result = await db.query(
      `SELECT id, ip_address, rule_target_type, rule_type, reason, expires_at
       FROM ip_security_rules
       WHERE is_active = TRUE
         AND (rule_type IN ('allow', 'block') OR (rule_type = 'temporary_block' AND expires_at > CURRENT_TIMESTAMP))
       ORDER BY CASE rule_type WHEN 'allow' THEN 0 WHEN 'block' THEN 1 ELSE 2 END, created_at DESC`
    );
    const rules = result.rows.filter((rule) => ruleTargetMatchesIp(rule.ip_address, ipAddress));
    if (rules.some((rule) => rule.rule_type === 'allow')) return next();
    const blockingRule = rules.find((rule) => rule.rule_type === 'block' || rule.rule_type === 'temporary_block');
    if (!blockingRule) return next();

    await recordAuditEvent({
      action: 'ip_access_blocked', status: 'denied', req,
      metadata: { ip_address: ipAddress, rule_target: blockingRule.ip_address, rule_target_type: blockingRule.rule_target_type || (blockingRule.ip_address.includes('/') ? 'cidr' : 'ip'), rule_type: blockingRule.rule_type, reason: blockingRule.reason || null, rule_id: blockingRule.id }
    });
    return res.status(403).json({ error: 'Acesso bloqueado.' });
  } catch (error) {
    return next(error);
  }
};

module.exports = { ipSecurityMiddleware };
