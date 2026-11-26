const dns = require('node:dns').promises;
const https = require('node:https');
const { isPublicIpv4 } = require('./spfblWhmClient');

// Outbound access of the Domain Manager. The names are typed by users (and the registry hosts come from a downloaded table), so every
// connection follows the WHM client's rules: resolve once, accept only a public IPv4, connect to that exact address (no second lookup),
// verify TLS against the name, no redirects, no proxy, bounded size and time, and nothing but a plain GET.
class DomainNetError extends Error {
  constructor(message, code, statusCode = 502) {
    super(message);
    this.name = 'DomainNetError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const defaultResolver = async (host) => (await dns.lookup(host, { all: true, family: 4 })).map((entry) => entry.address);

const resolvePublic = async (host, resolver = defaultResolver) => {
  let addresses;
  try { addresses = await resolver(host); } catch { addresses = null; }
  if (!Array.isArray(addresses) || addresses.length === 0) throw new DomainNetError('O nome não resolveu para um IPv4.', 'DNS_NO_ADDRESS');
  // Every answer must be public: a mixed answer could be steered to an internal address on a retry.
  if (!addresses.every(isPublicIpv4)) throw new DomainNetError('O nome resolve para um endereço não público.', 'ADDRESS_FORBIDDEN', 422);
  return addresses[0];
};

const defaultTransport = ({ ip, host, path, headers, timeoutMs, maxBytes }) => new Promise((resolve, reject) => {
  let finished = false;
  let timer;
  const finish = (action, value) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    action(value);
  };
  const request = https.request({
    host: ip, port: 443, method: 'GET', path, servername: host, rejectUnauthorized: true, agent: false, timeout: timeoutMs,
    headers: { ...headers, Host: host }
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
    response.on('end', () => finish(resolve, { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    response.on('error', (error) => finish(reject, error));
  });
  const expire = () => { request.destroy(); finish(reject, Object.assign(new Error('timeout'), { timeout: true })); };
  timer = setTimeout(expire, timeoutMs);
  request.on('timeout', expire);
  request.on('error', (error) => finish(reject, error));
  request.end();
});

const httpsGet = async ({ host, path, headers = {}, timeoutMs = 15000, maxBytes = 1024 * 1024 }, { transport = defaultTransport, resolver = defaultResolver } = {}) => {
  const ip = await resolvePublic(host, resolver);
  try {
    return await transport({ ip, host, path, headers, timeoutMs, maxBytes });
  } catch (error) {
    if (error?.oversized) throw new DomainNetError('Resposta grande demais.', 'RESPONSE_TOO_LARGE');
    if (error?.timeout) throw new DomainNetError('Tempo esgotado.', 'TIMEOUT', 504);
    throw new DomainNetError('Falha de conexão.', 'CONNECT_FAILED');
  }
};

module.exports = { DomainNetError, resolvePublic, httpsGet, defaultResolver };
