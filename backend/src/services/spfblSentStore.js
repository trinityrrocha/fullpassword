const crypto = require('node:crypto');
const db = require('../config/database');

// SQL side of the stored sent-mail history. A row is one log line of the WHM server (one attempt for one recipient). The key is a hash of
// the message id, recipient, attempt time and type, so a line read twice (the collection overlaps on purpose) is stored once.
const keyOf = (record) => crypto.createHash('sha256').update(record.id).digest('hex');

const upsert = async (serverId, records, queryable = db) => {
  let stored = 0;
  for (let from = 0; from < records.length; from += 500) {
    const slice = records.slice(from, from + 500);
    const col = (pick) => slice.map(pick);
    const result = await queryable.query(
      `INSERT INTO spfbl_sent_records (server_id, record_key, event_type, sent_at, action_at, sender_domain, sender, recipient, delivered_to, detail)
       SELECT $1, t.key, t.type, to_timestamp(t.sent), to_timestamp(t.action), t.domain, t.sender, t.recipient, t.delivered, t.detail::jsonb
         FROM unnest($2::text[], $3::text[], $4::bigint[], $5::bigint[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
           AS t(key, type, sent, action, domain, sender, recipient, delivered, detail)
       ON CONFLICT (server_id, record_key) DO UPDATE SET detail = EXCLUDED.detail, collected_at = CURRENT_TIMESTAMP`,
      [serverId, col(keyOf), col((r) => r.type), col((r) => r.sent_unix), col((r) => r.action_unix), col((r) => r.sender_domain), col((r) => r.sender), col((r) => r.recipient), col((r) => r.delivered_to), col((r) => JSON.stringify(r.detail || {}))]);
    stored += result.rowCount;
  }
  return stored;
};

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

// Reads one page. `domains` is null for "everything the servers hold" (Super Admin), else the domains the caller may see. A record counts in
// the period when it was sent or last attempted inside it.
const search = async ({ serverIds = null, domains = null, sinceUnix, types = null, q = '', by = 'any', page = 1, pageSize = 20 }, queryable = db) => {
  const params = [sinceUnix];
  const base = ['(r.sent_at >= to_timestamp($1) OR r.action_at >= to_timestamp($1))'];
  if (serverIds) { params.push(serverIds); base.push(`r.server_id = ANY($${params.length}::uuid[])`); }
  if (domains) { params.push(domains); base.push(`r.sender_domain = ANY($${params.length}::text[])`); }
  const filtered = [...base];
  if (types) { params.push(types); filtered.push(`r.event_type = ANY($${params.length}::text[])`); }
  if (q) {
    params.push(escapeLike(q));
    const like = `$${params.length}`;
    const sender = `lower(r.sender) LIKE '%' || ${like} || '%' ESCAPE '\\'`;
    const recipient = `lower(r.recipient) LIKE '%' || ${like} || '%' ESCAPE '\\'`;
    filtered.push(by === 'sender' ? sender : by === 'recipient' ? recipient : `(${sender} OR ${recipient})`);
  }
  const counts = (await queryable.query(`SELECT (SELECT count(*) FROM spfbl_sent_records r WHERE ${base.join(' AND ')})::int AS period,
    (SELECT count(*) FROM spfbl_sent_records r WHERE ${filtered.join(' AND ')})::int AS filtered`, params)).rows[0];
  const pages = Math.max(1, Math.ceil(counts.filtered / pageSize));
  const current = Math.min(pages, Math.max(1, page));
  const rows = (await queryable.query(
    `SELECT r.record_key, r.event_type, r.sent_at, r.action_at, r.sender_domain, r.sender, r.recipient, r.delivered_to, r.detail, s.name AS server_name
       FROM spfbl_sent_records r JOIN spfbl_whm_servers s ON s.id = r.server_id WHERE ${filtered.join(' AND ')}
      ORDER BY r.sent_at DESC, r.record_key DESC LIMIT ${Number(pageSize)} OFFSET ${(current - 1) * pageSize}`, params)).rows;
  return { rows, period: counts.period, filtered: counts.filtered, page: current, pages };
};

// Retention: rows older than the configured days are removed.
const prune = async (retentionDays, queryable = db) => (await queryable.query(
  "DELETE FROM spfbl_sent_records WHERE sent_at < CURRENT_TIMESTAMP - ($1::integer * INTERVAL '1 day')", [retentionDays])).rowCount;
const count = async (queryable = db) => Number((await queryable.query('SELECT count(*)::int AS n FROM spfbl_sent_records')).rows[0].n);

// Where the collection of a server stands: everything up to "through" has been stored.
const getState = async (serverId, queryable = db) => {
  const row = (await queryable.query('SELECT sent_collected_through, sent_last_run_at FROM spfbl_whm_servers WHERE id = $1', [serverId])).rows[0];
  return { through: row?.sent_collected_through ? Math.floor(new Date(row.sent_collected_through).getTime() / 1000) : null, lastRunAt: row?.sent_last_run_at ? new Date(row.sent_last_run_at).toISOString() : null };
};
const markCollected = async (serverId, throughUnix, queryable = db) => queryable.query(
  'UPDATE spfbl_whm_servers SET sent_collected_through = to_timestamp($2), sent_last_run_at = CURRENT_TIMESTAMP WHERE id = $1', [serverId, throughUnix]);

module.exports = { keyOf, upsert, search, prune, count, getState, markCollected };
