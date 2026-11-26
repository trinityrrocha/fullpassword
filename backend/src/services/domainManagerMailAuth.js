const crypto = require('node:crypto');
const net = require('node:net');
const { createBudget, QueryBudgetError } = require('./domainManagerDns');

// SPF, DMARC and DKIM analysis from DNS only. Results carry stable CODES (never display text): the screen translates them.
// Statuses: ok | warning | fail | absent | not_found (DKIM only: "not among the tested selectors") | inconclusive (DNS failed: say nothing).
const MAX_SPF_LOOKUPS = 10;
const MAX_VOID_LOOKUPS = 2;
const MAX_DEPTH = 10;
const MAX_SELECTORS = 60;
const MAX_EXTRA_SELECTORS = 20;
// What one check may probe: the global list plus a domain's own extras, so extras are never silently cut.
const MAX_PROBED_SELECTORS = MAX_SELECTORS + MAX_EXTRA_SELECTORS;
const DKIM_BUDGET = MAX_PROBED_SELECTORS + 5;
const SELECTOR_CONCURRENCY = 5;
const SPF_PREFIX = /^v=spf1(?:\s|$)/i;
const LABEL = '[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?';
const SELECTOR_PATTERN = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`, 'i');
const MECHANISMS = new Set(['all', 'include', 'a', 'mx', 'ptr', 'exists', 'ip4', 'ip6']);
const COUNTED = new Set(['include', 'a', 'mx', 'ptr', 'exists']);

const isValidSelector = (value) => typeof value === 'string' && value.length <= 100 && SELECTOR_PATTERN.test(value);

// ---------- SPF ----------
const analyzeSpf = async (domain, dns, budget, prefetched = null) => {
  // `path` holds only the names on the CURRENT include chain: the same provider included by two branches is legitimate, a name that
  // includes itself (directly or through others) is a loop. The 10-lookup limit bounds the total work.
  const state = { lookups: 0, voids: 0, ipCount: 0, includes: [], errors: new Set(), warnings: new Set(), notes: new Set(), inconclusive: false, path: new Set([domain]), stop: false };
  const memo = new Map();

  const fetchSpf = async (name, known = null) => {
    if (!known && !memo.has(name)) memo.set(name, dns.txt(name, budget));
    const answer = known || await memo.get(name);
    if (answer.state === 'inconclusive') { state.inconclusive = true; return { failed: true }; }
    if (answer.state === 'absent') return { none: true };
    const records = answer.records.filter((record) => SPF_PREFIX.test(record));
    if (records.length === 0) return { none: true };
    if (records.length > 1) return { multiple: true };
    return { record: records[0] };
  };

  const parseTerm = (raw) => {
    let term = raw;
    let qualifier = '+';
    if ('+-~?'.includes(term[0])) { qualifier = term[0]; term = term.slice(1); }
    const mechanism = /^[a-z0-9]+/i.exec(term)?.[0]?.toLowerCase();
    if (!mechanism || !MECHANISMS.has(mechanism)) return null;
    const rest = term.slice(mechanism.length);
    if (rest && rest[0] !== ':' && rest[0] !== '/') return null;
    let arg = rest[0] === ':' ? rest.slice(1) : '';
    let cidr = null;
    if (mechanism === 'ip4' || mechanism === 'ip6') {
      const [address, length, extra] = arg.split('/');
      if (extra !== undefined) return null;
      const family = mechanism === 'ip4' ? 4 : 6;
      if (net.isIP(address) !== family) return null;
      if (length !== undefined && !(/^\d{1,3}$/.test(length) && Number(length) <= (family === 4 ? 32 : 128))) return null;
      return { qualifier, mechanism, arg: address };
    }
    if (mechanism === 'a' || mechanism === 'mx') {
      const match = /^(.*?)(?:\/(\d{1,2}))?(?:\/\/(\d{1,3}))?$/.exec(rest[0] === ':' ? arg : rest);
      if (!match || (match[2] !== undefined && Number(match[2]) > 32) || (match[3] !== undefined && Number(match[3]) > 128)) return null;
      if (rest[0] !== ':' && match[1]) return null;
      if (match[1].includes('/')) return null;
      arg = rest[0] === ':' ? match[1] : '';
      cidr = match[2] ?? null;
    }
    if ((mechanism === 'include' || mechanism === 'exists') && !arg) return null;
    if (mechanism === 'all' && rest) return null;
    return { qualifier, mechanism, arg, cidr };
  };

  // Returns the `all` qualifier that decides the record (following a redirect).
  const evaluate = async (name, record, depth) => {
    let all = null;
    let sawAll = false;
    let redirect = null;
    for (const raw of record.trim().split(/\s+/).slice(1)) {
      if (!raw) continue;
      const modifier = /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(raw);
      if (modifier) {
        const key = modifier[1].toLowerCase();
        if (key === 'redirect') { if (redirect !== null) state.errors.add('SPF_SYNTAX'); redirect = modifier[2]; }
        continue;
      }
      const parsed = parseTerm(raw);
      if (!parsed) { state.errors.add('SPF_SYNTAX'); continue; }
      if (sawAll) { state.warnings.add('SPF_TEXT_AFTER_ALL'); continue; }
      const { qualifier, mechanism, arg } = parsed;
      if (mechanism === 'all') { sawAll = true; all = `${qualifier}all`; continue; }
      if (mechanism === 'ip4' || mechanism === 'ip6') { state.ipCount += 1; continue; }
      if (COUNTED.has(mechanism)) {
        state.lookups += 1;
        if (state.lookups > MAX_SPF_LOOKUPS) { state.errors.add('SPF_TOO_MANY_LOOKUPS'); state.stop = true; }
      }
      if (state.stop) continue;
      const macro = arg.includes('%');
      if (mechanism === 'ptr') { state.warnings.add('SPF_PTR'); continue; }
      if (mechanism === 'include') {
        const target = arg.toLowerCase().replace(/\.$/, '');
        if (depth === 0) state.includes.push(target);
        if (macro) continue;
        if (state.path.has(target)) { state.errors.add('SPF_LOOP'); continue; }
        if (depth + 1 > MAX_DEPTH) { state.errors.add('SPF_TOO_DEEP'); continue; }
        const found = await fetchSpf(target);
        if (found.failed) continue;
        if (found.none) { state.errors.add('SPF_INCLUDE_NO_RECORD'); continue; }
        if (found.multiple) { state.errors.add('SPF_MULTIPLE'); continue; }
        state.path.add(target);
        try { await evaluate(target, found.record, depth + 1); } finally { state.path.delete(target); }
        continue;
      }
      if (mechanism === 'a' || mechanism === 'mx') {
        if (macro) continue;
        const target = (arg || name).toLowerCase().replace(/\.$/, '');
        if (mechanism === 'mx') {
          const answer = await dns.mx(target, budget);
          if (answer.state === 'absent') state.voids += 1; else if (answer.state === 'inconclusive') state.inconclusive = true;
        } else {
          let answer = await dns.a(target, budget);
          if (answer.state === 'absent') answer = await dns.aaaa(target, budget);
          if (answer.state === 'absent') state.voids += 1; else if (answer.state === 'inconclusive') state.inconclusive = true;
        }
      }
    }
    if (redirect !== null && !sawAll) {
      state.lookups += 1;
      if (state.lookups > MAX_SPF_LOOKUPS) { state.errors.add('SPF_TOO_MANY_LOOKUPS'); state.stop = true; return all; }
      const target = redirect.toLowerCase().replace(/\.$/, '');
      if (!redirect || redirect.includes('%')) return all;
      if (state.path.has(target)) { state.errors.add('SPF_LOOP'); return all; }
      if (depth + 1 > MAX_DEPTH) { state.errors.add('SPF_TOO_DEEP'); return all; }
      const found = await fetchSpf(target);
      if (found.failed) return all;
      if (found.none) { state.errors.add('SPF_INCLUDE_NO_RECORD'); return all; }
      if (found.multiple) { state.errors.add('SPF_MULTIPLE'); return all; }
      state.path.add(target);
      try { return await evaluate(target, found.record, depth + 1); } finally { state.path.delete(target); }
    }
    return all;
  };

  let result;
  try {
    const first = await fetchSpf(domain, prefetched);
    if (first.failed) return { status: 'inconclusive' };
    if (first.none) return { status: 'absent' };
    if (first.multiple) return { status: 'fail', errors: ['SPF_MULTIPLE'], warnings: [], notes: [], lookups: 0, void_lookups: 0, ip_count: 0, includes: [], all: null, record: null };
    const all = await evaluate(domain, first.record, 0);
    if (all === null) state.warnings.add('SPF_NO_ALL');
    if (all === '+all') state.errors.add('SPF_ALL_PLUS');
    if (all === '?all') state.warnings.add('SPF_NEUTRAL_ALL');
    if (all === '~all') state.warnings.add('SPF_SOFTFAIL');
    if (state.voids > MAX_VOID_LOOKUPS) state.warnings.add('SPF_VOID_LOOKUPS');
    result = { all, record: first.record.slice(0, 1000) };
  } catch (error) {
    if (!(error instanceof QueryBudgetError)) throw error;
    state.inconclusive = true;
    result = { all: null, record: null };
  }
  const errors = [...state.errors];
  const warnings = [...state.warnings];
  const status = errors.length ? 'fail' : state.inconclusive ? 'inconclusive' : warnings.length ? 'warning' : 'ok';
  return { status, record: result.record, all: result.all, lookups: state.lookups, void_lookups: state.voids, ip_count: state.ipCount, includes: state.includes.slice(0, 20), errors, warnings, notes: [...state.notes] };
};

// ---------- DMARC ----------
const mailtoList = (value) => (typeof value === 'string' ? value : '').split(',').map((item) => item.trim())
  .map((item) => /^mailto:([^?!\s]{3,254})/i.exec(item)?.[1]).filter(Boolean).slice(0, 5);

// Without the public suffix list the organizational domain is unknown, so a name with no DMARC of its own walks up its parents (at most
// 3 queries) and uses the first record found, as a subdomain inherits it (RFC 7489 6.6.3). Two-label names have nothing to inherit from.
const dmarcRecordOf = (answer) => answer.records.filter((record) => /^\s*v=DMARC1\s*(;|$)/i.test(record));
const parentNames = (domain) => {
  const labels = domain.split('.');
  const parents = [];
  for (let index = 1; index < labels.length - 1 && parents.length < 3; index += 1) parents.push(labels.slice(index).join('.'));
  return parents;
};

const analyzeDmarc = async (domain, dns, budget, { warnNoReports = true } = {}) => {
  let answer = await dns.txt(`_dmarc.${domain}`, budget);
  let inheritedFrom = null;
  if (answer.state === 'inconclusive') return { status: 'inconclusive' };
  if (answer.state === 'absent' || dmarcRecordOf(answer).length === 0) {
    for (const parent of parentNames(domain)) {
      const upper = await dns.txt(`_dmarc.${parent}`, budget);
      if (upper.state === 'inconclusive') return { status: 'inconclusive' };
      if (upper.state === 'ok' && dmarcRecordOf(upper).length > 0) { answer = upper; inheritedFrom = parent; break; }
    }
    if (!inheritedFrom) return { status: 'absent' };
  }
  const records = dmarcRecordOf(answer);
  if (records.length === 0) return { status: 'absent' };
  if (records.length > 1) return { status: 'fail', errors: ['DMARC_MULTIPLE'], warnings: [], record: null, policy: null, subdomain_policy: null, pct: 100, rua: [], ruf: [], adkim: 'r', aspf: 'r' };
  const tags = {};
  for (const part of records[0].split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    if (!(key in tags)) tags[key] = part.slice(index + 1).trim();
  }
  const policy = (tags.p || '').toLowerCase();
  const rua = mailtoList(tags.rua);
  const ruf = mailtoList(tags.ruf);
  const errors = [];
  const warnings = [];
  if (!policy) { if (rua.length) warnings.push('DMARC_NO_POLICY_TAG'); else errors.push('DMARC_NO_POLICY'); }
  else if (!['none', 'quarantine', 'reject'].includes(policy)) errors.push('DMARC_BAD_POLICY');
  if (policy === 'none') warnings.push('DMARC_POLICY_NONE');
  if (rua.length === 0 && warnNoReports) warnings.push('DMARC_NO_RUA');
  const pct = tags.pct === undefined || tags.pct === '' ? 100 : Number(tags.pct);
  if (Number.isInteger(pct) && pct >= 0 && pct < 100) warnings.push('DMARC_PCT_PARTIAL');
  const subdomainPolicy = (tags.sp || '').toLowerCase() || null;
  if (subdomainPolicy === 'none' && policy && policy !== 'none') warnings.push('DMARC_SP_NONE');
  const status = errors.length ? 'fail' : warnings.length ? 'warning' : 'ok';
  return {
    status, inherited_from: inheritedFrom, record: records[0].slice(0, 1000), policy: policy || null, subdomain_policy: subdomainPolicy, pct: Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : 100,
    rua, ruf, adkim: (tags.adkim || 'r').toLowerCase() === 's' ? 's' : 'r', aspf: (tags.aspf || 'r').toLowerCase() === 's' ? 's' : 'r', errors, warnings
  };
};

// ---------- DKIM ----------
const looksLikeDkim = (record) => /(^|;)\s*(v\s*=\s*DKIM1|p\s*=)/i.test(record);

const parseDkimKey = (record) => {
  const tags = {};
  for (const part of record.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    if (!(key in tags)) tags[key] = part.slice(index + 1).trim();
  }
  const keyType = (tags.k || 'rsa').toLowerCase();
  const material = (tags.p || '').replace(/\s+/g, '');
  const flags = (tags.t || '').toLowerCase().split(':');
  let bits = null;
  if (material && keyType === 'rsa') {
    try { bits = crypto.createPublicKey({ key: Buffer.from(material, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyDetails?.modulusLength || null; } catch { bits = null; }
  }
  return { key_type: keyType.slice(0, 16), bits, revoked: !material, testing: flags.includes('y') };
};

const analyzeDkim = async (domain, dns, selectors, budget) => {
  // A wildcard (`*._domainkey`) answers for EVERY selector, so nothing can be discovered by probing: detect it first with a random name.
  const probe = await dns.txt(`dm-${crypto.randomBytes(6).toString('hex')}._domainkey.${domain}`, budget);
  if (probe.state === 'ok' && probe.records.some(looksLikeDkim)) {
    return { status: 'not_found', wildcard: true, tested: 0, found: [], warnings: [], notes: ['DKIM_WILDCARD'], unreachable: 0 };
  }
  const list = [...new Set((selectors || []).filter(isValidSelector).map((selector) => selector.toLowerCase()))]
    .filter((selector) => `${selector}._domainkey.${domain}`.length <= 253).slice(0, MAX_PROBED_SELECTORS);
  const found = [];
  let unreachable = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const selector = list[cursor]; cursor += 1;
      const answer = await dns.txt(`${selector}._domainkey.${domain}`, budget);
      if (answer.state === 'inconclusive') { unreachable += 1; continue; }
      if (answer.state !== 'ok') continue;
      const record = answer.records.find(looksLikeDkim);
      if (record) found.push({ selector, ...parseDkimKey(record) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(SELECTOR_CONCURRENCY, list.length) }, worker));
  found.sort((left, right) => left.selector.localeCompare(right.selector));
  const warnings = [];
  const notes = [];
  let status;
  if (found.length === 0) status = unreachable > 0 ? 'inconclusive' : 'not_found';
  else {
    const active = found.filter((key) => !key.revoked);
    const strong = active.some((key) => key.key_type === 'ed25519' || (key.bits && key.bits >= 2048));
    const weak = active.some((key) => key.bits && key.bits < 2048);
    if (active.length === 0) { status = 'warning'; warnings.push('DKIM_ALL_REVOKED'); }
    else if (strong) { status = 'ok'; if (weak) notes.push('DKIM_WEAK_KEY_SOME'); }
    else if (weak) { status = 'warning'; warnings.push('DKIM_WEAK_KEY'); }
    else { status = 'warning'; warnings.push('DKIM_KEY_UNREADABLE'); }
    if (active.some((key) => key.testing)) notes.push('DKIM_TESTING');
  }
  return { status, wildcard: false, tested: list.length, found, warnings, notes, unreachable, partial: unreachable > 0 && found.length > 0 };
};

// ---------- everything for one name ----------
const inconclusiveSection = (code) => ({ status: 'inconclusive', code });

const checkMailAuth = async (domain, { dns, selectors = [], warnNoReports = true, budget = createBudget(), dkimBudget = createBudget({ maxQueries: DKIM_BUDGET }) } = {}) => {
  const apex = await dns.txt(domain, budget).catch((error) => { if (error instanceof QueryBudgetError) return { state: 'inconclusive', code: 'DNS_BUDGET' }; throw error; });
  if (apex.state === 'absent' && apex.code === 'ENOTFOUND') {
    return { name_exists: false, spf: { status: 'absent' }, dmarc: { status: 'absent' }, dkim: { status: 'not_found', tested: 0, found: [], wildcard: false, warnings: [], notes: [], unreachable: 0 } };
  }
  const guard = (task) => task.catch((error) => { if (error instanceof QueryBudgetError) return inconclusiveSection('DNS_BUDGET'); throw error; });
  const [spf, dmarc, dkim] = await Promise.all([
    guard(analyzeSpf(domain, dns, budget, apex.state === 'inconclusive' ? { state: 'inconclusive', code: apex.code } : apex)),
    guard(analyzeDmarc(domain, dns, budget, { warnNoReports })),
    guard(analyzeDkim(domain, dns, selectors, dkimBudget))
  ]);
  return { name_exists: true, spf, dmarc, dkim };
};

module.exports = { checkMailAuth, analyzeSpf, analyzeDmarc, analyzeDkim, isValidSelector, MAX_SPF_LOOKUPS, MAX_SELECTORS, MAX_EXTRA_SELECTORS, MAX_PROBED_SELECTORS };
