const ipaddr = require('ipaddr.js');
const { isIP } = require('node:net');

const MODES = new Set(['direct', 'cloudflare_proxy', 'cloudflare_tunnel']);
const requestNetworks = new WeakMap();

const getClientIpMode = () => {
  const mode = process.env.CLIENT_IP_MODE || 'direct';
  if (!MODES.has(mode)) throw new Error('CLIENT_IP_MODE inválido: use direct, cloudflare_proxy ou cloudflare_tunnel.');
  return mode;
};

// One address only: never parse lists, CIDRs, zone IDs, hostnames or port suffixes.
const normalizeClientIp = (value) => {
  if (typeof value !== 'string' || value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value) || !isIP(value)) return null;
  try {
    // ipaddr accepts legacy IPv4 octal/abbreviations; the HTTP contract does not.
    if (!value.includes(':') && !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
    const parsed = ipaddr.process(value);
    return parsed.kind() === 'ipv4' ? parsed.toString() : parsed.toNormalizedString();
  } catch { return null; }
};

const singleHeader = (req, name) => {
  const value = req.headers?.[name];
  if (typeof value !== 'string') return null;
  // Reject duplicate raw headers even if an HTTP library joins their values.
  const occurrences = (req.rawHeaders || []).filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length;
  return occurrences > 1 ? null : value;
};

const clientIpMiddleware = (req, res, next) => {
  const mode = getClientIpMode();
  const forwarded = singleHeader(req, 'x-forwarded-for');
  const hasForwarded = req.headers?.['x-forwarded-for'] !== undefined;
  const ip = normalizeClientIp(hasForwarded ? forwarded : req.socket?.remoteAddress);
  if (!ip) return res.status(400).json({ code: 'CLIENT_IP_INVALID', error: 'Endereço de origem inválido.' });
  let cloudflare = false;
  let ray = null;
  let country = null;
  if (mode !== 'direct') {
    cloudflare = singleHeader(req, 'x-fullpassword-cloudflare') === '1'
      && singleHeader(req, 'x-fullpassword-client-ip-mode') === mode
      && normalizeClientIp(singleHeader(req, 'cf-connecting-ip')) === ip;
    // Local health probes have no forwarded headers and do not represent users.
    if (!cloudflare && !(req.path === '/api/health' && !hasForwarded)) {
      return res.status(403).json({ code: 'CLIENT_IP_UNVERIFIED', error: 'Origem Cloudflare não validada. Revise a configuração da implantação.' });
    }
    if (cloudflare) {
      const candidate = singleHeader(req, 'cf-ray');
      ray = typeof candidate === 'string' && /^[a-fA-F0-9]{16,32}-[A-Z]{3}$/.test(candidate) ? candidate : null;
      const candidateCountry = singleHeader(req, 'cf-ipcountry');
      if (process.env.TRUSTED_COUNTRY_HEADER_ENABLED === 'true' && /^[A-Z]{2}$/.test(candidateCountry || '') && !['XX', 'T1'].includes(candidateCountry)) country = candidateCountry;
    }
  }
  const metadata = Object.freeze({ mode, client_ip: ip, cloudflare, cf_ray_present: Boolean(ray), cloudflare_ray_id: ray, country });
  requestNetworks.set(req, metadata);
  Object.defineProperty(req, 'clientIp', { value: ip, enumerable: true, writable: false, configurable: false });
  next();
};

// Non-HTTP callers/legacy unit fixtures still use this one normalization path.
// Production requests are initialized before ALL rate limiters and API middleware.
const getClientIp = (req) => requestNetworks.get(req)?.client_ip || normalizeClientIp(req?.ip) || null;
const getClientNetworkMetadata = (req) => requestNetworks.get(req) || Object.freeze({ mode: getClientIpMode(), client_ip: getClientIp(req), cloudflare: false, cf_ray_present: false, cloudflare_ray_id: null, country: null });
const getClientIpRateLimitKey = (req) => {
  const ip = getClientIp(req);
  if (!ip) throw new Error('Client IP deve ser validado antes do rate limiter.');
  // Preserve the existing IPv6 /64 anti-rotation policy.
  const parsed = ipaddr.process(ip);
  return parsed.kind() === 'ipv4' ? parsed.toString() : parsed.toNormalizedString().split(':').slice(0, 4).join(':');
};

module.exports = { getClientIpMode, normalizeClientIp, clientIpMiddleware, getClientIp, getClientNetworkMetadata, getClientIpRateLimitKey };
