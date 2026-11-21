const assert = require('node:assert/strict');
const { normalizeClientIp, getClientIpMode, validateTrustedProxyCidrs, clientIpMiddleware, getClientIp, getClientNetworkMetadata, getClientIpRateLimitKey } = require('../src/services/clientIpService');

// Default peer is the Nginx container on the private Docker network (the documented topology).
const resolve = (mode, headers = {}, socket = '172.19.0.2', rawHeaders = []) => {
  process.env.CLIENT_IP_MODE = mode;
  const req = { headers, rawHeaders, socket: { remoteAddress: socket }, path: '/api/test' };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let next = false;
  clientIpMiddleware(req, res, () => { next = true; });
  return { req, res, next };
};
const forwarded = (mode, ip, extra = {}) => ({ 'x-forwarded-for': ip, 'cf-connecting-ip': ip, 'x-fullpassword-cloudflare': '1', 'x-fullpassword-client-ip-mode': mode, ...extra });

for (const input of ['', '1.2.3', '012.1.1.1', '999.1.1.1', 'abc', '1.1.1.1,2.2.2.2', '1.1.1.1/32', 'fe80::1%eth0', '[::1]', '1.1.1.1:80', 'x'.repeat(10000)]) assert.equal(normalizeClientIp(input), null, input);
assert.equal(normalizeClientIp('203.0.113.10'), '203.0.113.10');
assert.equal(normalizeClientIp('::ffff:203.0.113.10'), '203.0.113.10');
assert.equal(normalizeClientIp('2001:0DB8:0:0:0:0:0:1'), '2001:db8:0:0:0:0:0:1');
for (const invalid of ['guess', '', ' ', 'DIRECT']) {
  process.env.CLIENT_IP_MODE = invalid; assert.throws(getClientIpMode, /CLIENT_IP_MODE/);
}
delete process.env.CLIENT_IP_MODE; assert.equal(getClientIpMode(), 'direct');
const direct = resolve('direct', { 'cf-connecting-ip': '8.8.8.8', 'x-real-ip': '9.9.9.9', 'cf-ray': 'a'.repeat(16) + '-GRU', 'cf-ipcountry': 'BR' }, '203.0.113.25');
assert(direct.next); assert.equal(getClientIp(direct.req), '203.0.113.25');
assert.equal(getClientNetworkMetadata(direct.req).cloudflare, false);
assert.equal(getClientNetworkMetadata(direct.req).cloudflare_ray_id, null);
assert.equal(getClientNetworkMetadata(direct.req).country, null);
assert.equal(Object.getOwnPropertyDescriptor(direct.req, 'clientIp').writable, false);
// A public peer reached the backend without the proxy: its own X-Forwarded-For must not choose the client IP.
for (const peer of ['8.8.8.8', '203.0.113.25', '2001:4860::1']) {
  const bypass = resolve('direct', { 'x-forwarded-for': '198.51.100.77' }, peer);
  assert(bypass.next); assert.equal(getClientIp(bypass.req), normalizeClientIp(peer));
}
assert.equal(getClientIp(resolve('direct', { 'x-forwarded-for': '198.51.100.77' }, '::1').req), '198.51.100.77');
// TRUSTED_PROXY_CIDRS adds proxy networks; unset behaves exactly as before (198.19/16 is "reserved", not private).
const viaProxy = (peer) => getClientIp(resolve('direct', { 'x-forwarded-for': '198.51.100.77' }, peer).req);
delete process.env.TRUSTED_PROXY_CIDRS;
assert.doesNotThrow(validateTrustedProxyCidrs);
assert.equal(viaProxy('198.19.205.3'), '198.19.205.3');
assert.equal(viaProxy('172.19.0.2'), '198.51.100.77');
process.env.TRUSTED_PROXY_CIDRS = '   ';
assert.doesNotThrow(validateTrustedProxyCidrs);
assert.equal(viaProxy('198.19.205.3'), '198.19.205.3');
process.env.TRUSTED_PROXY_CIDRS = '198.19.205.3/32, 100.64.0.0/10 ,2001:db8:77::/48,203.0.113.9';
assert.doesNotThrow(validateTrustedProxyCidrs);
assert.equal(viaProxy('198.19.205.3'), '198.51.100.77');
assert.equal(viaProxy('198.19.205.4'), '198.19.205.4', 'a neighbour of the listed proxy stays untrusted');
assert.equal(viaProxy('100.64.1.1'), '198.51.100.77');
assert.equal(viaProxy('::ffff:100.64.1.1'), '198.51.100.77', 'IPv4-mapped peers match IPv4 entries');
assert.equal(viaProxy('203.0.113.9'), '198.51.100.77');
assert.equal(viaProxy('203.0.113.10'), '203.0.113.10');
assert.equal(viaProxy('2001:db8:77::5'), '198.51.100.77');
assert.equal(viaProxy('2001:db8:78::5'), normalizeClientIp('2001:db8:78::5'));
assert.equal(viaProxy('8.8.8.8'), '8.8.8.8', 'public peers stay untrusted');
assert.equal(viaProxy('172.19.0.2'), '198.51.100.77', 'default private trust is kept');
for (const invalid of ['0.0.0.0/0', '::/0', '10.0.0.0/7', '2001:db8::/31', '1.2.3.4/33', '2001:db8::/129', 'abc', '198.19.205.3/', '198.19.205.3/x', '198.19.205.3/-1', 'a,,b', ',', '198.19.205.0/24/1', '012.1.1.1', '::ffff:10.0.0.1/128', '1.1.1.1;2.2.2.2', '198.19.205.3/032']) {
  process.env.TRUSTED_PROXY_CIDRS = invalid;
  assert.throws(validateTrustedProxyCidrs, /TRUSTED_PROXY_CIDRS/, invalid);
}
delete process.env.TRUSTED_PROXY_CIDRS;
for (const mode of ['cloudflare_proxy', 'cloudflare_tunnel']) {
  process.env.TRUSTED_COUNTRY_HEADER_ENABLED = 'true';
  const good = resolve(mode, forwarded(mode, '203.0.113.10', { 'cf-ray': 'a'.repeat(16) + '-GRU', 'cf-ipcountry': 'BR' }));
  assert(good.next); assert.equal(getClientIp(good.req), '203.0.113.10');
  assert.equal(getClientNetworkMetadata(good.req).cloudflare_ray_id, 'a'.repeat(16) + '-GRU');
  assert.equal(getClientNetworkMetadata(good.req).country, 'BR');
  for (const malformed of ['', '1.1.1.1,2.2.2.2', '1.1.1.1/32', '999.1.1.1', '2001:::1', 'arbitrary', 'x'.repeat(10000)]) {
    assert.equal(resolve(mode, forwarded(mode, '203.0.113.10', { 'cf-connecting-ip': malformed })).res.code, 403);
  }
  assert.equal(resolve(mode, { 'cf-connecting-ip': '8.8.8.8' }).res.code, 403);
  assert.equal(resolve(mode, forwarded(mode, '203.0.113.10', { 'x-fullpassword-cloudflare': '0' })).res.code, 403);
  assert.equal(resolve(mode, forwarded(mode, '203.0.113.10'), '127.0.0.1', ['X-Forwarded-For', '203.0.113.10', 'X-Forwarded-For', '203.0.113.10']).res.code, 400);
  const invalidMeta = resolve(mode, forwarded(mode, '2001:db8::1', { 'cf-ray': 'unsafe data', 'cf-ipcountry': 'T1' }));
  assert(invalidMeta.next); assert.equal(getClientNetworkMetadata(invalidMeta.req).cloudflare_ray_id, null); assert.equal(getClientNetworkMetadata(invalidMeta.req).country, null);
}
const a = resolve('direct', { 'x-forwarded-for': '203.0.113.10' }).req;
const b = resolve('direct', { 'x-forwarded-for': '198.51.100.20' }).req;
assert.notEqual(getClientIpRateLimitKey(a), getClientIpRateLimitKey(b));
assert.equal(getClientIpRateLimitKey(resolve('direct', { 'x-forwarded-for': '2001:db8::123' }).req), '2001:db8:0:0');
console.log('Trusted Client IP unit: PASS (modes, IPv4/IPv6/mapped, malformed/duplicate headers, metadata, immutable request, limiter keys).');
