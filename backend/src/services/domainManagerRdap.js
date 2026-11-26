const { httpsGet, DomainNetError } = require('./domainManagerNet');

// RDAP (RFC 9083). The registry server for a TLD comes from the IANA bootstrap table, never from the user. Registrant entities
// (CPF/CNPJ, vCard) are discarded on entry: only the fields below are ever kept, and nothing from the response is logged.
const BOOTSTRAP_HOST = 'data.iana.org';
const BOOTSTRAP_PATH = '/rdap/dns.json';
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const BOOTSTRAP_MAX_BYTES = 2 * 1024 * 1024;
const RDAP_MAX_BYTES = 1024 * 1024;
const MIN_GAP_MS = 1000;
const DEFAULT_BASES = Object.freeze({ br: 'https://rdap.registro.br/' });
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const TZ = 'America/Sao_Paulo';

// eventDate is a timestamp (often not at midnight UTC): the day shown is the one in Brasília.
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const toDay = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dayFormatter.format(date);
};

const createRdapClient = ({ transport, resolver, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) => {
  const net = { ...(transport ? { transport } : {}), ...(resolver ? { resolver } : {}) };
  let bootstrap = null;
  let bootstrapAt = 0;
  const lastCall = new Map();
  const chains = new Map();

  // One request at a time per registry host, at least MIN_GAP_MS apart (the registry throttles with an intermittent 403).
  const paced = (host, task) => {
    const previous = chains.get(host) || Promise.resolve();
    const run = previous.then(async () => {
      const wait = (lastCall.get(host) || 0) + MIN_GAP_MS - now();
      if (wait > 0) await sleep(wait);
      try { return await task(); } finally { lastCall.set(host, now()); }
    });
    chains.set(host, run.catch(() => {}));
    return run;
  };

  const loadBootstrap = async () => {
    if (bootstrap && now() - bootstrapAt < BOOTSTRAP_TTL_MS) return bootstrap;
    const next = new Map(Object.entries(DEFAULT_BASES));
    try {
      const response = await httpsGet({ host: BOOTSTRAP_HOST, path: BOOTSTRAP_PATH, headers: { Accept: 'application/json' }, maxBytes: BOOTSTRAP_MAX_BYTES }, net);
      if (response.status !== 200) throw new Error('status');
      for (const service of JSON.parse(response.body).services || []) {
        const [tlds, urls] = service;
        const base = (urls || []).find((url) => typeof url === 'string' && url.startsWith('https://'));
        if (!base || !Array.isArray(tlds)) continue;
        for (const tld of tlds) if (typeof tld === 'string') next.set(tld.toLowerCase(), base.endsWith('/') ? base : `${base}/`);
      }
      bootstrap = next;
      bootstrapAt = now();
    } catch {
      // Keep the previous table; with none, the built-in .br entry still works.
      if (!bootstrap) { bootstrap = next; bootstrapAt = now() - BOOTSTRAP_TTL_MS + 10 * 60 * 1000; }
    }
    return bootstrap;
  };

  const lookup = async (domain) => {
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    const base = (await loadBootstrap()).get(tld);
    if (!base) return { lookup_status: 'unsupported' };
    let url;
    try { url = new URL(base); } catch { return { lookup_status: 'error', error_code: 'RDAP_BASE_INVALID' }; }
    if (url.protocol !== 'https:' || url.port || url.username || !HOST_PATTERN.test(url.hostname)) return { lookup_status: 'error', error_code: 'RDAP_BASE_INVALID' };
    let response;
    try {
      response = await paced(url.hostname, () => httpsGet({
        host: url.hostname, path: `${url.pathname.replace(/\/?$/, '/')}domain/${encodeURIComponent(domain)}`,
        headers: { Accept: 'application/rdap+json, application/json' }, maxBytes: RDAP_MAX_BYTES
      }, net));
    } catch (error) {
      return { lookup_status: 'error', error_code: error instanceof DomainNetError ? error.code : 'RDAP_FAILED' };
    }
    if (response.status === 404) return { lookup_status: 'not_found' };
    if (response.status === 403 || response.status === 429) return { lookup_status: 'error', error_code: 'RATE_LIMITED' };
    if (response.status >= 500) return { lookup_status: 'error', error_code: 'UPSTREAM_ERROR' };
    if (response.status !== 200) return { lookup_status: 'error', error_code: 'RDAP_STATUS' };
    let parsed;
    try { parsed = JSON.parse(response.body); } catch { return { lookup_status: 'error', error_code: 'RDAP_INVALID' }; }
    return parseDomain(parsed);
  };

  return { lookup, loadBootstrap };
};

const cleanText = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

const registrarName = (entities) => {
  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!Array.isArray(entity?.roles) || !entity.roles.includes('registrar')) continue;
    const card = Array.isArray(entity.vcardArray) ? entity.vcardArray[1] : null;
    const fn = Array.isArray(card) ? card.find((row) => Array.isArray(row) && row[0] === 'fn') : null;
    const name = cleanText(fn?.[3], 200);
    if (name) return name;
  }
  return null;
};

const parseDomain = (json) => {
  if (!json || typeof json !== 'object' || json.objectClassName !== 'domain') return { lookup_status: 'error', error_code: 'RDAP_INVALID' };
  const events = Array.isArray(json.events) ? json.events : [];
  const eventDay = (action) => {
    const event = events.find((item) => String(item?.eventAction || '').toLowerCase() === action);
    return event?.eventDate ? toDay(event.eventDate) : null;
  };
  const expires = eventDay('expiration');
  const result = {
    lookup_status: expires ? 'ok' : 'no_expiry',
    registrar: registrarName(json.entities),
    expires_on: expires,
    registered_on: eventDay('registration'),
    rdap_statuses: (Array.isArray(json.status) ? json.status : []).map((status) => cleanText(status, 64).toLowerCase()).filter(Boolean).slice(0, 20),
    nameservers: [...new Set((Array.isArray(json.nameservers) ? json.nameservers : [])
      .map((ns) => cleanText(ns?.ldhName, 253).toLowerCase().replace(/\.$/, '')).filter(Boolean))].sort().slice(0, 20),
    dnssec: typeof json.secureDNS?.delegationSigned === 'boolean' ? json.secureDNS.delegationSigned : null
  };
  return result;
};

module.exports = { createRdapClient, parseDomain, toDay };
