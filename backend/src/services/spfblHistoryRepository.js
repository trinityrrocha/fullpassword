const db = require('../config/database');

// SQL side of the stored history. Every read takes the caller's CURRENT domains, so rows of a domain the caller lost never come back. provider_key leaves this module only through `find`, which the
// server uses to act on a record; it is never part of a list or overview.
const BLOCKED = ['BANNED', 'FLAG', 'BLOCK', 'REJECT', 'INEXISTENT', 'GREYLIST'];
const CATEGORY_SQL = `CASE UPPER(result)
  WHEN 'BANNED' THEN 'banimento' WHEN 'FLAG' THEN 'banimento'
  WHEN 'BLOCK' THEN 'segurança' WHEN 'REJECT' THEN 'segurança'
  WHEN 'INEXISTENT' THEN 'inexistência' WHEN 'GREYLIST' THEN 'inexistência' END`;

const toRow = (r) => ({
  id: r.record_id, provider_key: r.provider_key, recipient: r.recipient, sender: r.sender, from: r.from_address, replyto: r.replyto,
  result: r.result, provider_status: r.provider_status, integration: r.integration_hash, timestamp: Math.floor(new Date(r.arrival_at).getTime() / 1000)
});

// Upsert page by page. Identity columns and the original result never change; only the provider status is refreshed.
const upsertRows = async (rows, integration, queryable = db) => {
  if (!rows.length) return 0;
  const col = (key) => rows.map((r) => r[key]);
  const result = await queryable.query(`INSERT INTO spfbl_history_records
      (record_id, integration_hash, domain, recipient, sender, from_address, replyto, result, provider_status, provider_key, arrival_at)
    SELECT t.id, $1, split_part(t.recipient, '@', 2), t.recipient, t.sender, t."from", t.replyto, t.result, t.status, t.key, to_timestamp(t.ts)
    FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::bigint[])
      AS t(id, recipient, sender, "from", replyto, result, status, key, ts)
    ON CONFLICT (record_id) DO UPDATE SET provider_status = EXCLUDED.provider_status, updated_at = CURRENT_TIMESTAMP
    WHERE spfbl_history_records.integration_hash = EXCLUDED.integration_hash`,
  [integration, col('id'), col('recipient'), col('sender'), col('from'), col('replyto'), col('result'), col('provider_status'), col('provider_key'), col('timestamp')]);
  return result.rowCount;
};

// Reads are by DOMAIN (the caller's current domains are the boundary), not by Matrix account: a domain keeps its history when it moves
// to another server or loses its server.
const filterClause = (domain, filters, unlockedIds = []) => {
  const params = [domain, filters.start_ts, filters.end_ts];
  const where = ['domain = $1', 'arrival_at >= to_timestamp($2)', 'arrival_at < to_timestamp($3)'];
  if (filters.status === 'Bloqueados') { params.push(BLOCKED); where.push(`UPPER(result) = ANY($${params.length}::text[])`); }
  else if (filters.status === 'Livres') { params.push(BLOCKED); where.push(`NOT (UPPER(result) = ANY($${params.length}::text[]))`); }
  else if (filters.status === 'Desbloqueados') { params.push([...unlockedIds]); where.push(`(record_id = ANY($${params.length}::text[]) OR provider_status = 'WHITELISTED')`); }
  if (filters.email) {
    params.push(String(filters.email).trim().toLowerCase());
    const fields = filters.by === 'recipient' ? ['recipient'] : ['sender', 'from_address', 'replyto'];
    where.push(`(${fields.map((f) => `lower(btrim(${f})) = $${params.length}`).join(' OR ')})`);
  }
  return { where: where.join(' AND '), params };
};

// One page (25) of one authorized domain, newest first, filtered and counted in SQL.
const selectPage = async ({ domain, filters, page = 1, pageSize = 20, unlockedIds = [] }, queryable = db) => {
  const { where, params } = filterClause(domain, filters, unlockedIds);
  const periodWhere = 'domain = $1 AND arrival_at >= to_timestamp($2) AND arrival_at < to_timestamp($3)';
  const period = Number((await queryable.query(`SELECT COUNT(*)::integer AS n FROM spfbl_history_records WHERE ${periodWhere}`, params.slice(0, 3))).rows[0].n);
  const filtered = Number((await queryable.query(`SELECT COUNT(*)::integer AS n FROM spfbl_history_records WHERE ${where}`, params)).rows[0].n);
  const pages = Math.max(1, Math.ceil(filtered / pageSize));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const rows = (await queryable.query(`SELECT * FROM spfbl_history_records WHERE ${where} ORDER BY arrival_at DESC, record_id LIMIT ${pageSize} OFFSET ${(current - 1) * pageSize}`, params)).rows;
  return { rows: rows.map(toRow), period, filtered, page: current, pages };
};

const find = async (id, domain, queryable = db) => {
  const row = (await queryable.query('SELECT * FROM spfbl_history_records WHERE record_id = $1 AND domain = $2', [id, domain])).rows[0];
  return row ? toRow(row) : null;
};

const setProviderStatus = (id, status, queryable = db) => queryable.query(
  'UPDATE spfbl_history_records SET provider_status = $2, updated_at = CURRENT_TIMESTAMP WHERE record_id = $1', [id, status]);

// Dashboard numbers over a window, for the given domains only.
const overview = async ({ domains, startTs, endTs }, queryable = db) => {
  const base = [domains, startTs, endTs];
  const where = 'domain = ANY($1::text[]) AND arrival_at >= to_timestamp($2) AND arrival_at < to_timestamp($3)';
  const total = Number((await queryable.query(`SELECT COUNT(*)::integer AS n FROM spfbl_history_records WHERE ${where}`, base)).rows[0].n);
  const byCategory = (await queryable.query(`SELECT ${CATEGORY_SQL} AS category, COUNT(*)::integer AS n FROM spfbl_history_records WHERE ${where} AND UPPER(result) = ANY($4::text[]) GROUP BY 1`, [...base, BLOCKED])).rows;
  const byDomain = (await queryable.query(`SELECT domain AS name, COUNT(*)::integer AS count FROM spfbl_history_records WHERE ${where} AND UPPER(result) = ANY($4::text[]) GROUP BY domain ORDER BY count DESC, domain LIMIT 10`, [...base, BLOCKED])).rows;
  const byRecipient = (await queryable.query(`SELECT recipient AS name, COUNT(*)::integer AS count FROM spfbl_history_records WHERE ${where} AND UPPER(result) = ANY($4::text[]) GROUP BY recipient ORDER BY count DESC, recipient LIMIT 10`, [...base, BLOCKED])).rows;
  const categories = { banimento: 0, 'segurança': 0, 'inexistência': 0 };
  for (const r of byCategory) if (r.category) categories[r.category] = r.n;
  return { categories, domains: byDomain, recipients: byRecipient, total, blocked: Object.values(categories).reduce((a, b) => a + b, 0) };
};

// Per-domain counts for the Super Admin table (every registered domain is added by the caller, zero-filled).
const domainCounts = async ({ domains, startTs, endTs }, queryable = db) => {
  const rows = (await queryable.query(`SELECT domain, COUNT(*)::integer AS total, COUNT(*) FILTER (WHERE UPPER(result) = ANY($4::text[]))::integer AS blocked,
      COUNT(*) FILTER (WHERE UPPER(result) IN ('BANNED','FLAG'))::integer AS banimento, COUNT(*) FILTER (WHERE UPPER(result) IN ('BLOCK','REJECT'))::integer AS seguranca,
      COUNT(*) FILTER (WHERE UPPER(result) IN ('INEXISTENT','GREYLIST'))::integer AS inexistencia
    FROM spfbl_history_records WHERE domain = ANY($1::text[]) AND arrival_at >= to_timestamp($2) AND arrival_at < to_timestamp($3) GROUP BY domain`,
  [domains, startTs, endTs, BLOCKED])).rows;
  return new Map(rows.map((r) => [r.domain, r]));
};

const prune = async (retentionDays, queryable = db) => (await queryable.query(
  "DELETE FROM spfbl_history_records WHERE arrival_at < CURRENT_TIMESTAMP - ($1::integer * INTERVAL '1 day')", [retentionDays])).rowCount;
// A server changed its Matrix account: the rows collected with the old account are stale.
const purgeIntegration = async (integration, queryable = db) => (await queryable.query(
  'DELETE FROM spfbl_history_records WHERE integration_hash = $1', [integration])).rowCount;
// New credentials: forget failed runs (so the next screen retries at once) and any run of another account.
const resetRuns = async (integration, queryable = db) => (await queryable.query(
  "DELETE FROM spfbl_history_runs WHERE status = 'failed' AND integration_hash = $1", [integration])).rowCount;
const stats = async (integration = null, queryable = db) => {
  const r = (await queryable.query('SELECT COUNT(*)::integer AS n, MIN(arrival_at) AS oldest, MAX(arrival_at) AS newest FROM spfbl_history_records WHERE ($1::text IS NULL OR integration_hash = $1)', [integration])).rows[0];
  return { rows: Number(r.n), oldest_at: r.oldest, newest_at: r.newest };
};

module.exports = { BLOCKED, upsertRows, selectPage, find, setProviderStatus, overview, domainCounts, prune, purgeIntegration, resetRuns, stats };
