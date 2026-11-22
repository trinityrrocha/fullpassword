// Unit tests for the host auto-updater's pure parts (signed channel, catalog shape, request validation).
// The orchestration (backup, rollback, crash reconciliation) is proven with real Docker in test-auto-update-docker.js.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agent = require('../../scripts/auto-update-agent');
const { verifyPublicRelease } = require('../src/services/publicReleaseService');

const publicKey = fs.readFileSync(path.join(__dirname, '../src/config/release-public.pem'));
const envelope = JSON.parse(fs.readFileSync(path.join(__dirname, '../../releases/stable.json'), 'utf8'));
const now = Date.parse(JSON.parse(Buffer.from(envelope.payload, 'base64')).publishedAt) + 3600000;

// The agent and the backend reader must accept and reject exactly the same channel.
const fromAgent = agent.verifyChannel(envelope, publicKey, { now });
assert.deepEqual(fromAgent.release, verifyPublicRelease(envelope, publicKey, now));
assert.match(fromAgent.hash, /^[a-f0-9]{64}$/);
assert.throws(() => agent.verifyChannel({ ...envelope, payload: envelope.payload.slice(0, -8) + 'AAAAAAAA' }, publicKey, { now }), /INVALID_CHANNEL/);
assert.throws(() => agent.verifyChannel(envelope, publicKey, { now: Date.parse(fromAgent.release.expiresAt) + 1 }), /CHANNEL_EXPIRED/);
assert.throws(() => agent.verifyChannel(envelope, publicKey, { now, registry: '127.0.0.1:5000' }), /UNPINNED_RELEASE_IMAGE/, 'images must come from the configured registry');
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 }).publicKey.export({ type: 'spki', format: 'pem' });
assert.throws(() => agent.verifyChannel(envelope, other, { now }), /INVALID_CHANNEL_SIGNATURE/, 'a different signer is never trusted');

// A signed payload with extra keys is rejected (strict schema).
const { privateKey, publicKey: ownPublic } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const sign = (value) => { const payload = Buffer.from(JSON.stringify(value)); return { payload: payload.toString('base64'), signature: crypto.sign('sha256', payload, privateKey).toString('base64') }; };
const good = { ...fromAgent.release, publishedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 86400000).toISOString() };
assert.equal(agent.verifyChannel(sign(good), ownPublic, { now }).release.revision, good.revision);
assert.throws(() => agent.verifyChannel(sign({ ...good, command: 'rm -rf /' }), ownPublic, { now }), /INVALID_CHANNEL/);
assert.throws(() => agent.verifyChannel(sign({ ...good, backend: 'ghcr.io/evil/backend@sha256:' + 'a'.repeat(64) }), ownPublic, { now }), /UNPINNED_RELEASE_IMAGE/);
assert.throws(() => agent.verifyChannel(sign({ ...good, ancestors: [good.revision] }), ownPublic, { now }), /INVALID_CHANNEL_HISTORY/);

// Catalog: exactly what the existing controller/panel validate, derived only from signed bytes.
const catalog = agent.catalogFor({ origin: 'https://example.invalid' }, fromAgent);
assert.match(catalog.approvalId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
assert.equal(catalog.manifestHash, fromAgent.hash); assert.equal(catalog.revision, fromAgent.release.revision);
assert.equal(agent.approvalIdFor('0123456789abcdef'.repeat(4)), '01234567-89ab-cdef-0123-456789abcdef');

// Request file: strict shape, no symlinks, bounded size.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-unit-'));
const uuid = crypto.randomUUID();
const request = { approvalId: uuid, manifestHash: 'a'.repeat(64), requestId: crypto.randomUUID(), revision: 'b'.repeat(40) };
fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify(request));
assert.deepEqual(agent.readRequest(path.join(dir, 'ok.json')), request);
fs.writeFileSync(path.join(dir, 'extra.json'), JSON.stringify({ ...request, image: 'x' }));
assert.throws(() => agent.readRequest(path.join(dir, 'extra.json')), /INVALID_REQUEST/);
fs.symlinkSync(path.join(dir, 'ok.json'), path.join(dir, 'link.json'));
assert.throws(() => agent.readRequest(path.join(dir, 'link.json')));
fs.writeFileSync(path.join(dir, 'big.json'), ' '.repeat(2000));
assert.throws(() => agent.readRequest(path.join(dir, 'big.json')), /INVALID_REQUEST_FILE/);
assert.deepEqual(agent.parseEnv('A=1\nB=x=y\n#c\n'), { A: '1', B: 'x=y' });
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS auto-update agent unit: strict signed channel (same as backend reader), catalog shape, request validation.');
