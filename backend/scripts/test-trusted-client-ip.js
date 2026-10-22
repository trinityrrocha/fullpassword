const assert = require('node:assert/strict');
const { normalizeClientIp, getClientIpMode, clientIpMiddleware, getClientIp, getClientNetworkMetadata, getClientIpRateLimitKey } = require('../src/services/clientIpService');

const resolve = (mode, headers = {}, socket = '203.0.113.25', rawHeaders = []) => {
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
process.env.CLIENT_IP_MODE = 'guess'; assert.throws(getClientIpMode, /CLIENT_IP_MODE/);
delete process.env.CLIENT_IP_MODE; assert.equal(getClientIpMode(), 'direct');
const direct = resolve('direct', { 'cf-connecting-ip': '8.8.8.8', 'x-real-ip': '9.9.9.9', 'cf-ray': 'a'.repeat(16) + '-GRU', 'cf-ipcountry': 'BR' });
assert(direct.next); assert.equal(getClientIp(direct.req), '203.0.113.25');
assert.equal(getClientNetworkMetadata(direct.req).cloudflare, false);
assert.equal(getClientNetworkMetadata(direct.req).cloudflare_ray_id, null);
assert.equal(getClientNetworkMetadata(direct.req).country, null);
assert.equal(Object.getOwnPropertyDescriptor(direct.req, 'clientIp').writable, false);
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
