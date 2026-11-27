const { WhmClient } = require('./spfblWhmClient');
// Loaded on first use: it needs the database settings, which pure tests of this module do not have.
const defaultStore = new Proxy({}, { get: (_target, name) => require('./spfblSentStore')[name] });

// "Enviados": the mail SENT by the domains of a WHM server (emailtrack_search). The server is read in small time windows (one day at most per
// call), never the whole retention at once, and every line is stored in PostgreSQL: the screen reads from there, so the WHM limit of
// records per call no longer caps the period. A scheduled collection (same interval and retention as the received history) keeps it
// current, and a page load tops it up with what is newer than the last collection. Scope (which domains a person may see) is decided by the
// controller, before this is called.
const TOP_UP_MS = 2 * 60 * 1000;
const OVERLAP_SECONDS = 3600;
const WINDOW_SECONDS = 86400;
const BACKFILL_DAYS = 10;
// Per kind of call (delivered / problems) and per window: the read stops there and the page says there may be more.
const MAX_PER_KIND = 5000;
const ALL = 'all';
const PERIODS = Object.freeze({ '24h': 24 * 3600, '3d': 3 * 86400, '7d': 7 * 86400, '30d': 30 * 86400, '60d': 60 * 86400, '90d': 90 * 86400 });
const STATUS_FILTERS = Object.freeze({ all: null, sent: ['success'], deferred: ['defer'], failed: ['failure'], progress: ['inprogress'] });
const PAGE_SIZES = Object.freeze([20, 40, 100]);
const MAX_QUERY = 100;
const MAX_FIELD = 600;

class SentError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'SentError'; this.code = code; this.statusCode = statusCode; }
}

const EVENT_LABELS = Object.freeze({ success: 'Entrega', defer: 'Tentativa adiada', failure: 'Falha na entrega', inprogress: 'Em andamento' });

// A server's answer in words a person understands. Heuristic: the texts come from the receiving mail server and vary; the full text is always
// available in the details. The order matters (the first rule that matches wins).
const RULES = Object.freeze([
  ['domain_not_found', 'Domínio inexistente', /host or domain name not found|domain[^.]{0,50}(does not exist|not found|not exist)|no mx|unrouteable address|nxdomain|no such domain|\b5\.1\.2\b|name or service not known|non-existent hosts/i],
  ['mailbox_not_found', 'Destinatário inexistente', /user unknown|unknown user|no such user|no such recipient|recipient (address )?rejected|recipient not found|mailbox (unavailable|not found)|(account|address|mailbox|recipient|user)[^.]{0,60}(does not exist|doesn't exist|not exist)|invalid (recipient|mailbox)|account (is )?(disabled|inactive|not found)|\b5\.1\.[01]\b|undeliverable address|address not found/i],
  ['mailbox_full', 'Caixa cheia', /mailbox (is )?full|over ?quota|quota (exceeded|full)|storage (limit|full)|insufficient (system )?storage|\b[45]\.2\.2\b|inbox is full|disk quota/i],
  ['rate_limited', 'Limite de envios excedido', /max defers and failures per hour|exceeded the (maximum|max)|rate ?limit|too many (messages|emails|connections|recipients)|sending limit|quota of emails per hour/i],
  ['blocked_spam', 'Bloqueado como spam', /spam|blacklist|blocklist|blocked|\brbl\b|spamhaus|barracuda|reputation|poor sender|\b5\.7\.1\b|policy (violation|reject)|not allowed|denied by (policy|recipient)|access denied|message rejected/i],
  ['unreachable', 'Servidor de destino sem resposta', /timed out|time ?out|connection (refused|reset|closed)|no route to host|network is unreachable|unable to connect|could not connect|connection to .* failed|server not responding/i],
  ['greylisted', 'Adiado pelo destino (tentará de novo)', /greylist|graylist|try again later|temporarily (deferred|rejected|unavailable)|come back later/i],
  ['tls', 'Falha de TLS', /\btls\b|starttls|certificate|ssl/i],
  ['too_large', 'Mensagem grande demais', /message (size|too large)|too large|exceeds? (the )?(maximum |max )?(message )?size|\b5\.3\.4\b/i]
]);
const SMTP_CODE = /\b([45]\d\d)(?:[ -]([245]\.\d{1,3}\.\d{1,3}))?\b/;

const classifyResult = (type, message) => {
  if (type === 'success') return { key: 'sent', label: 'Enviado', tone: 'ok', code: null };
  if (type === 'inprogress') return { key: 'progress', label: 'Em andamento', tone: 'info', code: null };
  const text = String(message || '');
  const smtp = SMTP_CODE.exec(text);
  const code = smtp ? (smtp[2] ? `${smtp[1]} ${smtp[2]}` : smtp[1]) : null;
  const tone = type === 'defer' ? 'warning' : 'danger';
  for (const [key, label, pattern] of RULES) if (pattern.test(text)) return { key, label: type === 'defer' && key !== 'greylisted' ? `Adiado: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label, tone, code };
  return { key: type === 'defer' ? 'deferred' : 'failed', label: type === 'defer' ? 'Adiado' : (code ? `Falha na entrega (${code})` : 'Falha na entrega'), tone, code };
};

const text = (value) => (value === null || value === undefined ? '' : String(value)).slice(0, MAX_FIELD);
const toUnix = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; };

// The fields the details show; anything else the server sends is dropped.
const DETAIL_FIELDS = Object.freeze(['type', 'actiontime', 'actionunixtime', 'sendunixtime', 'msgid', 'sender', 'email', 'recipient', 'deliveredto', 'deliverydomain', 'deliveryuser',
  'domain', 'user', 'host', 'ip', 'senderhost', 'senderip', 'senderauth', 'router', 'transport', 'transport_is_remote', 'size', 'spamscore', 'message']);

const normalizeRecord = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const type = ['success', 'defer', 'failure', 'inprogress'].includes(raw.type) ? raw.type : null;
  if (!type) return null; // e.g. "rejected": mail refused on arrival, not mail sent
  const sentAt = toUnix(raw.sendunixtime) || toUnix(raw.actionunixtime);
  if (!sentAt) return null;
  // The envelope sender is in "email" (a full address); "sender" can be just a local user such as "root".
  const email = text(raw.email);
  const sender = text(raw.sender);
  const from = email.includes('@') ? email : sender.includes('@') ? sender : (email || sender);
  const result = classifyResult(type, raw.message);
  const detail = {};
  for (const key of DETAIL_FIELDS) if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') detail[key] = text(raw[key]);
  return {
    id: `${text(raw.msgid)}|${text(raw.recipient)}|${toUnix(raw.actionunixtime) || sentAt}|${type}`,
    type, event: EVENT_LABELS[type], sender_domain: senderDomainOf(raw), action_unix: toUnix(raw.actionunixtime) || sentAt, sent_at: new Date(sentAt * 1000).toISOString(), sent_unix: sentAt,
    sender: from, recipient: text(raw.recipient), delivered_to: text(raw.deliveredto),
    result: { key: result.key, label: result.label, tone: result.tone, code: result.code }, detail
  };
};

// The domain a record belongs to: its "domain" field when it is a real domain, else the domain of the sender address ("email", then "sender").
// Records that did not end in a delivery often come with an empty "domain" and the sender only in "email".
const DOMAIN_LIKE = /^(?=.{3,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/i;
const senderDomainOf = (raw) => {
  const field = text(raw.domain).trim().toLowerCase();
  if (DOMAIN_LIKE.test(field)) return field;
  for (const candidate of [raw.email, raw.sender]) {
    const value = text(candidate).trim().toLowerCase();
    const at = value.lastIndexOf('@');
    if (at > 0 && DOMAIN_LIKE.test(value.slice(at + 1))) return value.slice(at + 1);
  }
  return '';
};

const periodSeconds = (value) => {
  const key = value === undefined || value === '' ? '24h' : String(value);
  if (!PERIODS[key]) throw new SentError('Escolha um período entre 24 horas, 3, 7, 30, 60 ou 90 dias.', 'SPFBL_SENT_PERIOD', 422);
  return { key, seconds: PERIODS[key] };
};
const parseFilters = (query = {}) => {
  const period = periodSeconds(query.period);
  const status = query.status === undefined || query.status === '' ? 'all' : String(query.status);
  if (!(status in STATUS_FILTERS)) throw new SentError('Escolha um resultado válido.', 'SPFBL_SENT_STATUS', 422);
  const by = query.by === undefined || query.by === '' ? 'any' : String(query.by);
  if (!['any', 'sender', 'recipient'].includes(by)) throw new SentError('Escolha se a busca é por remetente ou destinatário.', 'SPFBL_SENT_BY', 422);
  const q = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  if (q.length > MAX_QUERY) throw new SentError(`A busca aceita até ${MAX_QUERY} caracteres.`, 'SPFBL_SENT_QUERY', 422);
  return { period: period.key, seconds: period.seconds, status, by, q };
};
const parsePageSize = (value) => {
  if (value === undefined || value === '') return PAGE_SIZES[0];
  const size = Number(value);
  if (!PAGE_SIZES.includes(size)) throw new SentError('Escolha 20, 40 ou 100 resultados por página.', 'SPFBL_FILTER_PAGE_SIZE', 422);
  return size;
};

// Tests replace createClient here, as they do for the domain sync.
const internals = { createClient: (credentials) => new WhmClient(credentials) };

// A stored row, in the shape the page uses. The result text is worked out again on every read, so an improved translation of the server's
// answers also applies to what was stored earlier.
const publicRow = (row, withServer) => {
  const detail = row.detail && typeof row.detail === 'object' ? row.detail : {};
  const result = classifyResult(row.event_type, detail.message);
  const sentUnix = Math.floor(new Date(row.sent_at).getTime() / 1000);
  return {
    id: row.record_key, type: row.event_type, event: EVENT_LABELS[row.event_type], sender_domain: row.sender_domain,
    action_unix: Math.floor(new Date(row.action_at).getTime() / 1000), sent_at: new Date(row.sent_at).toISOString(), sent_unix: sentUnix,
    sender: row.sender, recipient: row.recipient, delivered_to: row.delivered_to,
    result: { key: result.key, label: result.label, tone: result.tone, code: result.code }, detail,
    ...(withServer ? { server: row.server_name } : {})
  };
};

const createService = ({ credentialsFor, serverIdOf, serverIdsOf, allServers, createClient = (credentials) => internals.createClient(credentials), now = Date.now, store = defaultStore, retentionDays = async () => 30 } = {}) => {
  const running = new Map();
  const lastRead = new Map();

  // Reads one window of one server and stores what is a sent-mail line. Returns what the server answered, for the diagnostics.
  const readWindow = async (client, serverId, sinceUnix, untilUnix) => {
    const { records: raw, truncated, stats = [] } = await client.emailTrack({ sinceUnix, untilUnix, maxPerKind: MAX_PER_KIND });
    const returned = {};
    const sources = {};
    const records = [];
    let otherType = 0;
    for (const item of raw) {
      returned[item?.type] = (returned[item?.type] || 0) + 1;
      const name = senderDomainOf(item || {}) || '(sistema)';
      sources[name] = (sources[name] || 0) + 1;
      const record = normalizeRecord(item);
      if (record) records.push(record); else otherType += 1;
    }
    const stored = await store.upsert(serverId, records);
    return { returned, sources, other_type: otherType, calls: stats, truncated, partial: stats.some((stat) => stat.error), stored };
  };

  // Brings one server up to date: from the last collection (with an overlap) to now, in windows of a day. The first collection goes back
  // up to BACKFILL_DAYS (never beyond the retention). A window that fails stops the run and keeps the progress made so far.
  const collectNow = async (serverId, { backfill = false } = {}) => {
    const nowSec = Math.floor(now() / 1000);
    const state = await store.getState(serverId);
    const retention = await retentionDays();
    const floor = nowSec - Math.min(retention, BACKFILL_DAYS) * 86400;
    let from = state.through ? Math.max(floor, state.through - OVERLAP_SECONDS) : floor;
    if (!backfill && !state.through) from = nowSec - 86400;
    const client = createClient(await credentialsFor(serverId));
    const total = { returned: {}, sources: {}, other_type: 0, calls: [], truncated: false, partial: false, stored: 0, windows: 0 };
    let through = state.through;
    let failure = null;
    while (from < nowSec) {
      const until = Math.min(nowSec + 60, from + WINDOW_SECONDS);
      try {
        const part = await readWindow(client, serverId, from, until);
        for (const [type, n] of Object.entries(part.returned)) total.returned[type] = (total.returned[type] || 0) + n;
        for (const [name, n] of Object.entries(part.sources)) total.sources[name] = (total.sources[name] || 0) + n;
        total.other_type += part.other_type; total.calls.push(...part.calls); total.truncated = total.truncated || part.truncated; total.partial = total.partial || part.partial;
        total.stored += part.stored; total.windows += 1;
        through = Math.min(until, nowSec);
        // The server filters with "after" and "before" (both exclusive): the next window starts one second earlier so a line on the boundary is not lost.
        from = until - 1;
        await store.markCollected(serverId, through);
      } catch (error) { failure = error; break; }
    }
    await store.prune(retention);
    lastRead.set(serverId, { at: new Date(now()).toISOString(), ...total, error: failure ? String(failure.code || 'internal_error').slice(0, 60) : null });
    if (failure && total.windows === 0) throw failure;
    return { ...total, failed: Boolean(failure) };
  };

  // One collection per server at a time: a page load during a scheduled run waits for it instead of starting another.
  const collect = (serverId, options) => {
    if (running.has(serverId)) return running.get(serverId);
    const promise = collectNow(serverId, options).finally(() => running.delete(serverId));
    running.set(serverId, promise);
    return promise;
  };

  // A page load: top up the servers that matter when their data is older than TOP_UP_MS. A server never collected is collected in the
  // background (it can take a while), and a failure only marks the answer as partial: what is stored is still shown.
  const refresh = async (serverIds) => {
    const outcome = { failed: [], collecting: false, last_run_at: null };
    await Promise.all([...serverIds].map(async (serverId) => {
      try {
        const state = await store.getState(serverId);
        if (state.lastRunAt && (!outcome.last_run_at || state.lastRunAt > outcome.last_run_at)) outcome.last_run_at = state.lastRunAt;
        if (!state.through) { collect(serverId, { backfill: true }).catch(() => {}); outcome.collecting = true; return; }
        if (now() - state.through * 1000 < TOP_UP_MS) return;
        await collect(serverId);
      } catch (error) { outcome.failed.push({ id: serverId, code: String(error?.code || 'internal_error').slice(0, 60) }); }
    }));
    return outcome;
  };

  // `domain` is one domain of the scope, or ALL ("todos os domínios"). For all of them: the Super Admin gets everything every WHM server
  // reports (system mail included); any other account gets the mail of the domains of its scope.
  const search = async ({ domain, scope = [], admin = false, query = {}, diagnostics = false }) => {
    const filters = parseFilters(query);
    const pageSize = parsePageSize(query.page_size);
    let serverIds;
    let names = new Map();
    if (domain === ALL) {
      const targets = admin ? await allServers() : [...(await serverIdsOf(scope))].map((id) => ({ id, name: id }));
      if (targets.length === 0) throw new SentError('Nenhum servidor WHM cadastrado para consultar os e-mails enviados.', 'SPFBL_SENT_NO_SERVER', 409);
      serverIds = targets.map((target) => target.id);
      names = new Map(targets.map((target) => [target.id, target.name]));
    } else {
      const serverId = await serverIdOf(domain);
      if (!serverId) throw new SentError('Este domínio está sem servidor WHM cadastrado: não há como consultar os e-mails enviados.', 'SPFBL_SENT_NO_SERVER', 409);
      serverIds = [serverId];
    }
    const refreshed = await refresh(serverIds);
    const retention = await retentionDays();
    const sinceUnix = Math.floor(now() / 1000) - Math.min(filters.seconds, retention * 86400);
    const wanted = STATUS_FILTERS[filters.status];
    const found = await store.search({
      serverIds, domains: domain === ALL ? (admin ? null : scope) : [domain], sinceUnix, types: wanted, q: filters.q, by: filters.by,
      page: Math.floor(Number(query.page)) || 1, pageSize });
    const reads = serverIds.map((id) => lastRead.get(id)).filter(Boolean);
    const stale = refreshed.failed.length;
    // Every server failed to bring its data up to date and nothing is stored yet: say why instead of an empty list.
    return {
      filters: { period: filters.period, status: filters.status, by: filters.by, q: filters.q },
      rows: found.rows.map((row) => publicRow(row, admin && domain === ALL)), filtered_total: found.filtered, period_total: found.period,
      page: found.page, pages: found.pages, page_size: pageSize, retention_days: retention,
      truncated: reads.some((read) => read.truncated), partial: reads.some((read) => read.partial) || stale > 0, collecting: refreshed.collecting,
      last_run_at: refreshed.last_run_at, servers_failed: stale,
      ...(admin ? { servers_failed_names: refreshed.failed.map((failure) => ({ name: names.get(failure.id) || failure.id, code: failure.code })) } : {}),
      ...(diagnostics ? { diagnostics: {
        returned: reads.reduce((sum, read) => { for (const [k, n] of Object.entries(read.returned)) sum[k] = (sum[k] || 0) + n; return sum; }, {}),
        other_type: reads.reduce((sum, read) => sum + read.other_type, 0),
        calls: reads.flatMap((read) => read.calls),
        sources: reads.reduce((sum, read) => { for (const [k, n] of Object.entries(read.sources)) sum[k] = (sum[k] || 0) + n; return sum; }, {}),
        stored_period: found.period, collected_at: reads.map((read) => read.at).sort().at(-1) || null } } : {})
    };
  };

  return { search, collect, refresh };
};

module.exports = { internals, SentError, classifyResult, normalizeRecord, parseFilters, parsePageSize, createService, publicRow, PERIODS, PAGE_SIZES, MAX_PER_KIND, ALL, TOP_UP_MS, EVENT_LABELS };
