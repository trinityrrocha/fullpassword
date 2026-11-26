const tls = require('node:tls');
const { resolvePublic, DomainNetError } = require('./domainManagerNet');

// Certificate of the root domain on port 443: a TLS handshake and nothing else (no request is sent). The chain is NOT enforced
// during the handshake so that an expired or untrusted certificate can still be read and reported; trust is judged afterwards.
const TIMEOUT_MS = 8000;

const defaultConnect = (options) => tls.connect(options);
const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const NO_HTTPS = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPROTO']);

const probe = (domain, { resolver, connect = defaultConnect, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) => new Promise((resolve) => {
  let done = false;
  let socket = null;
  const finish = (result) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { socket?.destroy(); } catch { /* already closed */ }
    resolve(result);
  };
  const timer = setTimeout(() => finish({ ssl_state: 'none', ssl_error: 'TIMEOUT' }), timeoutMs);
  resolvePublic(domain, resolver).then((ip) => {
    socket = connect({ host: ip, port: 443, servername: domain, rejectUnauthorized: false, timeout: timeoutMs });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) { finish({ ssl_state: 'error', ssl_error: 'NO_CERTIFICATE' }); return; }
      const notAfter = new Date(cert.valid_to);
      const result = {
        ssl_not_after: Number.isNaN(notAfter.getTime()) ? null : notAfter.toISOString(),
        ssl_issuer: text(cert.issuer?.O || cert.issuer?.CN, 200) || null,
        ssl_protocol: text(socket.getProtocol?.(), 16) || null
      };
      if (result.ssl_not_after && notAfter.getTime() < now()) finish({ ...result, ssl_state: 'expired' });
      else if (socket.authorized) finish({ ...result, ssl_state: 'valid' });
      else finish({ ...result, ssl_state: 'invalid', ssl_error: text(String(socket.authorizationError || 'UNTRUSTED'), 64) });
    });
    socket.once('timeout', () => finish({ ssl_state: 'none', ssl_error: 'TIMEOUT' }));
    socket.once('error', (error) => finish(NO_HTTPS.has(error?.code) ? { ssl_state: 'none', ssl_error: error.code } : { ssl_state: 'error', ssl_error: text(error?.code || 'TLS_ERROR', 64) }));
  }).catch((error) => {
    if (error instanceof DomainNetError && error.code === 'DNS_NO_ADDRESS') finish({ ssl_state: 'none', ssl_error: 'DNS_NO_ADDRESS' });
    else finish({ ssl_state: 'error', ssl_error: error?.code || 'PROBE_FAILED' });
  });
});

module.exports = { probe };
