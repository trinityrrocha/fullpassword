const { WhmClient } = require('./spfblWhmClient');

// "Enviados": the mail SENT by a domain, read live from the WHM server that hosts it (emailtrack_search). Nothing is stored: recipient
// addresses stay on the server and only travel to the page that asked. One server answer is kept for a short time so that paging and
// filtering do not call the WHM again. Scope (which domains a person may see) is decided by the controller, before this is called.
const TTL_MS = 60 * 1000;
const MAX_CACHE = 50;
// Per kind of call (delivered / problems): the read stops there and the page says there may be more.
const MAX_PER_KIND = 5000;
const ALL = 'all';
const PERIODS = Object.freeze({ '24h': 24 * 3600, '3d': 3 * 86400, '7d': 7 * 86400, '30d': 30 * 86400 });
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
  if (!PERIODS[key]) throw new SentError('Escolha um período entre 24 horas, 3, 7 ou 30 dias.', 'SPFBL_SENT_PERIOD', 422);
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

const createService = ({ credentialsFor, serverIdOf, serverIdsOf, allServers, createClient = (credentials) => internals.createClient(credentials), now = Date.now } = {}) => {
  const cache = new Map();
  const inFlight = new Map();

  // What one WHM server answered for a period (every domain of the server), shared for a minute. The period start is rounded to 5 minutes
  // so that repeated page loads use the same entry. One domain or all of them share this same read: the choice is made afterwards, here.
  const fetchServer = async (serverId, seconds) => {
    const nowSec = Math.floor(now() / 1000);
    const until = Math.ceil((nowSec + 1) / 300) * 300;
    const since = Math.floor((nowSec - seconds) / 300) * 300;
    const key = `${serverId}|${since}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return { ...hit, cached: true };
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = (async () => {
      const { records: raw, truncated, stats = [] } = await createClient(await credentialsFor(serverId)).emailTrack({ sinceUnix: since, untilUnix: until, maxPerKind: MAX_PER_KIND });
      const counts = {};
      for (const record of raw) counts[record?.type] = (counts[record?.type] || 0) + 1;
      const sources = {};
      for (const record of raw) { const name = senderDomainOf(record || {}) || '(sistema)'; sources[name] = (sources[name] || 0) + 1; }
      const diagnostics = { returned: counts, other_type: 0, other_domain: 0, out_of_period: 0, calls: stats, sources };
      const records = [];
      const seen = new Set();
      for (const item of raw) {
        const record = normalizeRecord(item);
        if (!record) { diagnostics.other_type += 1; continue; }
        // In the period when it was sent OR when it was last attempted (a message deferred days ago and retried now still counts).
        const inPeriod = (record.sent_unix > since && record.sent_unix < until) || (record.action_unix > since && record.action_unix < until);
        if (!inPeriod) { diagnostics.out_of_period += 1; continue; }
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        records.push(record);
      }
      const entry = { at: now(), records, truncated, partial: stats.some((stat) => stat.error), diagnostics, fetched_at: new Date(now()).toISOString() };
      cache.set(key, entry);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      return { ...entry, cached: false };
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };

  const sumDiagnostics = (parts) => {
    const total = { returned: {}, other_type: 0, other_domain: 0, out_of_period: 0, calls: [], sources: {} };
    for (const part of parts) {
      for (const [type, n] of Object.entries(part.returned || {})) total.returned[type] = (total.returned[type] || 0) + n;
      total.other_type += part.other_type; total.other_domain += part.other_domain; total.out_of_period += part.out_of_period;
      total.calls.push(...(part.calls || []));
      for (const [name, n] of Object.entries(part.sources || {})) total.sources[name] = (total.sources[name] || 0) + n;
    }
    return total;
  };

  // `domain` is one domain of the scope, or ALL ("todos os domínios"). For all of them: the Super Admin gets everything every WHM server
  // reports (system mail included); any other account gets the mail of the domains of its scope, from the servers that host them.
  const search = async ({ domain, scope = [], admin = false, query = {}, diagnostics = false }) => {
    const filters = parseFilters(query);
    const pageSize = parsePageSize(query.page_size);
    let parts;
    let failures = [];
    if (domain === ALL) {
      const targets = admin ? await allServers() : [...(await serverIdsOf(scope))].map((id) => ({ id, name: id }));
      if (targets.length === 0) throw new SentError('Nenhum servidor WHM cadastrado para consultar os e-mails enviados.', 'SPFBL_SENT_NO_SERVER', 409);
      const settled = await Promise.allSettled(targets.map((server) => fetchServer(server.id, filters.seconds)));
      parts = []; failures = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') parts.push({ ...result.value, server: targets[index].name });
        else failures.push({ name: targets[index].name, code: String(result.reason?.code || 'internal_error').slice(0, 60), error: result.reason });
      });
      // Nothing came back from any server: say why (a refused token, a timeout) instead of an empty list.
      if (parts.length === 0) throw failures[0].error;
    } else {
      const serverId = await serverIdOf(domain);
      if (!serverId) throw new SentError('Este domínio está sem servidor WHM cadastrado: não há como consultar os e-mails enviados.', 'SPFBL_SENT_NO_SERVER', 409);
      const read = await fetchServer(serverId, filters.seconds);
      // One domain: the read holds every domain of the server, so the others are set aside here (and counted for the diagnostics).
      const mine = read.records.filter((record) => record.sender_domain === domain);
      parts = [{ ...read, records: mine, diagnostics: { ...read.diagnostics, other_domain: read.records.length - mine.length }, server: null }];
    }
    const scopeSet = new Set(scope);
    const seen = new Set();
    const all = [];
    for (const part of parts) {
      for (const record of part.records) {
        if (domain === ALL && !admin && !scopeSet.has(record.sender_domain)) continue;
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        all.push(part.server ? { ...record, server: part.server } : record);
      }
    }
    const wanted = STATUS_FILTERS[filters.status];
    const matches = (record) => {
      if (wanted && !wanted.includes(record.type)) return false;
      if (!filters.q) return true;
      const sender = record.sender.toLowerCase();
      const recipient = record.recipient.toLowerCase();
      return filters.by === 'sender' ? sender.includes(filters.q) : filters.by === 'recipient' ? recipient.includes(filters.q) : (sender.includes(filters.q) || recipient.includes(filters.q));
    };
    const rows = all.filter(matches).sort((a, b) => b.sent_unix - a.sent_unix || (a.id < b.id ? 1 : -1));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(pages, Math.max(1, Math.floor(Number(query.page)) || 1));
    return {
      filters: { period: filters.period, status: filters.status, by: filters.by, q: filters.q },
      rows: rows.slice((page - 1) * pageSize, page * pageSize), filtered_total: rows.length, period_total: all.length,
      page, pages, page_size: pageSize, truncated: parts.some((part) => part.truncated), partial: parts.some((part) => part.partial), fetched_at: parts.map((part) => part.fetched_at).sort().at(-1), cached: parts.every((part) => part.cached),
      servers_failed: failures.length,
      // Names of the servers that did not answer (a label the Super Admin typed), and counts only of what was returned: never addresses.
      ...(admin ? { servers_failed_names: failures.map((failure) => ({ name: failure.name, code: failure.code })) } : {}),
      ...(diagnostics ? { diagnostics: sumDiagnostics(parts.map((part) => part.diagnostics)) } : {})
    };
  };

  return { search, fetchServer };
};

module.exports = { internals, SentError, classifyResult, normalizeRecord, parseFilters, parsePageSize, createService, PERIODS, PAGE_SIZES, MAX_PER_KIND, ALL, TTL_MS, EVENT_LABELS };
