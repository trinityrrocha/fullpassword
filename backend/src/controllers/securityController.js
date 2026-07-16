const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const { normalizeIp, getLoginSecurityPolicy, hasActiveAllowRule } = require('../services/ipSecurityService');

const THRESHOLDS = new Set([5, 10, 15]);
const WINDOWS = new Set([10, 15, 30, 60]);
const DURATIONS = new Set([10, 15, 30, 60, 120, 240, 360, 720, 1440]);
const RULE_TYPES = new Set(['block', 'allow', 'temporary_block']);
const deny = (res) => res.status(403).json({ error: 'Acesso restrito ao Super Admin.' });

const requireSuperAdmin = (req, res) => isSuperAdmin(req.user) || (deny(res), false);
const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getPolicy = async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  return res.json({ policy: await getLoginSecurityPolicy() });
};

const updatePolicy = async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const next = {
    auto_block_enabled: req.body?.auto_block_enabled,
    failed_attempts_threshold: Number(req.body?.failed_attempts_threshold),
    observation_window_minutes: Number(req.body?.observation_window_minutes),
    block_duration_minutes: Number(req.body?.block_duration_minutes)
  };
  if (typeof next.auto_block_enabled !== 'boolean' || !THRESHOLDS.has(next.failed_attempts_threshold) || !WINDOWS.has(next.observation_window_minutes) || !DURATIONS.has(next.block_duration_minutes)) {
    return res.status(400).json({ error: 'Valores de política inválidos.' });
  }
  const previous = await getLoginSecurityPolicy();
  const result = await db.query(
    `UPDATE login_security_policy SET auto_block_enabled = $1, failed_attempts_threshold = $2,
       observation_window_minutes = $3, block_duration_minutes = $4, updated_by = $5,
       updated_by_email = $6, updated_at = CURRENT_TIMESTAMP WHERE id = 1 RETURNING *`,
    [next.auto_block_enabled, next.failed_attempts_threshold, next.observation_window_minutes, next.block_duration_minutes, req.user.id, req.user.email]
  );
  await recordAuditEvent({ user: req.user, action: 'login_security_policy_updated', status: 'success', req, metadata: { previous, next } });
  return res.json({ policy: result.rows[0] });
};

const getLoginFailures = async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const values = [];
  const conditions = ["action = 'login_failed'", 'ip_address IS NOT NULL'];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
  const ip = String(req.query.ip || '').trim();
  const email = String(req.query.user_email || '').trim();
  const from = parseDate(String(req.query.date_from || '').trim());
  const to = parseDate(String(req.query.date_to || '').trim(), true);
  if ((req.query.date_from && !from) || (req.query.date_to && !to) || (from && to && from > to)) return res.status(400).json({ error: 'Filtro de data inválido.' });
  if (ip) add('ip_address ILIKE ?', `%${ip}%`);
  if (email) add("COALESCE(metadata->>'email_attempted', user_email, '') ILIKE ?", `%${email}%`);
  if (from) add('created_at >= ?', from.toISOString());
  if (to) add('created_at <= ?', to.toISOString());
  const where = `WHERE ${conditions.join(' AND ')}`;
  const count = await db.query(`SELECT COUNT(DISTINCT ip_address)::integer AS total FROM system_audit_events ${where}`, values);
  const result = await db.query(
    `SELECT events.ip_address,
            (ARRAY_AGG(COALESCE(events.metadata->>'country', '-') ORDER BY events.created_at DESC))[1] AS country,
            (ARRAY_AGG(COALESCE(events.metadata->>'email_attempted', events.user_email) ORDER BY events.created_at DESC))[1] AS latest_email_attempted,
            MIN(events.created_at) AS first_attempt_at, MAX(events.created_at) AS last_attempt_at,
            COUNT(*)::integer AS attempt_count,
            CASE
              WHEN EXISTS (SELECT 1 FROM ip_security_rules r WHERE r.ip_address = events.ip_address AND r.rule_type = 'allow' AND r.is_active) THEN 'whitelisted'
              WHEN EXISTS (SELECT 1 FROM ip_security_rules r WHERE r.ip_address = events.ip_address AND r.rule_type = 'block' AND r.is_active) THEN 'permanently_blocked'
              WHEN EXISTS (SELECT 1 FROM ip_security_rules r WHERE r.ip_address = events.ip_address AND r.rule_type = 'temporary_block' AND r.is_active AND r.expires_at > CURRENT_TIMESTAMP) THEN 'temporary_blocked'
              ELSE 'normal' END AS status
     FROM system_audit_events events
     ${where.replaceAll('action', 'events.action').replaceAll('ip_address', 'events.ip_address').replaceAll('metadata', 'events.metadata').replaceAll('user_email', 'events.user_email').replaceAll('created_at', 'events.created_at')}
     GROUP BY events.ip_address ORDER BY MAX(events.created_at) DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, (page - 1) * limit]
  );
  const total = count.rows[0]?.total || 0;
  return res.json({ items: result.rows, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } });
};

const createRuleRecord = async ({ req, ipAddress, ruleType, reason, durationMinutes }) => {
  if (ruleType !== 'allow' && normalizeIp(req.ip) === ipAddress) throw Object.assign(new Error('O IP atual do Super Admin não pode ser bloqueado.'), { status: 400 });
  if (ruleType !== 'allow' && await hasActiveAllowRule(ipAddress)) throw Object.assign(new Error('Whitelist ativa prevalece; remova-a antes de bloquear.'), { status: 409 });
  if (ruleType === 'temporary_block' && !DURATIONS.has(durationMinutes)) throw Object.assign(new Error('Duração inválida.'), { status: 400 });
  const expiresAt = ruleType === 'temporary_block' ? new Date(Date.now() + durationMinutes * 60000) : null;
  const result = await db.query(
    `INSERT INTO ip_security_rules (ip_address, rule_type, reason, expires_at, created_by, created_by_email)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [ipAddress, ruleType, reason || null, expiresAt, req.user.id, req.user.email]
  );
  await recordAuditEvent({ user: req.user, action: ruleType === 'allow' ? 'ip_whitelisted' : 'ip_blocked', status: 'success', req, metadata: { ip_address: ipAddress, rule_type: ruleType, rule_id: result.rows[0].id } });
  return result.rows[0];
};

const createIpRule = async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const ipAddress = normalizeIp(req.body?.ip_address);
  const ruleType = String(req.body?.rule_type || '');
  if (!ipAddress || !RULE_TYPES.has(ruleType)) return res.status(400).json({ error: 'IP ou tipo de regra inválido.' });
  try {
    return res.status(201).json({ rule: await createRuleRecord({ req, ipAddress, ruleType, reason: String(req.body?.reason || '').slice(0, 500), durationMinutes: Number(req.body?.duration_minutes) }) });
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'ip_block_denied', status: 'denied', req, metadata: { ip_address: ipAddress, rule_type: ruleType } });
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível criar a regra.' });
  }
};

const listIpRules = async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const values = [];
  const conditions = [];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
  if (req.query.ip_address) add('ip_address ILIKE ?', `%${String(req.query.ip_address).slice(0, 100)}%`);
  if (req.query.rule_type) {
    if (!RULE_TYPES.has(req.query.rule_type)) return res.status(400).json({ error: 'Tipo de regra inválido.' });
    add('rule_type = ?', req.query.rule_type);
  }
  if (req.query.is_active !== undefined) add('is_active = ?', req.query.is_active === 'true');
  const result = await db.query(`SELECT * FROM ip_security_rules ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`, values);
  return res.json({ rules: result.rows });
};

const deactivateIpRule = async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const result = await db.query('UPDATE ip_security_rules SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = TRUE RETURNING *', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Regra ativa não encontrada.' });
  const rule = result.rows[0];
  await recordAuditEvent({ user: req.user, action: rule.rule_type === 'allow' ? 'ip_whitelist_removed' : 'ip_unblocked', status: 'success', req, metadata: { ip_address: rule.ip_address, rule_type: rule.rule_type, rule_id: rule.id } });
  return res.json({ rule });
};

const blockFromAudit = async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const event = await db.query('SELECT ip_address FROM system_audit_events WHERE id = $1', [req.body?.audit_event_id]);
  const ipAddress = normalizeIp(event.rows[0]?.ip_address);
  const ruleType = String(req.body?.rule_type || '');
  if (!ipAddress || !new Set(['block', 'temporary_block']).has(ruleType)) return res.status(400).json({ error: 'Evento ou tipo de regra inválido.' });
  try {
    return res.status(201).json({ rule: await createRuleRecord({ req, ipAddress, ruleType, reason: String(req.body?.reason || '').slice(0, 500), durationMinutes: Number(req.body?.duration_minutes) }) });
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'ip_block_denied', status: 'denied', req, metadata: { ip_address: ipAddress, rule_type: ruleType } });
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível criar a regra.' });
  }
};

module.exports = { getPolicy, updatePolicy, getLoginFailures, createIpRule, listIpRules, deactivateIpRule, blockFromAudit };
