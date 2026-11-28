const dns = require('node:dns').promises;
const https = require('node:https');
const ipaddr = require('ipaddr.js');

// Read-only WHM API 1 client, ported from the CpanelApi.php of the original PHP SPFBL portal and adapted to WHM (port 2087):
// - the hostname is resolved once; every address must be a public IPv4, and the connection goes to that exact
//   address (no second lookup, so no DNS rebinding) while TLS is verified against the hostname;
// - fixed port, no redirects, no proxy, bounded response and time, and only three allow-listed read functions;
// - the token travels only in the Authorization header and never reaches a URL, a log or an error.
// Contract (cPanel API docs): GET /json-api/<function>?api.version=1 with "Authorization: whm USER:TOKEN".
// listaccts -> data.acct[] {user, domain, suspended (0|1), ...}; get_domain_info -> data.domains[] {domain, user, ...}.
// NOT verified against a real WHM server: the tests use a simulated transport.
const WHM_PORT = 2087;
const FUNCTIONS = new Set(['listaccts', 'get_domain_info', 'emailtrack_search']);
// A whole server's domain list can be large; 8 MiB, not the 1 MiB used for a single cron list.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20000;
const TOTAL_DEADLINE_MS = 45000;
const MAX_DOMAINS = 5000;
// Sent-mail reads: records per call, and the longest a whole (chunked) read may take.
const EMAIL_CHUNK = 500;
const EMAIL_TOTAL_MS = 120000;

const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DOMAIN_PATTERN = HOST_PATTERN;
const USER_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

class WhmError extends Error {
  constructor(message, code, statusCode = 502, diagnostic = '') {
    super(message);
    this.name = 'WhmError';
    this.code = code;
    this.statusCode = statusCode;
    this.diagnostic = diagnostic;
  }
}

// Only a globally routable IPv4: no private, loopback, link-local, CGNAT, reserved or multicast space.
const isPublicIpv4 = (value) => {
  if (typeof value !== 'string' || !ipaddr.IPv4.isValidFourPartDecimal(value)) return false;
  return ipaddr.parse(value).range() === 'unicast';
};

const defaultResolver = async (host) => (await dns.lookup(host, { all: true, family: 4 })).map((entry) => entry.address);

// Test hooks (port, ca) are never passed by WhmClient: production always uses 2087 and the system trust store.
// https.request's `timeout` is an idle timeout, so a slow-drip server could hold it open for ever: a total timer
// bounds the whole exchange.
const defaultTransport = ({ ip, host, path, headers, timeoutMs, maxBytes, port = WHM_PORT, ca }) => new Promise((resolve, reject) => {
  let finished = false;
  let timer;
  const finish = (action, value) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    action(value);
  };
  const request = https.request({
    host: ip,
    port,
    method: 'GET',
    path,
    servername: host,
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
    agent: false,
    timeout: timeoutMs,
    // Like curl (which the PHP client used): the Host header carries the port too.
    headers: { ...headers, Host: `${host}:${port}` }
  }, (response) => {
    const chunks = [];
    let size = 0;
    response.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        request.destroy();
        finish(reject, Object.assign(new Error('too large'), { oversized: true }));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => finish(resolve, { status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    response.on('error', (error) => finish(reject, error));
  });
  const expire = () => { request.destroy(); finish(reject, Object.assign(new Error('timeout'), { timeout: true })); };
  timer = setTimeout(expire, timeoutMs);
  request.on('timeout', expire);
  request.on('error', (error) => finish(reject, error));
  request.end();
});

class WhmClient {
  constructor({ host, user, token }, { transport = defaultTransport, resolver = defaultResolver, now = Date.now } = {}) {
    const normalizedHost = typeof host === 'string' ? host.trim().toLowerCase() : '';
    if (!HOST_PATTERN.test(normalizedHost)) throw new WhmError('Informe somente o hostname do servidor WHM, sem https://, porta, caminho ou endereço IP.', 'WHM_HOST_INVALID', 422);
    if (typeof user !== 'string' || !USER_PATTERN.test(user)) throw new WhmError('Informe o usuário WHM (root ou revendedor) que criou o token.', 'WHM_USER_INVALID', 422);
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    if (!TOKEN_PATTERN.test(normalizedToken)) throw new WhmError('Cole o token criado em Gerenciar tokens de API no WHM.', 'WHM_TOKEN_INVALID', 422);
    this.host = normalizedHost;
    this.user = user;
    this.token = normalizedToken;
    this.transport = transport;
    this.resolver = resolver;
    this.now = now;
    this.deadline = now() + TOTAL_DEADLINE_MS;
    this.ip = null;
  }

  async address() {
    if (this.ip) return this.ip;
    let addresses;
    try { addresses = await this.resolver(this.host); } catch { addresses = null; }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new WhmError('O hostname do WHM não resolveu para um IPv4 público. Confira o nome do servidor.', 'WHM_DNS', 503, 'WHM_DNS');
    }
    // Every answer must be public: a mixed answer could be steered to an internal address on a retry.
    if (!addresses.every(isPublicIpv4)) {
      throw new WhmError('Use o hostname público do WHM. Endereços locais, privados ou reservados não são aceitos.', 'WHM_ADDRESS_FORBIDDEN', 422, 'WHM_ADDRESS');
    }
    this.ip = addresses[0];
    return this.ip;
  }

  // `query` is built only by this class (validated values), never from a request: it is appended as-is after api.version.
  async call(name, query = '') {
    if (!FUNCTIONS.has(name)) throw new WhmError('Operação WHM não permitida.', 'WHM_FUNCTION_FORBIDDEN', 403);
    const remaining = this.deadline - this.now();
    if (remaining < 1000) throw new WhmError('Tempo limite da consulta ao WHM excedido.', 'WHM_TIMEOUT', 504, 'WHM_TIMEOUT');
    const ip = await this.address();
    let response;
    try {
      response = await this.transport({
        ip,
        host: this.host,
        path: `/json-api/${name}?api.version=1${query}`,
        headers: { Authorization: `whm ${this.user}:${this.token}`, Accept: 'application/json', 'User-Agent': 'FullPassword-SPFBL/1' },
        timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining),
        maxBytes: MAX_RESPONSE_BYTES
      });
    } catch (error) {
      if (error?.oversized) throw new WhmError('A resposta do WHM excedeu o limite permitido.', 'WHM_RESPONSE_TOO_LARGE', 502, 'WHM_SIZE');
      if (error?.timeout || error?.code === 'ETIMEDOUT') throw new WhmError('O WHM não respondeu a tempo na porta 2087.', 'WHM_TIMEOUT', 504, 'WHM_TIMEOUT');
      if (/certificate|CERT_|SSL|TLS|self.signed|hostname/i.test(`${error?.code || ''} ${error?.message || ''}`)) {
        throw new WhmError('Não foi possível validar o HTTPS do WHM. Use o hostname correspondente ao certificado do servidor.', 'WHM_TLS', 502, 'WHM_TLS');
      }
      throw new WhmError('Não foi possível conectar ao WHM na porta 2087. Confira hostname e liberação de saída HTTPS.', 'WHM_CONNECTION', 502, 'WHM_CONNECTION');
    }
    const status = Number(response?.status) || 0;
    if (status === 401 || status === 403) throw new WhmError(`O WHM recusou a autorização em ${name}. Confira usuário, token, validade e as permissões do token.`, 'WHM_AUTH_REFUSED', 422, `WHM_HTTP_${status} ${name}`);
    if (status >= 300 && status < 400) throw new WhmError('O servidor redirecionou a chamada. Use o hostname direto do WHM.', 'WHM_REDIRECT', 502, `WHM_REDIRECT ${name}`);
    if (status !== 200) throw new WhmError(`O WHM retornou HTTP ${status} em ${name}. Confira a disponibilidade da API.`, 'WHM_HTTP', 502, `WHM_HTTP_${status} ${name}`);
    const body = typeof response.body === 'string' ? response.body : '';
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new WhmError('A resposta do WHM excedeu o limite permitido.', 'WHM_RESPONSE_TOO_LARGE', 502, 'WHM_SIZE');
    let decoded;
    try { decoded = JSON.parse(body); } catch { throw new WhmError(`A resposta do WHM em ${name} não é o JSON esperado.`, 'WHM_FORMAT', 502, `WHM_FORMAT ${name}`); }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || !decoded.metadata || typeof decoded.metadata !== 'object') {
      throw new WhmError(`A resposta do WHM em ${name} não é o JSON esperado.`, 'WHM_FORMAT', 502, `WHM_FORMAT ${name}`);
    }
    if (Number(decoded.metadata.result) !== 1) {
      // The provider's reason text can name accounts; keep it out of the message. Which call failed is safe and useful.
      throw new WhmError(`O WHM recusou ${name}. Confira se o token tem permissão para essa operação.`, 'WHM_API_REFUSED', 502, `WHM_API_REFUSED ${name}`);
    }
    if (!decoded.data || typeof decoded.data !== 'object') throw new WhmError(`O WHM não retornou os dados esperados em ${name}.`, 'WHM_FORMAT', 502, `WHM_FORMAT ${name}`);
    return decoded.data;
  }

  // Accounts: user + main domain + suspension flag.
  async accounts() {
    const data = await this.call('listaccts');
    if (!Array.isArray(data.acct)) throw new WhmError('O WHM não retornou a lista de contas esperada em listaccts.', 'WHM_FORMAT', 502, 'WHM_FORMAT listaccts');
    if (data.acct.length > MAX_DOMAINS) throw new WhmError('O servidor tem mais contas do que o limite suportado.', 'WHM_TOO_MANY', 422, 'WHM_TOO_MANY');
    const accounts = [];
    let skipped = 0;
    for (const entry of data.acct) {
      const user = entry?.user;
      const suspended = entry?.suspended;
      if (typeof user !== 'string' || !USER_PATTERN.test(user) || ![0, 1, true, false].includes(suspended)) { skipped += 1; continue; }
      const domain = typeof entry.domain === 'string' ? entry.domain.trim().toLowerCase() : '';
      accounts.push({ user, domain: DOMAIN_PATTERN.test(domain) ? domain : null, suspended: suspended === 1 || suspended === true });
    }
    return { accounts, skipped };
  }

  async domains() {
    const data = await this.call('get_domain_info');
    if (!Array.isArray(data.domains)) throw new WhmError('O WHM não retornou a lista de domínios esperada em get_domain_info.', 'WHM_FORMAT', 502, 'WHM_FORMAT get_domain_info');
    if (data.domains.length > MAX_DOMAINS) throw new WhmError('O servidor tem mais domínios do que o limite suportado.', 'WHM_TOO_MANY', 422, 'WHM_TOO_MANY');
    const list = [];
    let skipped = 0;
    for (const entry of data.domains) {
      const domain = typeof entry?.domain === 'string' ? entry.domain.trim().toLowerCase() : '';
      const user = entry?.user;
      if (!DOMAIN_PATTERN.test(domain) || typeof user !== 'string' || !USER_PATTERN.test(user)) { skipped += 1; continue; }
      list.push({ domain, user, type: typeof entry.domain_type === 'string' ? entry.domain_type.trim().toLowerCase() : '' });
    }
    return { domains: list, skipped };
  }

  // Delivery records of the mail SENT by every domain of the server (emailtrack_search, WHM API 1). The caller keeps the ones it wants: the
  // request carries NO domain filter (a server-side "domain eq X" filter returned nothing on a real server, while the same request without it
  // returned every domain; the period filter, the order and the chunking were checked on that server).
  // Two kinds of call, because the two kinds of record do not carry the same fields:
  //  - delivered / in progress: filtered in the server by period of the delivery; remote deliveries only;
  //  - deferred / failed: NOT filtered by "domain" or by remote delivery (on them "domain" can be empty, the sender is only in "email", and a
  //    failure at the routing stage never reaches a remote transport), only by the period of the attempt.
  // The function's own limit (max_results_by_type) is applied BEFORE the filters, so any limit would let busy senders (system mail, backups)
  // push the other domains out of the answer: it is always 0 (unlimited). The size of the answer is bounded by the filters, by the order
  // (newest first) and by chunking: the records come in chunks of 500 until a chunk is short or the cap per kind is reached.
  // Every value is validated here. Contract (cPanel API docs): data.records[] {type: success|defer|failure|inprogress, sender, email,
  // recipient, sendunixtime, actionunixtime, message, ...}.
  async emailTrack({ sinceUnix, untilUnix, maxPerKind = 5000 }) {
    const since = Number(sinceUnix);
    const until = Number(untilUnix);
    const cap = Number(maxPerKind);
    if (!Number.isInteger(since) || !Number.isInteger(until) || since < 0 || until <= since || !Number.isInteger(cap) || cap < EMAIL_CHUNK || cap > 20000) {
      throw new WhmError('Período inválido.', 'WHM_FORMAT', 422);
    }
    const period = (field) => `&api.filter.enable=1&api.filter.a.field=${field}&api.filter.a.arg0=${since}&api.filter.a.type=gt&api.filter.b.field=${field}&api.filter.b.arg0=${until}&api.filter.b.type=lt`;
    const sorted = (field) => `&api.sort.enable=1&api.sort.a.field=${field}&api.sort.a.method=numeric&api.sort.a.reverse=1`;
    const kinds = [
      { name: 'delivered', query: `&success=1&defer=0&failure=0&inprogress=1&deliverytype=remote&max_results_by_type=0${period('sendunixtime')}${sorted('sendunixtime')}` },
      { name: 'problems', query: `&success=0&defer=1&failure=1&inprogress=0&deliverytype=all&max_results_by_type=0${period('actionunixtime')}${sorted('actionunixtime')}` }
    ];
    const started = this.now();
    const records = [];
    const stats = [];
    let truncated = false;
    let firstError = null;
    // One kind failing (a timeout on the heavier one, say) must not hide the other: its records are kept and the failure is reported.
    for (const { name, query } of kinds) {
      const stat = { kind: name, chunks: 0, records: 0, ms: 0, error: null };
      const kindStarted = this.now();
      try {
        for (let start = 1; ; start += EMAIL_CHUNK) {
          // A long read is split into many calls: each one gets its own time limit, the whole read a larger one.
          if (this.now() - started > EMAIL_TOTAL_MS) throw new WhmError('Tempo limite da consulta ao WHM excedido.', 'WHM_TIMEOUT', 504, 'WHM_TIMEOUT');
          this.deadline = this.now() + TOTAL_DEADLINE_MS;
          const data = await this.call('emailtrack_search', `${query}&api.chunk.enable=1&api.chunk.size=${EMAIL_CHUNK}&api.chunk.start=${start}`);
          if (!Array.isArray(data.records)) throw new WhmError('O WHM não retornou os registros de envio esperados em emailtrack_search.', 'WHM_FORMAT', 502, 'WHM_FORMAT emailtrack_search');
          records.push(...data.records);
          stat.chunks += 1; stat.records += data.records.length;
          if (data.records.length < EMAIL_CHUNK) break;
          if (stat.records >= cap) { truncated = true; break; }
        }
      } catch (error) {
        stat.error = String(error?.code || 'internal_error').slice(0, 60);
        firstError = firstError || error;
      }
      stat.ms = this.now() - kindStarted;
      stats.push(stat);
    }
    // Both kinds failed: nothing to show, say why. One failed: what the other returned is kept and the page says part of it is missing.
    if (stats.every((stat) => stat.error)) throw firstError;
    return { records, truncated, stats };
  }

  // Active domains = domains of non-suspended accounts. get_domain_info is reported as incomplete on some servers,
  // so every account's main domain (listaccts) is added to it. A domain whose account is unknown is not trusted.
  // Only real domains are listed: the account's main domain, its addon domains and its aliases (parked). Subdomains (mail.empresa.com.br) and the
  // internal subdomain cPanel creates for each addon domain (outro.com.br.empresa.com.br) are not domains of their own and are left out;
  // `subdomains` names them so the catalogue can drop the ones it imported before. The server says which is which (domain_type); when it does
  // not, a name that sits under another domain of the same account is taken as a subdomain.
  async listDomains() {
    const { accounts, skipped: skippedAccounts } = await this.accounts();
    const { domains, skipped: skippedDomains } = await this.domains();
    const suspendedByUser = new Map(accounts.map((account) => [account.user, account.suspended]));
    const namesByUser = new Map();
    const remember = (user, name) => { if (!namesByUser.has(user)) namesByUser.set(user, new Set()); namesByUser.get(user).add(name); };
    for (const account of accounts) if (account.domain) remember(account.user, account.domain);
    for (const { domain, user } of domains) remember(user, domain);
    const isSubdomain = ({ domain, user, type }) => {
      if (type) return type === 'sub_domain' || type === 'subdomain';
      for (const other of namesByUser.get(user) || []) if (other !== domain && domain.endsWith(`.${other}`)) return true;
      return false;
    };
    const byName = new Map();
    const subdomains = new Set();
    let unknownAccount = 0;
    for (const entry of domains) {
      if (!suspendedByUser.has(entry.user)) { unknownAccount += 1; continue; }
      if (isSubdomain(entry)) { subdomains.add(entry.domain); continue; }
      byName.set(entry.domain, { name: entry.domain, cpanel_user: entry.user, suspended: suspendedByUser.get(entry.user) });
    }
    for (const account of accounts) {
      if (account.domain && !byName.has(account.domain)) byName.set(account.domain, { name: account.domain, cpanel_user: account.user, suspended: account.suspended });
    }
    for (const name of byName.keys()) subdomains.delete(name);
    const result = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (result.length > MAX_DOMAINS) throw new WhmError('O servidor tem mais domínios do que o limite suportado.', 'WHM_TOO_MANY', 422, 'WHM_TOO_MANY');
    return {
      domains: result,
      subdomains: [...subdomains].sort(),
      accounts: accounts.length,
      skipped: skippedAccounts + skippedDomains + unknownAccount
    };
  }
}

module.exports = { WHM_PORT, MAX_DOMAINS, WhmError, WhmClient, isPublicIpv4, defaultTransport };
