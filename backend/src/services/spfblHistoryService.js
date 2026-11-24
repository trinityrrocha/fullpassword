const crypto = require('node:crypto');

// Port of Rules.php, History.php and Overview.php of the original PHP SPFBL portal.
// The provider history is kept ONLY in memory (never persisted): it holds every domain of the Matrix account, so every
// read is filtered by the caller's current domains (exact match) before anything leaves this module.
const TIMEZONE = 'America/Sao_Paulo';
const PAGE_SIZE = 25;
const MAX_PERIOD_DAYS = 90;
const EXTRA_PAGES = 10;            // first page + 10 more, like the original portal
const MAX_ROWS = 20000;
const TTL_MS = 10 * 60 * 1000;
const MIN_ADVANCE_MS = 2000;
const REFRESH_MIN_MS = 60 * 1000;
const RETRY_AFTER_ERROR_MS = 15 * 1000;
const SAFE_ERRORS = new Set(['MatrixError', 'HistoryError']);

class HistoryError extends Error {
  constructor(message, code, statusCode = 422, field) {
    super(message);
    this.name = 'HistoryError';
    this.code = code;
    this.statusCode = statusCode;
    if (field) this.field = field;
  }
}

// Product compatibility rule; not an interpretation of SPFBL delivery semantics.
const classify = (result) => {
  switch (String(result || '').toUpperCase()) {
    case 'BANNED': case 'FLAG': return { status: 'Bloqueados', reason: 'Rejeitada por banimento', category: 'banimento', icon: 'banned' };
    case 'BLOCK': case 'REJECT': return { status: 'Bloqueados', reason: 'Rejeitada por segurança', category: 'segurança', icon: 'security' };
    case 'INEXISTENT': case 'GREYLIST': return { status: 'Bloqueados', reason: 'Rejeitada por inexistência', category: 'inexistência', icon: 'inexistent' };
    default: return { status: 'Livres', reason: 'Aceita pelo filtro', category: null, icon: '' };
  }
};

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const normalizeDomain = (value) => {
  const domain = String(value ?? '').trim().toLowerCase();
  if (domain.length > 253 || !DOMAIN_RE.test(domain)) throw new HistoryError('Informe um domínio completo, sem @. Para IDN, use Punycode.', 'SPFBL_DOMAIN_INVALID', 422, 'domain');
  return domain;
};
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const normalizeEmail = (value) => {
  if (typeof value !== 'string') return '';
  const email = value.trim();
  if (email.length > 254 || !EMAIL_RE.test(email) || email.startsWith('.') || email.includes('..')) return '';
  const at = email.lastIndexOf('@');
  if (email.slice(0, at).length > 64 || email.slice(0, at).endsWith('.')) return '';
  try { normalizeDomain(email.slice(at + 1)); } catch { return ''; }
  return email.toLowerCase();
};
const emailDomain = (email) => email.slice(email.lastIndexOf('@') + 1);
const belongs = (recipient, domain) => { const email = normalizeEmail(recipient); return email !== '' && emailDomain(email) === domain; };

// "arrival" must carry an explicit zone. ISO and RFC 2822 forms are accepted by Date; "YYYY-MM-DD HH:MM:SS +0000" is
// rewritten to ISO first. Anything else is rejected (the row is skipped and coverage becomes partial).
const ZONE_RE = /\d.*(?:[+-]\d{4}|Z|[+-]\d{2}:\d{2}|GMT|UTC)$/;
const parseArrival = (value) => {
  if (typeof value !== 'string' || !ZONE_RE.test(value)) return null;
  const spaced = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) ?(Z|[+-]\d{2}:?\d{2})$/.exec(value.trim());
  const text = spaced ? `${spaced[1]}T${spaced[2]}${/^[+-]\d{4}$/.test(spaced[3]) ? `${spaced[3].slice(0, 3)}:${spaced[3].slice(3)}` : spaced[3]}` : value;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

const text254 = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HistoryError('Campo Matrix inválido.', 'SPFBL_MATRIX_FIELD_INVALID', 503);
  return [...value].slice(0, 254).join('');
};

// Records without supplier identity are excluded (never a synthetic key): coverage then becomes partial.
const normalizeRecord = (raw, integration) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HistoryError('Registro Matrix inválido.', 'SPFBL_MATRIX_RECORD_INVALID', 503);
  const recipient = normalizeEmail(raw.recipient);
  if (!recipient) return null;
  const timestamp = parseArrival(raw.arrival);
  if (timestamp === null) return null;
  const key = raw.key ?? raw.timekey;
  if ((typeof key !== 'string' && typeof key !== 'number') || String(key) === '' || String(key).length > 128) return null;
  const row = {
    id: crypto.createHash('sha256').update(`${integration}\0${String(key)}\0${recipient}`).digest('hex'),
    provider_key: String(key), recipient, timestamp
  };
  for (const field of ['sender', 'from', 'replyto', 'result']) row[field] = text254(raw[field]);
  row.provider_status = ['WHITELISTED', 'BLOCKED', 'NONE'].includes(raw.status) ? raw.status : 'UNKNOWN';
  return row;
};

// ---- time zone ------------------------------------------------------------------------------------------------
const zoneParts = (ms, timezone = TIMEZONE) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return parts;
};
const offsetMs = (ms, timezone) => { const p = zoneParts(ms, timezone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
// Midnight of y-m-d in the zone, as epoch seconds.
const zonedMidnight = (year, month, day, timezone = TIMEZONE) => {
  const guess = Date.UTC(year, month - 1, day);
  let ms = guess - offsetMs(guess, timezone);
  ms = guess - offsetMs(ms, timezone);
  return Math.floor(ms / 1000);
};
const ymd = (seconds, timezone = TIMEZONE) => { const p = zoneParts(seconds * 1000, timezone); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const addDays = (value, days) => { const [y, m, d] = value.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
const midnightOf = (value) => { const [y, m, d] = value.split('-').map(Number); return zonedMidnight(y, m, d); };
const validYmd = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const parseFilters = (input = {}, now = Date.now()) => {
  const today = ymd(Math.floor(now / 1000));
  const f = { status: 'Bloqueados', by: 'sender', email: '', start: addDays(today, -6), end: today };
  for (const key of Object.keys(f)) if (input[key] !== undefined && input[key] !== '') f[key] = input[key];
  if (Object.values(f).some((v) => typeof v !== 'string')) throw new HistoryError('Filtro inválido.', 'SPFBL_FILTER_INVALID');
  if (!['Todos', 'Livres', 'Bloqueados', 'Desbloqueados'].includes(f.status) || !['sender', 'recipient'].includes(f.by)) throw new HistoryError('Filtro inválido.', 'SPFBL_FILTER_INVALID');
  f.email = f.email.trim();
  if (f.email !== '' && normalizeEmail(f.email) === '') throw new HistoryError('Informe um endereço de e-mail completo.', 'SPFBL_FILTER_EMAIL', 422, 'email');
  for (const key of ['start', 'end']) if (!validYmd(f[key])) throw new HistoryError('Informe uma data válida.', 'SPFBL_FILTER_DATE', 422, key);
  f.start_ts = midnightOf(f.start);
  f.end_ts = midnightOf(addDays(f.end, 1));
  if (f.start_ts >= f.end_ts || f.end_ts - f.start_ts > MAX_PERIOD_DAYS * 86400 || f.end > today) throw new HistoryError('Escolha até 90 dias, sem datas futuras.', 'SPFBL_FILTER_PERIOD', 422, 'start');
  return f;
};

// Rows of ONE authorized domain (exact recipient domain match), filtered, newest first, 25 per page.
const selectRows = (rows, domain, filters, page = 1, { unlocked = new Set() } = {}) => {
  const period = rows.filter((r) => belongs(r.recipient, domain) && r.timestamp >= filters.start_ts && r.timestamp < filters.end_ts);
  const wanted = filters.email ? normalizeEmail(filters.email) : '';
  const fields = filters.by === 'recipient' ? ['recipient'] : ['sender', 'from', 'replyto'];
  const filtered = period.filter((r) => {
    // "Desbloqueados": released through this portal (latest event is an unlock) or reported WHITELISTED by the provider.
    if (filters.status === 'Desbloqueados') { if (!(unlocked.has(r.id) || r.provider_status === 'WHITELISTED')) return false; }
    else if (filters.status !== 'Todos' && classify(r.result).status !== filters.status) return false;
    return !wanted || fields.some((field) => normalizeEmail(r[field]) === wanted);
  }).sort((a, b) => (b.timestamp - a.timestamp) || (a.id < b.id ? -1 : 1));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  return { rows: filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), period: period.length, filtered: filtered.length, page: current, pages };
};

// What leaves the server: no provider key, only what the screens show.
const publicRow = (row, release = null) => {
  const c = classify(row.result);
  const current = release || (row.provider_status === 'WHITELISTED' ? { state: 'unlocked', at: null, by: null } : null);
  return { release: current ? { state: current.state, at: current.at, by: current.by } : null, provider_status: row.provider_status, id: row.id, timestamp: row.timestamp, sender: row.sender, from: row.from, replyto: row.replyto, recipient: row.recipient,
    status: c.status, reason: c.reason, icon: c.icon, result: row.result };
};

const buildOverview = (rows, domains, now = Date.now()) => {
  const allowed = new Set(domains);
  const period = parseFilters({}, now);
  const categories = { banimento: 0, 'segurança': 0, 'inexistência': 0 };
  const byDomain = {}; const byRecipient = {};
  let total = 0;
  for (const r of rows) {
    const domain = emailDomain(r.recipient);
    if (!allowed.has(domain) || r.timestamp < period.start_ts || r.timestamp >= period.end_ts) continue;
    total += 1;
    const { category } = classify(r.result);
    if (!category) continue;
    categories[category] += 1;
    byDomain[domain] = (byDomain[domain] || 0) + 1;
    byRecipient[r.recipient] = (byRecipient[r.recipient] || 0) + 1;
  }
  const rank = (values) => Object.entries(values).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([name, count]) => ({ name, count }));
  return { categories, domains: rank(byDomain), recipients: rank(byRecipient), total, blocked: Object.values(categories).reduce((a, b) => a + b, 0),
    period: { start: period.start, end: period.end, timezone: TIMEZONE } };
};

// Per-domain results for the Super Admin overview: every REGISTERED domain appears (even with no records), counted over the same
// 7-day window as the dashboard. Records of domains that are not in the catalogue are ignored.
const buildDomainsOverview = (rows, catalogue, now = Date.now()) => {
  const period = parseFilters({}, now);
  const byName = new Map(catalogue.map((d) => [d.name, { domain: d.name, active: d.active, source: d.source, total: 0, blocked: 0, banimento: 0, 'segurança': 0, 'inexistência': 0 }]));
  for (const r of rows) {
    if (r.timestamp < period.start_ts || r.timestamp >= period.end_ts) continue;
    const entry = byName.get(emailDomain(r.recipient));
    if (!entry) continue;
    entry.total += 1;
    const { category } = classify(r.result);
    if (category) { entry[category] += 1; entry.blocked += 1; }
  }
  const list = [...byName.values()].sort((a, b) => (b.blocked - a.blocked) || (b.total - a.total) || (a.domain < b.domain ? -1 : 1));
  const totals = list.reduce((t, d) => ({ total: t.total + d.total, blocked: t.blocked + d.blocked }), { total: 0, blocked: 0 });
  return { domains: list, totals, period: { start: period.start, end: period.end, timezone: TIMEZONE }, start_ts: period.start_ts, end_ts: period.end_ts };
};

// ---- staged in-memory history -----------------------------------------------------------------------------------
const emptyState = () => ({ rows: [], next: null, pages: 0, signatures: [], cursors: [], updated: 0, started: 0, last: 0, partial: false, done: false, error: '' });

const merge = (state, page, extra = EXTRA_PAGES) => {
  const s = { ...state, signatures: [...state.signatures], cursors: [...state.cursors] };
  if (s.signatures.includes(page.signature)) { s.partial = true; s.done = true; return s; }
  s.signatures.push(page.signature);
  if (s.next !== null) s.cursors.push(s.next);
  const byId = new Map(s.rows.map((r) => [r.id, r]));
  for (const row of page.rows) if (!byId.has(row.id)) byId.set(row.id, row);
  s.rows = [...byId.values()];
  s.pages += 1;
  s.next = page.next;
  s.partial = s.partial || page.skipped;
  if (s.next === null) s.done = true;
  else if (s.pages >= 1 + extra || s.cursors.includes(s.next) || s.rows.length >= MAX_ROWS) { s.done = true; s.partial = true; }
  return s;
};

// fetchPage(cursor, context) -> { messages, next, signature }; integration identifies the Matrix account (hash, never the user).
const createHistoryStore = ({ fetchPage, now = Date.now } = {}) => {
  let state = emptyState();
  let integration = null;
  let pending = null;
  // After a reset (an unlock changed provider statuses) the rows of the previous load stay readable for record lookups only,
  // so a screen the person is on does not turn into "registro indisponível" the moment its action succeeds.
  let retired = { rows: [], at: 0, integration: null };
  const fresh = (current) => (integration === current && state.started && now() - state.started <= TTL_MS ? state : emptyState());

  const advance = async (currentIntegration, { refresh = false, context } = {}) => {
    if (pending) return pending;
    pending = (async () => {
      if (integration !== currentIntegration) { state = emptyState(); integration = currentIntegration; }
      state = fresh(currentIntegration);
      // A failed load is not cached for the whole TTL: a corrected password or a recovered provider is picked up shortly.
      if (state.error && now() - state.last >= RETRY_AFTER_ERROR_MS) state = emptyState();
      if (refresh && now() - state.started >= REFRESH_MIN_MS) state = emptyState();
      if (state.done || now() - state.last < MIN_ADVANCE_MS) return state;
      const next = { ...state, last: now() };
      if (!next.started) next.started = now();
      try {
        const page = await fetchPage(next.next, context);
        const rows = []; let skipped = false;
        for (const raw of page.messages) { const row = normalizeRecord(raw, currentIntegration); if (row) rows.push(row); else skipped = true; }
        state = merge(next, { rows, next: page.next, skipped, signature: page.signature });
        state.updated = now();
      } catch (error) {
        state = { ...next, partial: true, done: true, error: SAFE_ERRORS.has(error?.name) && error.message ? String(error.message).slice(0, 300) : 'Falha ao consultar o histórico.' };
      }
      return state;
    })().finally(() => { pending = null; });
    return pending;
  };
  const snapshot = (currentIntegration) => fresh(currentIntegration);
  const find = (currentIntegration, id, domain) => {
    const match = (r) => r.id === id && belongs(r.recipient, domain);
    const current = fresh(currentIntegration).rows.find(match);
    if (current) return current;
    return retired.integration === currentIntegration && now() - retired.at <= TTL_MS ? retired.rows.find(match) || null : null;
  };
  // Drops the loaded history so the next read starts over; keepRetired=true keeps the old rows for find() only.
  const reset = ({ keepRetired = false } = {}) => {
    retired = keepRetired && integration ? { rows: state.rows, at: now(), integration } : { rows: [], at: 0, integration: null };
    state = emptyState(); integration = null; pending = null;
  };
  return { advance, snapshot, find, reset };
};

const stateView = (state, now = Date.now()) => ({ loading: !state.done, pages: state.pages, partial: state.partial, error: state.error || '',
  updated_at: state.updated ? new Date(state.updated).toISOString() : null, rows: state.rows.length, now });

module.exports = { HistoryError, TIMEZONE, PAGE_SIZE, classify, normalizeDomain, normalizeEmail, emailDomain, belongs, parseArrival, normalizeRecord,
  zonedMidnight, parseFilters, selectRows, publicRow, buildOverview, buildDomainsOverview, merge, createHistoryStore, stateView, emptyState };
