const url = require('node:url');
const db = require('../config/database');
const { createRdapClient } = require('./domainManagerRdap');
const sslProbe = require('./domainManagerSsl');

// Domain Manager core: the list of domains, the latest lookup result (RDAP + SSL) and the changes between lookups.
class DomainError extends Error {
  constructor(message, code = 'DOMAIN_INVALID', statusCode = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const NAME_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMPORT = 200;
const WINDOW_DAYS = 30;
const DAY_MS = 86400000;
const MANUAL_COOLDOWN_MS = 30000;
const PAGE_SIZES = new Set([20, 40, 100]);
const TZ = 'America/Sao_Paulo';

const normalizeName = (input) => {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase().replace(/\.$/, '');
  if (!value || /[\s/:@?#\\]/.test(value)) return null;
  value = url.domainToASCII(value);
  return NAME_PATTERN.test(value) ? value : null;
};

const today = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
const dayString = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : (value ? String(value).slice(0, 10) : null));

// Adaptive cadence: every `intervalDays` while the expiry is far; daily from 30 days before it and for as long as it is past;
// never later than the day the 30-day window opens. Failures retry sooner (a throttled registry waits longer).
const nextCheckDelayMs = ({ lookupStatus, errorCode, expiresOn }, intervalDays, now = Date.now()) => {
  if (lookupStatus === 'error') return (errorCode === 'RATE_LIMITED' ? 60 : 6 * 60) * 60000;
  if (expiresOn) {
    const left = daysBetween(today(now), expiresOn);
    if (left <= WINDOW_DAYS) return DAY_MS;
    return Math.max(DAY_MS, Math.min(intervalDays, left - WINDOW_DAYS) * DAY_MS);
  }
  return intervalDays * DAY_MS;
};

const toRow = (row) => {
  const expiresOn = dayString(row.expires_on);
  return {
    id: row.id, name: row.name, source: row.source, active: row.active,
    last_checked_at: row.last_checked_at || null, next_check_at: row.next_check_at || null,
    alerts: { enabled: row.alerts_enabled === true, notify_admins: row.alerts_admins === true, emails: Number(row.alerts_emails || 0) },
    snapshot: row.checked_at ? {
      checked_at: row.checked_at, lookup_status: row.lookup_status, error_code: row.error_code,
      registrar: row.registrar, expires_on: expiresOn, days_left: expiresOn ? daysBetween(today(), expiresOn) : null,
      registered_on: dayString(row.registered_on), rdap_statuses: row.rdap_statuses || [], nameservers: row.nameservers || [], dnssec: row.dnssec,
      ssl: { state: row.ssl_state, not_after: row.ssl_not_after, issuer: row.ssl_issuer, protocol: row.ssl_protocol, error: row.ssl_error }
    } : null
  };
};

const SELECT_ROW = `SELECT d.id, d.name, d.source, d.active, d.last_checked_at, d.next_check_at, s.checked_at, s.lookup_status, s.error_code, s.registrar,
  s.expires_on, s.registered_on, s.rdap_statuses, s.nameservers, s.dnssec, s.ssl_state, s.ssl_not_after, s.ssl_issuer, s.ssl_protocol, s.ssl_error,
  a.enabled AS alerts_enabled, a.notify_admins AS alerts_admins, jsonb_array_length(COALESCE(a.emails, '[]'::jsonb)) AS alerts_emails
  FROM dm_domains d LEFT JOIN dm_snapshots s ON s.domain_id = d.id LEFT JOIN dm_alert_settings a ON a.domain_id = d.id`;

const createService = ({ queryable = db, rdap = createRdapClient(), ssl = sslProbe, now = Date.now } = {}) => {
  const running = new Set();

  const getSettings = async () => {
    const row = (await queryable.query('SELECT check_interval_days FROM dm_settings WHERE id = 1')).rows[0];
    return { check_interval_days: Number(row?.check_interval_days || 7) };
  };
  const saveSettings = async (input) => {
    const days = input?.check_interval_days;
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new DomainError('Informe o intervalo entre consultas de 1 a 30 dias.', 'DM_INTERVAL_INVALID', 422);
    await queryable.query('UPDATE dm_settings SET check_interval_days = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [days]);
    return getSettings();
  };

  // SPFBL's domains are listed automatically (names only); removing one from the SPFBL catalogue does not delete its lookup history.
  const syncFromSpfbl = async () => (await queryable.query(
    `INSERT INTO dm_domains (name, source) SELECT name, 'spfbl' FROM spfbl_domains WHERE active ON CONFLICT (name) DO NOTHING RETURNING id`)).rowCount;

  const addDomain = async (name, userId) => {
    const normalized = normalizeName(name);
    if (!normalized) throw new DomainError('Informe um domínio válido, por exemplo empresa.com.br.', 'DM_NAME_INVALID', 422);
    const inserted = await queryable.query(
      `INSERT INTO dm_domains (name, source, created_by) VALUES ($1, 'manual', $2) ON CONFLICT (name) DO NOTHING RETURNING id`, [normalized, userId || null]);
    if (!inserted.rows[0]) throw new DomainError('Este domínio já está na lista.', 'DM_DUPLICATE', 409);
    return getDomain(inserted.rows[0].id);
  };

  const importDomains = async (names, userId) => {
    if (!Array.isArray(names) || names.length < 1 || names.length > MAX_IMPORT) throw new DomainError(`Informe de 1 a ${MAX_IMPORT} domínios.`, 'DM_IMPORT_INVALID', 422);
    const result = { added: 0, duplicates: 0, invalid: [] };
    const seen = new Set();
    for (const raw of names) {
      const normalized = normalizeName(raw);
      if (!normalized) { result.invalid.push(String(raw).slice(0, 80)); continue; }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const inserted = await queryable.query(
        `INSERT INTO dm_domains (name, source, created_by) VALUES ($1, 'manual', $2) ON CONFLICT (name) DO NOTHING RETURNING id`, [normalized, userId || null]);
      if (inserted.rows[0]) result.added += 1; else result.duplicates += 1;
    }
    return result;
  };

  const removeDomain = async (id) => {
    const row = (await queryable.query('SELECT source FROM dm_domains WHERE id = $1', [id])).rows[0];
    if (!row) throw new DomainError('Domínio não encontrado.', 'DM_NOT_FOUND', 404);
    if (row.source !== 'manual') throw new DomainError('Este domínio vem do SPFBL: remova-o por lá.', 'DM_SOURCE_LOCKED', 409);
    await queryable.query('DELETE FROM dm_domains WHERE id = $1', [id]);
  };

  const getDomain = async (id) => {
    const row = (await queryable.query(`${SELECT_ROW} WHERE d.id = $1`, [id])).rows[0];
    if (!row) throw new DomainError('Domínio não encontrado.', 'DM_NOT_FOUND', 404);
    return toRow(row);
  };

  const detail = async (id) => {
    const domain = await getDomain(id);
    const changes = (await queryable.query(
      'SELECT field, old_value, new_value, detected_at FROM dm_changes WHERE domain_id = $1 ORDER BY detected_at DESC LIMIT 50', [id])).rows;
    return { domain, changes };
  };

  const SORTS = { name: 'd.name ASC', expiry: 's.expires_on ASC NULLS LAST, d.name ASC', checked: 's.checked_at DESC NULLS LAST, d.name ASC' };
  const list = async ({ page = 1, size = 20, search = '', sort = 'name' } = {}) => {
    const pageSize = PAGE_SIZES.has(Number(size)) ? Number(size) : 20;
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const term = typeof search === 'string' ? search.trim().toLowerCase().slice(0, 100) : '';
    const where = term ? 'WHERE d.name LIKE $1' : '';
    const params = term ? [`%${term.replace(/[\\%_]/g, '\\$&')}%`] : [];
    const total = (await queryable.query(`SELECT count(*)::int AS n FROM dm_domains d ${where}`, params)).rows[0].n;
    const rows = (await queryable.query(
      `${SELECT_ROW} ${where} ORDER BY ${SORTS[sort] || SORTS.name} LIMIT ${pageSize} OFFSET ${(pageNumber - 1) * pageSize}`, params)).rows;
    return { domains: rows.map(toRow), total, page: pageNumber, size: pageSize };
  };

  const changeRows = (previous, next) => {
    if (!previous || !['ok', 'no_expiry'].includes(previous.lookup_status) || !['ok', 'no_expiry'].includes(next.lookup_status)) return [];
    const join = (value) => (Array.isArray(value) ? [...value].sort().join(', ') : value == null ? null : String(value));
    const pairs = [
      ['expires_on', dayString(previous.expires_on), next.expires_on], ['nameservers', join(previous.nameservers), join(next.nameservers)],
      ['dnssec', previous.dnssec, next.dnssec], ['rdap_statuses', join(previous.rdap_statuses), join(next.rdap_statuses)],
      ['registrar', previous.registrar, next.registrar]
    ];
    return pairs.filter(([, before, after]) => (before ?? null) !== (after ?? null)).map(([field, before, after]) => ({ field, old: before == null ? null : String(before), next: after == null ? null : String(after) }));
  };

  // Runs one lookup (RDAP and SSL together) and stores it. `manual` enforces the per-domain cooldown the button needs.
  const checkDomain = async (id, { manual = false } = {}) => {
    const domain = (await queryable.query('SELECT id, name, last_checked_at FROM dm_domains WHERE id = $1', [id])).rows[0];
    if (!domain) throw new DomainError('Domínio não encontrado.', 'DM_NOT_FOUND', 404);
    if (running.has(id)) throw new DomainError('Este domínio já está sendo consultado.', 'DM_BUSY', 409);
    if (manual && domain.last_checked_at && now() - new Date(domain.last_checked_at).getTime() < MANUAL_COOLDOWN_MS) {
      throw new DomainError('Este domínio foi consultado agora há pouco. Aguarde alguns segundos.', 'DM_COOLDOWN', 429);
    }
    running.add(id);
    try {
      const [registry, certificate] = await Promise.all([rdap.lookup(domain.name), ssl.probe(domain.name).catch(() => ({ ssl_state: 'error', ssl_error: 'PROBE_FAILED' }))]);
      const previous = (await queryable.query('SELECT * FROM dm_snapshots WHERE domain_id = $1', [id])).rows[0];
      // A failed registry call keeps the last known registry data; only the status and time move.
      const keep = registry.lookup_status === 'error' && previous;
      const merged = {
        lookup_status: registry.lookup_status, error_code: registry.error_code || null,
        registrar: keep ? previous.registrar : registry.registrar || null, expires_on: keep ? dayString(previous.expires_on) : registry.expires_on || null,
        registered_on: keep ? dayString(previous.registered_on) : registry.registered_on || null,
        rdap_statuses: keep ? previous.rdap_statuses : registry.rdap_statuses || [], nameservers: keep ? previous.nameservers : registry.nameservers || [],
        dnssec: keep ? previous.dnssec : registry.dnssec ?? null
      };
      const sslState = certificate.ssl_state || null;
      const checkedAt = new Date(now());
      await queryable.query(
        `INSERT INTO dm_snapshots (domain_id, checked_at, lookup_status, error_code, registrar, expires_on, registered_on, rdap_statuses, nameservers, dnssec,
           ssl_state, ssl_not_after, ssl_issuer, ssl_protocol, ssl_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (domain_id) DO UPDATE SET checked_at=EXCLUDED.checked_at, lookup_status=EXCLUDED.lookup_status, error_code=EXCLUDED.error_code,
           registrar=EXCLUDED.registrar, expires_on=EXCLUDED.expires_on, registered_on=EXCLUDED.registered_on, rdap_statuses=EXCLUDED.rdap_statuses,
           nameservers=EXCLUDED.nameservers, dnssec=EXCLUDED.dnssec, ssl_state=EXCLUDED.ssl_state, ssl_not_after=EXCLUDED.ssl_not_after,
           ssl_issuer=EXCLUDED.ssl_issuer, ssl_protocol=EXCLUDED.ssl_protocol, ssl_error=EXCLUDED.ssl_error`,
        [id, checkedAt, merged.lookup_status, merged.error_code, merged.registrar, merged.expires_on, merged.registered_on, merged.rdap_statuses, merged.nameservers,
          merged.dnssec, sslState, certificate.ssl_not_after || null, certificate.ssl_issuer || null, certificate.ssl_protocol || null, certificate.ssl_error || null]);
      const changes = changeRows(previous, merged);
      if (previous && previous.ssl_state && sslState && previous.ssl_state !== sslState && !['error'].includes(sslState)) changes.push({ field: 'ssl_state', old: previous.ssl_state, next: sslState });
      for (const change of changes) {
        await queryable.query('INSERT INTO dm_changes (domain_id, field, old_value, new_value) VALUES ($1,$2,$3,$4)', [id, change.field, change.old, change.next]);
      }
      const { check_interval_days: interval } = await getSettings();
      const delay = nextCheckDelayMs({ lookupStatus: merged.lookup_status, errorCode: merged.error_code, expiresOn: merged.expires_on }, interval, now());
      await queryable.query('UPDATE dm_domains SET last_checked_at = $2, next_check_at = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id, checkedAt, new Date(now() + delay)]);
      return { ...(await getDomain(id)), changes: changes.length };
    } finally {
      running.delete(id);
    }
  };

  return { getSettings, saveSettings, syncFromSpfbl, addDomain, importDomains, removeDomain, getDomain, detail, list, checkDomain };
};

let shared = null;
const getService = () => { shared = shared || createService(); return shared; };

module.exports = { DomainError, createService, getService, normalizeName, nextCheckDelayMs, daysBetween, today, UUID_PATTERN, MAX_IMPORT };
