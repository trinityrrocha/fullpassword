const db = require('../config/database');
const { getWhmCredentials, listServers } = require('./spfblServersService');
const { WhmClient, MAX_DOMAINS } = require('./spfblWhmClient');

const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNC_LOCK_KEY = 8142031;

class DomainError extends Error {
  constructor(message, code = 'SPFBL_DOMAIN_INVALID', statusCode = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Indirection so tests can inject a simulated transport; production always uses the hardened client.
const internals = { createClient: (credentials) => new WhmClient(credentials) };

const normalizeDomainName = (value) => {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!DOMAIN_PATTERN.test(name)) throw new DomainError('Informe um domínio completo, sem @ ou https://. Para IDN, use Punycode.');
  return name;
};

// "no_server": imported from a WHM server that no longer exists (or was removed without its domains): history only, no Matrix actions.
const listDomains = async (queryable = db) => (await queryable.query(
  `SELECT d.id, d.name, d.source, d.cpanel_user, d.suspended, d.active, d.last_seen_at, d.created_at, d.server_id, s.name AS server_name,
          (d.source = 'whm' AND d.server_id IS NULL) AS no_server
     FROM spfbl_domains d LEFT JOIN spfbl_whm_servers s ON s.id = d.server_id ORDER BY d.name`
)).rows;

const addManualDomain = async (value, createdBy) => {
  const name = normalizeDomainName(value);
  const count = (await db.query('SELECT count(*)::int AS n FROM spfbl_domains')).rows[0].n;
  if (count >= MAX_DOMAINS) throw new DomainError('O catálogo atingiu o limite de domínios.', 'SPFBL_DOMAIN_LIMIT', 422);
  const result = await db.query(
    `INSERT INTO spfbl_domains (name, source, active, created_by) VALUES ($1, 'manual', TRUE, $2)
     ON CONFLICT (name) DO NOTHING RETURNING id, name, source, cpanel_user, suspended, active, last_seen_at, created_at`,
    [name, createdBy]
  );
  if (!result.rows[0]) throw new DomainError('Este domínio já está cadastrado.', 'SPFBL_DOMAIN_EXISTS', 409);
  return result.rows[0];
};

const removeDomain = async (id) => {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) throw new DomainError('Domínio não encontrado.', 'SPFBL_DOMAIN_NOT_FOUND', 404);
  const row = (await db.query('SELECT id, name, source FROM spfbl_domains WHERE id = $1', [id])).rows[0];
  if (!row) throw new DomainError('Domínio não encontrado.', 'SPFBL_DOMAIN_NOT_FOUND', 404);
  const orphan = (await db.query("SELECT 1 FROM spfbl_domains WHERE id = $1 AND source = 'whm' AND server_id IS NULL", [id])).rowCount > 0;
  if (row.source !== 'manual' && !orphan) {
    throw new DomainError('Domínios importados do WHM não são removidos à mão: ficam inativos quando saem do servidor.', 'SPFBL_DOMAIN_IMPORTED', 409);
  }
  await db.query('DELETE FROM spfbl_domains WHERE id = $1', [id]);
  return { id: row.id, name: row.name };
};

const summarize = (listing) => ({
  accounts: listing.accounts,
  domains: listing.domains.length,
  active: listing.domains.filter((domain) => !domain.suspended).length,
  suspended: listing.domains.filter((domain) => domain.suspended).length,
  skipped: listing.skipped
});

// Connection test: reads from WHM and writes nothing.
const testWhm = async (serverId) => summarize(await internals.createClient(await getWhmCredentials(serverId)).listDomains());

// Validation of credentials typed in the form: reads from WHM, writes nothing, stores nothing.
const validateWhmCredentials = async (credentials) => summarize(await internals.createClient(credentials).listDomains());

const recordSyncStatus = async (serverId, status) => {
  await db.query('UPDATE spfbl_whm_servers SET sync_at = CURRENT_TIMESTAMP, sync_status = $2 WHERE id = $1', [serverId, status]).catch(() => {});
};

// Imports the domains of non-suspended accounts of ONE server. Nothing is touched unless the whole listing succeeded, and an empty
// listing never deactivates anything (a token without the right permissions can look exactly like that). Only the domains that
// belong to this server are ever deactivated: another server's domains, manual ones and orphans are left alone.
const syncFromWhm = async (actorId, serverId) => {
  let listing;
  try {
    listing = await internals.createClient(await getWhmCredentials(serverId)).listDomains();
  } catch (error) {
    await recordSyncStatus(serverId, `failed:${String(error?.code || 'internal_error').slice(0, 40)}`);
    throw error;
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [SYNC_LOCK_KEY])).rows[0].locked) {
      throw new DomainError('Já há uma sincronização em andamento.', 'SPFBL_SYNC_BUSY', 409);
    }
    const startedAt = (await client.query('SELECT CURRENT_TIMESTAMP AS now')).rows[0].now;
    const existingImported = (await client.query("SELECT count(*)::int AS n FROM spfbl_domains WHERE source = 'whm' AND server_id = $1", [serverId])).rows[0].n;
    if (listing.domains.length === 0 && existingImported > 0) {
      throw new DomainError('O WHM não retornou domínios; nada foi alterado. Confira as permissões do token.', 'SPFBL_SYNC_EMPTY', 409);
    }
    let added = 0;
    let updated = 0;
    if (listing.domains.length > 0) {
      const names = listing.domains.map((domain) => domain.name);
      const users = listing.domains.map((domain) => domain.cpanel_user);
      const suspended = listing.domains.map((domain) => domain.suspended);
      const upsert = await client.query(
        `INSERT INTO spfbl_domains (name, source, cpanel_user, suspended, active, last_seen_at, created_by, updated_at, server_id)
         SELECT d.name, 'whm', d.cpanel_user, d.suspended, NOT d.suspended, CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP, $5
           FROM unnest($1::text[], $2::text[], $3::boolean[]) AS d(name, cpanel_user, suspended)
         ON CONFLICT (name) DO UPDATE SET
           server_id = EXCLUDED.server_id,
           cpanel_user = EXCLUDED.cpanel_user, suspended = EXCLUDED.suspended, active = EXCLUDED.active,
           last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         RETURNING (xmax = 0) AS inserted`,
        [names, users, suspended, actorId, serverId]
      );
      added = upsert.rows.filter((row) => row.inserted).length;
      updated = upsert.rows.length - added;
    }
    const deactivated = (await client.query(
      `UPDATE spfbl_domains SET active = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE source = 'whm' AND server_id = $2 AND active AND (last_seen_at IS NULL OR last_seen_at < $1)`,
      [startedAt, serverId]
    )).rowCount;
    await client.query("UPDATE spfbl_whm_servers SET sync_at = CURRENT_TIMESTAMP, sync_status = 'ok' WHERE id = $1", [serverId]);
    await client.query('COMMIT');
    return { ...summarize(listing), added, updated, deactivated };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await recordSyncStatus(serverId, `failed:${String(error?.code || 'internal_error').slice(0, 40)}`);
    throw error;
  } finally {
    client.release();
  }
};

// Every server in turn; one failing never stops the others. The result says, per server, what happened.
const syncAll = async (actorId) => {
  const servers = await listServers();
  const results = [];
  for (const server of servers) {
    try { results.push({ server_id: server.id, name: server.name, ok: true, ...(await syncFromWhm(actorId, server.id)) }); } catch (error) {
      results.push({ server_id: server.id, name: server.name, ok: false, code: String(error?.code || 'internal_error').slice(0, 60) });
    }
  }
  return { servers: results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
};

module.exports = { DomainError, internals, normalizeDomainName, listDomains, addManualDomain, removeDomain, testWhm, validateWhmCredentials, syncFromWhm, syncAll };
