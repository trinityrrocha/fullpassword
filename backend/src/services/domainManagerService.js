const url = require('node:url');
const db = require('../config/database');
const { createRdapClient } = require('./domainManagerRdap');
const sslProbe = require('./domainManagerSsl');
const { createDnsClient, createBudget, normalizeServers } = require('./domainManagerDns');
const { isModuleEnabled } = require('./modulesService');
const { checkMailAuth, isValidSelector, MAX_SELECTORS, MAX_EXTRA_SELECTORS } = require('./domainManagerMailAuth');

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
const MAIL_RETRY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DKIM_SELECTORS = Object.freeze(['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 's1', 's2', 'mail', 'dkim', 'mandrill', 'mte1', 'ctct1', 'smtp', 'sig1']);

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

// `nowMs` is the service's clock (injectable in tests), so the days left follow it and not the machine's date.
const toRow = (row, nowMs = Date.now()) => {
  const expiresOn = dayString(row.expires_on);
  return {
    id: row.id, name: row.name, source: row.source, active: row.active,
    last_checked_at: row.last_checked_at || null, next_check_at: row.next_check_at || null,
    alerts: { enabled: row.alerts_enabled === true, notify_admins: row.alerts_admins === true, emails: Number(row.alerts_emails || 0) },
    mail: row.mail_checked_at ? {
      checked_at: row.mail_checked_at, name_exists: row.mail_name_exists !== false,
      spf: { status: row.spf_status, all: row.spf_all || null }, dmarc: { status: row.dmarc_status, policy: row.dmarc_policy || null },
      dkim: { status: row.dkim_status, found: Number(row.dkim_found || 0) }
    } : null,
    snapshot: row.checked_at ? {
      checked_at: row.checked_at, lookup_status: row.lookup_status, error_code: row.error_code,
      registrar: row.registrar, expires_on: expiresOn, days_left: expiresOn ? daysBetween(today(nowMs), expiresOn) : null,
      registered_on: dayString(row.registered_on), rdap_statuses: row.rdap_statuses || [], nameservers: row.nameservers || [], dnssec: row.dnssec,
      ssl: { state: row.ssl_state, not_after: row.ssl_not_after, issuer: row.ssl_issuer, protocol: row.ssl_protocol, error: row.ssl_error }
    } : null
  };
};

const SELECT_ROW = `SELECT d.id, d.name, d.source, d.active, d.last_checked_at, d.next_check_at, s.checked_at, s.lookup_status, s.error_code, s.registrar,
  s.expires_on, s.registered_on, s.rdap_statuses, s.nameservers, s.dnssec, s.ssl_state, s.ssl_not_after, s.ssl_issuer, s.ssl_protocol, s.ssl_error,
  a.enabled AS alerts_enabled, a.notify_admins AS alerts_admins, jsonb_array_length(COALESCE(a.emails, '[]'::jsonb)) AS alerts_emails,
  mc.checked_at AS mail_checked_at, mc.name_exists AS mail_name_exists, mc.spf_status, mc.dmarc_status, mc.dkim_status, mc.spf->>'all' AS spf_all,
  mc.dmarc->>'policy' AS dmarc_policy, jsonb_array_length(COALESCE(mc.dkim->'found', '[]'::jsonb)) AS dkim_found
  FROM dm_domains d LEFT JOIN dm_snapshots s ON s.domain_id = d.id LEFT JOIN dm_alert_settings a ON a.domain_id = d.id LEFT JOIN dm_mail_checks mc ON mc.domain_id = d.id`;

// Hours between the automatic imports of the WHM domains.
const SYNC_HOURS = Object.freeze([1, 2, 3, 4, 6, 8, 12, 24]);

const createService = ({ whmSync = (actorId) => require('./spfblDomainsService').syncAll(actorId), queryable = db, rdap = createRdapClient(), ssl = sslProbe, now = Date.now, mailAuth = checkMailAuth, dnsFactory = (servers) => createDnsClient({ servers }) } = {}) => {
  const running = new Set();
  const mailRunning = new Set();
  const dnsClients = new Map();
  const dnsFor = (servers) => {
    const key = servers.join(',');
    if (!dnsClients.has(key)) dnsClients.set(key, dnsFactory(servers));
    return dnsClients.get(key);
  };

  const getSettings = async () => {
    const row = (await queryable.query('SELECT check_interval_days, mail_check_enabled, mail_check_interval_days, dkim_selectors, dns_servers, dmarc_no_report_warning, ssl_check_enabled, domain_sync_enabled, domain_sync_interval_hours, domain_sync_last_at, domain_sync_last_status FROM dm_settings WHERE id = 1')).rows[0] || {};
    return {
      check_interval_days: Number(row.check_interval_days || 7),
      mail_check_enabled: row.mail_check_enabled !== false,
      mail_check_interval_days: Number(row.mail_check_interval_days || 7),
      dkim_selectors: Array.isArray(row.dkim_selectors) ? row.dkim_selectors : [...DEFAULT_DKIM_SELECTORS],
      dns_servers: Array.isArray(row.dns_servers) ? row.dns_servers : [],
      dmarc_no_report_warning: row.dmarc_no_report_warning !== false,
      ssl_check_enabled: row.ssl_check_enabled !== false,
      domain_sync_enabled: row.domain_sync_enabled !== false,
      domain_sync_interval_hours: SYNC_HOURS.includes(Number(row.domain_sync_interval_hours)) ? Number(row.domain_sync_interval_hours) : 6,
      domain_sync_last_at: row.domain_sync_last_at ? new Date(row.domain_sync_last_at).toISOString() : null,
      domain_sync_last_status: row.domain_sync_last_status || null,
      default_dkim_selectors: [...DEFAULT_DKIM_SELECTORS]
    };
  };
  const validDays = (value) => Number.isInteger(value) && value >= 1 && value <= 30;
  const normalizeSelectors = (input, max, min = 0) => {
    if (!Array.isArray(input) || input.length > max) return null;
    const list = [...new Set(input.map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : '')))];
    return list.length >= min && list.every(isValidSelector) ? list : null;
  };
  // A full replacement: the settings card always sends every field.
  const saveSettings = async (input) => {
    if (!validDays(input?.check_interval_days)) throw new DomainError('Informe o intervalo entre consultas de 1 a 30 dias.', 'DM_INTERVAL_INVALID', 422);
    if (typeof input.mail_check_enabled !== 'boolean') throw new DomainError('Informe se a verificação de e-mail fica ligada.', 'DM_MAIL_INVALID', 422);
    if (!validDays(input.mail_check_interval_days)) throw new DomainError('Informe o intervalo da verificação de e-mail de 1 a 30 dias.', 'DM_MAIL_INTERVAL_INVALID', 422);
    const selectors = normalizeSelectors(input.dkim_selectors, MAX_SELECTORS, 1);
    if (!selectors) throw new DomainError(`Informe de 1 a ${MAX_SELECTORS} seletores DKIM válidos (letras, números, ponto, hífen e sublinhado).`, 'DM_SELECTORS_INVALID', 422);
    const servers = normalizeServers(input.dns_servers ?? []);
    if (!servers) throw new DomainError('Informe até 4 endereços IP de servidores DNS, ou deixe em branco para usar o do sistema.', 'DM_DNS_SERVERS_INVALID', 422);
    const before = await getSettings();
    for (const key of ['dmarc_no_report_warning', 'ssl_check_enabled']) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new DomainError('Opção inválida nas configurações.', 'DM_OPTION_INVALID', 422);
    }
    if (input.domain_sync_enabled !== undefined && typeof input.domain_sync_enabled !== 'boolean') throw new DomainError('Opção inválida nas configurações.', 'DM_OPTION_INVALID', 422);
    if (input.domain_sync_interval_hours !== undefined && !SYNC_HOURS.includes(input.domain_sync_interval_hours)) throw new DomainError('Escolha o intervalo da sincronização entre as opções da lista.', 'DM_SYNC_INTERVAL_INVALID', 422);
    const syncEnabled = input.domain_sync_enabled ?? before.domain_sync_enabled;
    const syncHours = input.domain_sync_interval_hours ?? before.domain_sync_interval_hours;
    const reportWarning = input.dmarc_no_report_warning ?? before.dmarc_no_report_warning;
    const sslCheck = input.ssl_check_enabled ?? before.ssl_check_enabled;
    await queryable.query(
      `UPDATE dm_settings SET check_interval_days = $1, mail_check_enabled = $2, mail_check_interval_days = $3, dkim_selectors = $4::text[], dns_servers = $5::text[],
         dmarc_no_report_warning = $6, ssl_check_enabled = $7, domain_sync_enabled = $8, domain_sync_interval_hours = $9, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [input.check_interval_days, input.mail_check_enabled, input.mail_check_interval_days, selectors, servers, reportWarning, sslCheck, syncEnabled, syncHours]);
    // The stored verdicts were made under the old rule: bring every domain's e-mail check forward so the list agrees with the new option.
    if (reportWarning !== before.dmarc_no_report_warning) await queryable.query('UPDATE dm_domains SET next_mail_check_at = CURRENT_TIMESTAMP WHERE active');
    return getSettings();
  };

  const getMailSettings = async (domainId) => {
    const domain = (await queryable.query('SELECT id FROM dm_domains WHERE id = $1', [domainId])).rows[0];
    if (!domain) throw new DomainError('Domínio não encontrado.', 'DM_NOT_FOUND', 404);
    const row = (await queryable.query('SELECT enabled, extra_selectors FROM dm_mail_domain_settings WHERE domain_id = $1', [domainId])).rows[0];
    return { enabled: row ? row.enabled : true, extra_selectors: row?.extra_selectors || [] };
  };
  const saveMailSettings = async (domainId, input, userId) => {
    if (!input || typeof input.enabled !== 'boolean') throw new DomainError('Dados da verificação de e-mail inválidos.', 'DM_MAIL_INVALID', 422);
    const selectors = normalizeSelectors(input.extra_selectors ?? [], MAX_EXTRA_SELECTORS);
    if (!selectors) throw new DomainError(`Informe até ${MAX_EXTRA_SELECTORS} seletores DKIM válidos.`, 'DM_SELECTORS_INVALID', 422);
    await getMailSettings(domainId);
    await queryable.query(
      `INSERT INTO dm_mail_domain_settings (domain_id, enabled, extra_selectors, updated_by) VALUES ($1, $2, $3::text[], $4)
       ON CONFLICT (domain_id) DO UPDATE SET enabled = EXCLUDED.enabled, extra_selectors = EXCLUDED.extra_selectors, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [domainId, input.enabled, selectors, userId || null]);
    // A new selector is worth looking for now, not in a week.
    await queryable.query('UPDATE dm_domains SET next_mail_check_at = CURRENT_TIMESTAMP WHERE id = $1', [domainId]);
    return getMailSettings(domainId);
  };

  // SPFBL's domains are listed automatically (names only); removing one from the SPFBL catalogue does not delete its lookup history.
  const syncFromSpfbl = async () => {
    const added = (await queryable.query(
      `INSERT INTO dm_domains (name, source) SELECT name, 'spfbl' FROM spfbl_domains WHERE active ON CONFLICT (name) DO NOTHING RETURNING id`)).rowCount;
    // A domain that came from the SPFBL catalogue and is no longer in it (a subdomain the catalogue dropped) leaves this list too.
    await queryable.query("DELETE FROM dm_domains WHERE source = 'spfbl' AND NOT EXISTS (SELECT 1 FROM spfbl_domains s WHERE s.name = dm_domains.name)");
    return added;
  };

  // Imports the domains of every registered WHM server into the SPFBL catalogue, then into this list. Needs the SPFBL module (that is where
  // the servers are registered). A server that fails never stops the others, and the result says what happened per server.
  const syncDomains = async (actorId = null) => {
    if (!(await isModuleEnabled('spfbl', queryable))) return { skipped: 'spfbl_off', servers: [], ok: 0, failed: 0, imported: 0 };
    const outcome = await whmSync(actorId);
    const imported = await syncFromSpfbl();
    const status = outcome.servers.length === 0 ? 'no_servers' : outcome.failed === 0 ? 'ok' : outcome.ok === 0 ? 'failed' : 'partial';
    await queryable.query('UPDATE dm_settings SET domain_sync_last_at = $1, domain_sync_last_status = $2 WHERE id = 1', [new Date(now()), status]);
    return { servers: outcome.servers.map((server) => ({ name: server.name, ok: server.ok, code: server.code || null, domains: server.domains ?? null })), ok: outcome.ok, failed: outcome.failed, imported, status };
  };
  // The scheduled import: due when enabled and the interval has passed since the last one. The turn is CLAIMED before the call, so a second
  // instance or a restart cannot run it twice; a failed run waits for the next interval like a successful one.
  const autoSyncDomains = async () => {
    const settings = await getSettings();
    if (!settings.domain_sync_enabled) return null;
    const due = new Date(now() - settings.domain_sync_interval_hours * 3600 * 1000);
    const claimed = await queryable.query(
      `UPDATE dm_settings SET domain_sync_last_at = $1 WHERE id = 1 AND domain_sync_enabled AND (domain_sync_last_at IS NULL OR domain_sync_last_at <= $2) RETURNING id`, [new Date(now()), due]);
    if (!claimed.rows[0]) return null;
    return syncDomains(null);
  };

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
    return toRow(row, now());
  };

  const detail = async (id) => {
    const domain = await getDomain(id);
    const changes = (await queryable.query(
      'SELECT field, old_value, new_value, detected_at FROM dm_changes WHERE domain_id = $1 ORDER BY detected_at DESC LIMIT 50', [id])).rows;
    const mailRow = (await queryable.query('SELECT checked_at, name_exists, spf, dmarc, dkim FROM dm_mail_checks WHERE domain_id = $1', [id])).rows[0];
    return { domain, changes, mail: mailRow ? { checked_at: mailRow.checked_at, name_exists: mailRow.name_exists, spf: mailRow.spf, dmarc: mailRow.dmarc, dkim: mailRow.dkim } : null };
  };

  const SORTS = { name: 'd.name ASC', expiry: 's.expires_on ASC NULLS LAST, d.name ASC', checked: 's.checked_at DESC NULLS LAST, d.name ASC' };
  // `ids` limits the list to those domains (an ordinary account's grant); null means everything (Super Admin).
  const list = async ({ page = 1, size = 20, search = '', sort = 'name', ids = null } = {}) => {
    const pageSize = PAGE_SIZES.has(Number(size)) ? Number(size) : 20;
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const term = typeof search === 'string' ? search.trim().toLowerCase().slice(0, 100) : '';
    const conditions = [];
    const params = [];
    if (term) { params.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`); conditions.push(`d.name LIKE $${params.length}`); }
    if (ids !== null) { params.push(ids); conditions.push(`d.id = ANY($${params.length}::uuid[])`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (await queryable.query(`SELECT count(*)::int AS n FROM dm_domains d ${where}`, params)).rows[0].n;
    const rows = (await queryable.query(
      `${SELECT_ROW} ${where} ORDER BY ${SORTS[sort] || SORTS.name} LIMIT ${pageSize} OFFSET ${(pageNumber - 1) * pageSize}`, params)).rows;
    return { domains: rows.map((row) => toRow(row, now())), total, page: pageNumber, size: pageSize };
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
      const { ssl_check_enabled: sslEnabled } = await getSettings();
      const [registry, certificate] = await Promise.all([rdap.lookup(domain.name), sslEnabled ? ssl.probe(domain.name).catch(() => ({ ssl_state: 'error', ssl_error: 'PROBE_FAILED' })) : {}]);
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
      let mailChangesCount = 0;
      // Only the lookup BUTTON refreshes the e-mail checks too. The scheduled registry round never does: the e-mail checks have their own
      // interval, and a throttled registry retrying every hour must not turn into dozens of DNS queries per domain per hour.
      if (manual) { try { mailChangesCount = (await checkMail(id))?.changes || 0; } catch { /* the registry result is already stored; the mail check retries on its schedule */ } }
      return { ...(await getDomain(id)), changes: changes.length + mailChangesCount };
    } finally {
      running.delete(id);
    }
  };

  // Domains whose mail check is due. Claimed with a conditional UPDATE (SKIP LOCKED), like the registry lookups, but on their own
  // column: a throttled registry must never stall DNS checks.
  const claimMailBatch = async (limit, claimMs = 30 * 60 * 1000) => {
    const settings = await getSettings();
    if (!settings.mail_check_enabled) return [];
    return (await queryable.query(
      `UPDATE dm_domains SET next_mail_check_at = $2 WHERE id IN (
         SELECT d.id FROM dm_domains d LEFT JOIN dm_mail_domain_settings m ON m.domain_id = d.id
          WHERE d.active AND COALESCE(m.enabled, TRUE) AND d.next_mail_check_at <= $1 ORDER BY d.next_mail_check_at LIMIT ${Number(limit) || 10} FOR UPDATE OF d SKIP LOCKED)
       RETURNING id`, [new Date(now()), new Date(now() + claimMs)])).rows.map((row) => row.id);
  };

  const mailChanges = (previous, next) => {
    if (!previous) return [];
    const rows = [];
    const settled = (status) => status && status !== 'inconclusive';
    for (const [field, before, after] of [['spf_status', previous.spf_status, next.spf.status], ['dmarc_status', previous.dmarc_status, next.dmarc.status], ['dkim_status', previous.dkim_status, next.dkim.status]]) {
      if (settled(before) && settled(after) && before !== after) rows.push({ field, old: before, next: after });
    }
    const beforePolicy = previous.dmarc?.policy ?? null;
    if (settled(previous.dmarc_status) && settled(next.dmarc.status) && beforePolicy !== (next.dmarc.policy ?? null)) {
      rows.push({ field: 'dmarc_policy', old: beforePolicy, next: next.dmarc.policy ?? null });
    }
    const beforeRecord = previous.spf?.record ?? null;
    if (beforeRecord && next.spf.record && beforeRecord !== next.spf.record) rows.push({ field: 'spf_record', old: beforeRecord.slice(0, 500), next: next.spf.record.slice(0, 500) });
    return rows;
  };

  // SPF, DKIM and DMARC of one name. A section whose DNS answer was INCONCLUSIVE keeps the last known data and writes no change row:
  // a resolver hiccup must never look like "the domain lost its SPF".
  const checkMail = async (id) => {
    const domain = (await queryable.query('SELECT id, name FROM dm_domains WHERE id = $1', [id])).rows[0];
    if (!domain) throw new DomainError('Domínio não encontrado.', 'DM_NOT_FOUND', 404);
    const settings = await getSettings();
    const own = await getMailSettings(id);
    if (!settings.mail_check_enabled || !own.enabled) return null;
    // One check of a domain at a time: two at once would read the same "previous" and record every change twice.
    if (mailRunning.has(id)) return null;
    mailRunning.add(id);
    try {
      const selectors = [...new Set([...settings.dkim_selectors, ...own.extra_selectors])];
      const outcome = await mailAuth(domain.name, { dns: dnsFor(settings.dns_servers), selectors, warnNoReports: settings.dmarc_no_report_warning, budget: createBudget({ now }) });
      const previous = (await queryable.query('SELECT * FROM dm_mail_checks WHERE domain_id = $1', [id])).rows[0];
      const stamp = new Date(now()).toISOString();
      // A section is "unsettled" when the DNS did not answer, or (DKIM) when some selectors did not answer and the verdict would differ
      // from the last known one: a partial answer must never register as a change.
      const unsettled = (section, key) => section.status === 'inconclusive'
        || (key === 'dkim' && section.unreachable > 0 && previous?.dkim_status && previous.dkim_status !== section.status);
      const settle = (section, key) => (unsettled(section, key) && previous?.[`${key}_status`] && previous[`${key}_status`] !== 'inconclusive'
        ? { value: previous[key], status: previous[`${key}_status`], kept: true }
        : { value: { ...section, as_of: stamp }, status: section.status, kept: false });
      const spf = settle(outcome.spf, 'spf');
      const dmarc = settle(outcome.dmarc, 'dmarc');
      const dkim = settle(outcome.dkim, 'dkim');
      const merged = { spf: spf.value, dmarc: dmarc.value, dkim: dkim.value };
      await queryable.query(
        `INSERT INTO dm_mail_checks (domain_id, checked_at, name_exists, spf_status, dmarc_status, dkim_status, spf, dmarc, dkim)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
         ON CONFLICT (domain_id) DO UPDATE SET checked_at = EXCLUDED.checked_at, name_exists = EXCLUDED.name_exists, spf_status = EXCLUDED.spf_status,
           dmarc_status = EXCLUDED.dmarc_status, dkim_status = EXCLUDED.dkim_status, spf = EXCLUDED.spf, dmarc = EXCLUDED.dmarc, dkim = EXCLUDED.dkim`,
        [id, new Date(now()), outcome.name_exists, spf.status, dmarc.status, dkim.status, JSON.stringify(merged.spf), JSON.stringify(merged.dmarc), JSON.stringify(merged.dkim)]);
      const changes = mailChanges(previous, { spf: { ...merged.spf, status: spf.status }, dmarc: { ...merged.dmarc, status: dmarc.status }, dkim: { status: dkim.status } });
      for (const change of changes) {
        await queryable.query('INSERT INTO dm_changes (domain_id, field, old_value, new_value) VALUES ($1,$2,$3,$4)', [id, change.field, change.old, change.next]);
      }
      const anyUnsettled = [[outcome.spf, 'spf'], [outcome.dmarc, 'dmarc'], [outcome.dkim, 'dkim']].some(([section, key]) => unsettled(section, key));
      const delay = anyUnsettled ? MAIL_RETRY_MS : settings.mail_check_interval_days * DAY_MS;
      await queryable.query('UPDATE dm_domains SET next_mail_check_at = $2 WHERE id = $1', [id, new Date(now() + delay)]);
      return { changes: changes.length };
    } finally {
      mailRunning.delete(id);
    }
  };

  // Names only, for the picker of the user dialog (Super Admin). Bounded: the grant itself is limited to 100 domains.
  const listNames = async () => (await queryable.query('SELECT id, name FROM dm_domains ORDER BY name LIMIT 5000')).rows;

  return { listNames, getSettings, saveSettings, getMailSettings, saveMailSettings, claimMailBatch, checkMail, syncFromSpfbl, syncDomains, autoSyncDomains, addDomain, importDomains, removeDomain, getDomain, detail, list, checkDomain };
};

let shared = null;
const getService = () => { shared = shared || createService(); return shared; };

module.exports = { SYNC_HOURS, DEFAULT_DKIM_SELECTORS, DomainError, createService, getService, normalizeName, nextCheckDelayMs, daysBetween, today, UUID_PATTERN, MAX_IMPORT };
