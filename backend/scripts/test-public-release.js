const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CHANNEL_URL, verifyPublicRelease, createPublicReleaseService } = require('../src/services/publicReleaseService');
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const current = 'a'.repeat(40), next = 'b'.repeat(40);
let clock = Date.parse('2026-11-21T12:00:00Z');
const release = { schemaVersion: 1, repository: 'trinityrrocha/fullpassword', channel: 'stable', revision: next,
  publishedAt: new Date(clock - 60000).toISOString(), expiresAt: new Date(clock + 86400000).toISOString(),
  backend: 'ghcr.io/trinityrrocha/fullpassword-backend@sha256:' + 'c'.repeat(64),
  frontend: 'ghcr.io/trinityrrocha/fullpassword-frontend@sha256:' + 'd'.repeat(64),
  ancestors: [current], changes: [{ type: 'fix', title: 'Correção pública' }] };
const sign = value => {
  const bytes = Buffer.from(JSON.stringify(value));
  return { payload: bytes.toString('base64'), signature: crypto.sign('sha256', bytes, keys.privateKey).toString('base64') };
};
const verify = value => verifyPublicRelease(value, keys.publicKey, clock);
async function run() {
  assert.deepEqual(verify(sign(release)), release);
  const signed = sign(release);
  assert.throws(() => verify({ ...signed, payload: Buffer.from(JSON.stringify({ ...release, revision: current })).toString('base64') }), /SIGNATURE/);
  assert.throws(() => verify({ ...signed, signature: Buffer.alloc(384).toString('base64') }), /SIGNATURE/);
  for (const patch of [
    { repository: 'attacker/fullpassword' }, { origin: 'https://one-installation.example' }, { approvalId: crypto.randomUUID() },
    { channel: 'development' }, { backend: 'ghcr.io/trinityrrocha/fullpassword-backend:latest' },
    { frontend: release.backend }, { revision: '../evil' }, { ancestors: [next] }, { ancestors: [current, current] },
    { changes: [{ type: 'fix', title: '<script>bad</script>' }] }, { expiresAt: new Date(clock - 1).toISOString() },
    { publishedAt: new Date(clock + 86400000).toISOString() }, { expiresAt: new Date(clock + 91 * 86400000).toISOString() }
  ]) assert.throws(() => verify(sign({ ...release, ...patch })), /PUBLIC_RELEASE/);
  let calls = 0, broken = false, payload = signed;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, CHANNEL_URL);
    assert.deepEqual(Object.keys(options).sort(), ['headers', 'redirect', 'signal']);
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
    if (broken) throw new Error('SYNTHETIC_NETWORK_FAILURE');
    return new Response(JSON.stringify(payload));
  };
  const get = createPublicReleaseService({ fetcher, publicKey: keys.publicKey, now: () => clock });
  const [first, second] = await Promise.all([get(current), get(current)]);
  assert.deepEqual(first, second); assert.equal(calls, 1, 'single-flight across users');
  assert.equal(first.state, 'available'); assert.equal(first.release.revision, next);
  for (const key of ['origin', 'ancestors', 'approvalId', 'manifestHash']) assert(!Object.hasOwn(first.release, key));
  assert.equal((await get(next)).state, 'current');
  assert.equal((await get('f'.repeat(40))).state, 'unrecognized', 'fork/ahead must not be offered a downgrade');
  assert.equal((await get('unknown')).state, 'unidentified');
  assert.equal(calls, 1);
  // Another installation uses the same anonymous, signed channel, with no domain-bound approval.
  const other = createPublicReleaseService({ fetcher, publicKey: keys.publicKey, now: () => clock });
  assert.deepEqual((await other(current)).release, first.release);
  broken = true; clock += 16 * 60000;
  const stale = await get(current);
  assert.equal(stale.state, 'unavailable'); assert.equal(stale.stale, true); assert.equal(stale.release.revision, next);
  const count = calls; await get(current); assert.equal(calls, count, 'failure backoff');
  broken = false; clock += 61000;
  assert.equal((await get(current)).state, 'available');
  payload = sign({ ...release, revision: current, ancestors: [], publishedAt: new Date(clock).toISOString() });
  clock += 16 * 60000;
  assert.equal((await get(current)).state, 'unavailable', 'signed rollback cannot replace newer cached release');
  assert.equal((await get(current)).release.revision, next);
  clock += 2 * 86400000; broken = true;
  assert.equal((await get(current)).release, null, 'expired signed cache must not look current');
  for (const response of [
    () => new Response('x'.repeat(512 * 1024 + 1)),
    () => new Response('{}', { headers: { 'content-length': String(512 * 1024 + 1) } }),
    () => new Response('{}', { status: 404 }),
    () => new Response('not json')
  ]) {
    const invalid = createPublicReleaseService({ fetcher: async () => response(), publicKey: keys.publicKey, now: () => clock });
    assert.equal((await invalid(current)).state, 'unavailable');
  }
  const channel = JSON.parse(fs.readFileSync(path.join(__dirname, '../../releases/stable.json'), 'utf8'));
  const published = verifyPublicRelease(channel);
  assert(!Object.hasOwn(published, 'origin'));
  assert.match(fs.readFileSync(path.join(__dirname, '../src/config/release-public.pem'), 'utf8'), /^-----BEGIN PUBLIC KEY-----/);
  assert.match(fs.readFileSync(path.join(__dirname, '../.dockerignore'), 'utf8'), /^!src\/config\/release-public\.pem$/m, 'public verification key must reach Docker image');
  console.log('PASS public discovery: signatures, exact schema, public scope, digests, expiry, lineage, two installations, no credentials, no redirects, bounds, cache, single-flight, backoff and fail-closed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
