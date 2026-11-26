const db = require('../config/database');
const { isModuleEnabled } = require('./modulesService');
const { NOTIFICATION_ACTIONS, NOTIFICATION_STATUSES, formatSecurityNotification } = require('../controllers/securityController');
const { safeLogError } = require('../utils/safeLogger');

// The cards the dashboard can show, in their default order. The ids are the only values a saved layout may contain.
const CARD_IDS = Object.freeze(['domains_health', 'domain_expirations', 'security_alerts', 'unlock_requests', 'spam_senders', 'login_activity', 'recent_logins', 'last_backup']);
const SP = "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date";
const iso = (value) => (value instanceof Date ? value.toISOString() : value || null);
const day = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null);

// A layout is {order, hidden}. Anything unknown is dropped, a repeated id counts once and a card the layout does not know about yet (added by
// an update) is appended, so a new card is never silently missing.
const normalizeLayout = (input) => {
  const known = new Set(CARD_IDS);
  const order = [];
  for (const id of Array.isArray(input?.order) ? input.order : []) if (known.has(id) && !order.includes(id)) order.push(id);
  for (const id of CARD_IDS) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set((Array.isArray(input?.hidden) ? input.hidden : []).filter((id) => known.has(id)))];
  return { order, hidden };
};
const validLayout = (input) => Boolean(input) && typeof input === 'object' && !Array.isArray(input)
  && Array.isArray(input.order) && Array.isArray(input.hidden) && input.order.length <= CARD_IDS.length && input.hidden.length <= CARD_IDS.length
  && [...input.order, ...input.hidden].every((id) => typeof id === 'string' && CARD_IDS.includes(id));

const createService = ({ queryable = db } = {}) => {
  const getLayout = async (userId) => {
    const row = (await queryable.query('SELECT layout FROM user_dashboard_layouts WHERE user_id = $1', [userId])).rows[0];
    return normalizeLayout(row?.layout);
  };
  const saveLayout = async (userId, input) => {
    if (!validLayout(input)) return null;
    const layout = normalizeLayout(input);
    await queryable.query(
      `INSERT INTO user_dashboard_layouts (user_id, layout) VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = CURRENT_TIMESTAMP`, [userId, JSON.stringify(layout)]);
    return layout;
  };
  const resetLayout = async (userId) => { await queryable.query('DELETE FROM user_dashboard_layouts WHERE user_id = $1', [userId]); return normalizeLayout(null); };

  // ---------- cards: each returns plain data, never a row with secrets ----------
  const domainsHealth = async () => {
    const totals = (await queryable.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE s.expires_on < ${SP})::int AS expired,
              count(*) FILTER (WHERE s.expires_on >= ${SP} AND s.expires_on <= ${SP} + 30)::int AS expiring,
              count(*) FILTER (WHERE s.domain_id IS NULL)::int AS waiting,
              count(*) FILTER (WHERE s.ssl_state IN ('expired', 'invalid'))::int AS ssl_problem,
              count(*) FILTER (WHERE (s.expires_on IS NULL OR s.expires_on > ${SP} + 30) AND mc.spf_status = 'ok' AND mc.dmarc_status = 'ok' AND mc.dkim_status = 'ok')::int AS healthy
         FROM dm_domains d LEFT JOIN dm_snapshots s ON s.domain_id = d.id LEFT JOIN dm_mail_checks mc ON mc.domain_id = d.id WHERE d.active`)).rows[0];
    const mail = {};
    for (const kind of ['spf', 'dkim', 'dmarc']) {
      const rows = (await queryable.query(`SELECT ${kind}_status AS status, count(*)::int AS n FROM dm_mail_checks mc JOIN dm_domains d ON d.id = mc.domain_id WHERE d.active GROUP BY 1`)).rows;
      mail[kind] = Object.fromEntries(rows.map((row) => [row.status, row.n]));
    }
    return { ...totals, mail };
  };

  const domainExpirations = async () => {
    const rows = (await queryable.query(
      `SELECT d.name, s.expires_on, (s.expires_on - ${SP})::int AS days_left
         FROM dm_domains d JOIN dm_snapshots s ON s.domain_id = d.id WHERE d.active AND s.expires_on IS NOT NULL
         ORDER BY s.expires_on ASC, d.name ASC LIMIT 8`)).rows;
    return { items: rows.map((row) => ({ name: row.name, expires_on: day(row.expires_on), days_left: row.days_left })) };
  };

  const securityAlerts = async () => {
    const result = await queryable.query(
      `SELECT id, action, status, user_email, ip_address, metadata, created_at, (COUNT(*) OVER())::int AS total
         FROM system_audit_events
        WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days' AND (status = ANY($1::text[]) OR action = ANY($2::text[]))
        ORDER BY created_at DESC LIMIT 6`, [NOTIFICATION_STATUSES, NOTIFICATION_ACTIONS]);
    return { total: Number(result.rows[0]?.total || 0), window_days: 7, items: result.rows.map(formatSecurityNotification) };
  };

  const unlockRequests = async () => {
    const summary = (await queryable.query(
      `SELECT count(*)::int AS pending, min(requested_at) AS oldest FROM spfbl_requests WHERE status IN ('pending', 'reopened')`)).rows[0];
    const rows = (await queryable.query(
      `SELECT domain, sender, requested_at, status FROM spfbl_requests WHERE status IN ('pending', 'reopened') ORDER BY requested_at ASC LIMIT 5`)).rows;
    return { pending: summary.pending, oldest_at: iso(summary.oldest), items: rows.map((row) => ({ domain: row.domain, sender: row.sender, requested_at: iso(row.requested_at), reopened: row.status === 'reopened' })) };
  };

  // Senders with the most blocked messages in the collected history. SPFBL does not report where a sender is located, so no country is shown.
  const spamSenders = async () => {
    const rows = (await queryable.query(
      `SELECT lower(split_part(COALESCE(NULLIF(sender, ''), from_address), '@', 2)) AS sender_domain, count(*)::int AS blocked,
              min(arrival_at) AS first_at, max(arrival_at) AS last_at, count(DISTINCT domain)::int AS targets
         FROM spfbl_history_records
        WHERE provider_status = 'BLOCKED' AND arrival_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
          AND split_part(COALESCE(NULLIF(sender, ''), from_address), '@', 2) <> ''
        GROUP BY 1 ORDER BY blocked DESC, last_at DESC LIMIT 8`)).rows;
    return { window_days: 30, items: rows.map((row) => ({ sender_domain: row.sender_domain, blocked: row.blocked, targets: row.targets, first_at: iso(row.first_at), last_at: iso(row.last_at) })) };
  };

  const loginActivity = async () => {
    const row = (await queryable.query(
      `SELECT count(*) FILTER (WHERE action = 'login_failed')::int AS failed,
              count(DISTINCT ip_address) FILTER (WHERE action = 'login_failed')::int AS failed_ips,
              count(*) FILTER (WHERE action = 'login_success')::int AS success,
              count(*) FILTER (WHERE action = 'ip_blocked')::int AS auto_blocks
         FROM system_audit_events WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AND action IN ('login_failed', 'login_success', 'ip_blocked')`)).rows[0];
    const active = (await queryable.query(
      `SELECT count(*)::int AS n FROM ip_security_rules WHERE is_active AND rule_type IN ('block', 'temporary_block') AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`)).rows[0].n;
    return { window_hours: 24, ...row, active_blocks: active };
  };

  const recentLogins = async () => {
    const rows = (await queryable.query(
      `SELECT user_email, ip_address, created_at FROM system_audit_events WHERE action = 'login_success' ORDER BY created_at DESC LIMIT 8`)).rows;
    return { items: rows.map((row) => ({ user_email: row.user_email || '', ip_address: row.ip_address || '', created_at: iso(row.created_at) })) };
  };

  const lastBackup = async () => {
    const runs = [];
    for (const [table, provider] of [['cloud_backup_runs', 'provider'], ['google_drive_backup_runs', "'google_drive'"]]) {
      const rows = (await queryable.query(
        `SELECT ${provider} AS provider, status, trigger_type, size_bytes, finished_at, started_at FROM ${table}
          WHERE status IN ('success', 'failed') ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 5`)).rows;
      runs.push(...rows);
    }
    const stamp = (run) => new Date(run.finished_at || run.started_at).getTime();
    runs.sort((a, b) => stamp(b) - stamp(a));
    const lastRun = runs[0] || null;
    const lastSuccess = runs.find((run) => run.status === 'success') || null;
    const shape = (run) => run && { provider: run.provider, status: run.status, trigger: run.trigger_type, size_bytes: run.size_bytes === null ? null : Number(run.size_bytes), at: iso(run.finished_at || run.started_at) };
    return { last_success: shape(lastSuccess), last_run: shape(lastRun) };
  };

  // A card whose module is off is "unavailable", not an error; a card that fails is reported on its own and never takes the others down.
  const overview = async () => {
    const [domainManager, spfbl] = await Promise.all([isModuleEnabled('domain_manager', queryable).catch(() => false), isModuleEnabled('spfbl', queryable).catch(() => false)]);
    const plan = {
      domains_health: [domainManager, domainsHealth], domain_expirations: [domainManager, domainExpirations], security_alerts: [true, securityAlerts],
      unlock_requests: [spfbl, unlockRequests], spam_senders: [spfbl, spamSenders], login_activity: [true, loginActivity], recent_logins: [true, recentLogins], last_backup: [true, lastBackup]
    };
    const cards = {};
    await Promise.all(Object.entries(plan).map(async ([id, [available, load]]) => {
      if (!available) { cards[id] = { available: false }; return; }
      try { cards[id] = { available: true, data: await load() }; } catch (error) {
        safeLogError('Falha ao montar um cartão do dashboard.', { card: id, name: error?.name, code: error?.code }, { includeStack: false });
        cards[id] = { available: true, error: true };
      }
    }));
    return cards;
  };

  return { getLayout, saveLayout, resetLayout, overview };
};

let shared = null;
const getService = () => { shared = shared || createService(); return shared; };

module.exports = { createService, getService, CARD_IDS, normalizeLayout, validLayout };
