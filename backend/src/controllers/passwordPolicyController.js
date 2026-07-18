const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { getPasswordPolicy } = require('../services/passwordPolicyService');
const { recordAuditEvent } = require('../services/auditService');

const getPolicy = async (req, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Apenas o Super Admin pode consultar a política de senha' });
  return res.status(200).json(await getPasswordPolicy());
};

const updatePolicy = async (req, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Apenas o Super Admin pode alterar a política de senha' });
  const rawMonths = req.body?.password_change_notice_months;
  const months = rawMonths === null || rawMonths === '' ? null : Number(rawMonths);
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) {
    return res.status(400).json({ error: 'O período de aviso deve estar entre 1 e 120 meses, ou ficar desabilitado' });
  }
  const result = await db.query(
    `UPDATE password_policy_settings SET min_length = 12, require_uppercase = TRUE,
       require_lowercase = TRUE, require_number = TRUE, require_special = TRUE,
       block_common_passwords = TRUE, password_change_notice_months = $1,
       updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = 1 RETURNING *`,
    [months, req.user.id]
  );
  await recordAuditEvent({
    user: req.user, action: 'password_policy_updated', status: 'success', req,
    metadata: { password_change_notice_months: months }
  });
  return res.status(200).json(result.rows[0]);
};

module.exports = { getPolicy, updatePolicy };
