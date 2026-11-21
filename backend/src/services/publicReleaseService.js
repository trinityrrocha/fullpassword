// Public discovery is NOT deployment authority. Never write approvals, queues or policy here.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const CHANNEL_URL = 'https://raw.githubusercontent.com/trinityrrocha/fullpassword/main/releases/stable.json';
const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, '../config/release-public.pem'));
const SHA = /^[a-f0-9]{40}$/;
const LIMIT = 512 * 1024;
const TTL = 15 * 60 * 1000;
const exact = (value, keys) => value && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');

function verifyPublicRelease(envelope, publicKey = PUBLIC_KEY, now = Date.now()) {
  if (!exact(envelope, ['payload', 'signature']) || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' ||
      envelope.payload.length > LIMIT || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) ||
      envelope.signature.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature)) throw new Error('INVALID_PUBLIC_RELEASE');
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!crypto.verify('sha256', bytes, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('INVALID_PUBLIC_RELEASE_SIGNATURE');
  const value = JSON.parse(bytes);
  if (!exact(value, ['schemaVersion', 'repository', 'channel', 'revision', 'publishedAt', 'expiresAt', 'backend', 'frontend', 'ancestors', 'changes']) ||
      value.schemaVersion !== 1 || value.repository !== 'trinityrrocha/fullpassword' || value.channel !== 'stable' || !SHA.test(value.revision)) throw new Error('INVALID_PUBLIC_RELEASE');
  const published = Date.parse(value.publishedAt), expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(published) || !Number.isFinite(expiry) || published > now + 300000 || expiry <= now ||
      expiry <= published || expiry - published > 90 * 86400000) throw new Error('PUBLIC_RELEASE_EXPIRED');
  for (const service of ['backend', 'frontend']) {
    if (!new RegExp('^ghcr\\.io/trinityrrocha/fullpassword-' + service + '@sha256:[a-f0-9]{64}$').test(value[service])) throw new Error('INVALID_PUBLIC_RELEASE_IMAGE');
  }
  if (!Array.isArray(value.ancestors) || value.ancestors.length > 5000 || value.ancestors.some(sha => !SHA.test(sha) || sha === value.revision) ||
      new Set(value.ancestors).size !== value.ancestors.length) throw new Error('INVALID_PUBLIC_RELEASE_HISTORY');
  if (!Array.isArray(value.changes) || value.changes.length > 50 || value.changes.some(item =>
    !exact(item, ['type', 'title']) || !['fix', 'feat', 'security', 'perf', 'release', 'change'].includes(item.type) ||
    typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200 || /[<>\x00-\x1f\x7f]/u.test(item.title))) throw new Error('INVALID_PUBLIC_RELEASE_NOTES');
  return value;
}

async function download(fetcher) {
  // Fixed destination, no tenant ID/domain/credentials, no redirects, no URL from requests or catalog.
  const response = await fetcher(CHANNEL_URL, { redirect: 'error', signal: AbortSignal.timeout(3000),
    headers: { Accept: 'application/json' } });
  if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) throw new Error('PUBLIC_RELEASE_UNAVAILABLE');
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > LIMIT) throw new Error('PUBLIC_RELEASE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

function createPublicReleaseService({ fetcher = global.fetch, publicKey = PUBLIC_KEY, now = Date.now } = {}) {
  let cached = null, checkedAt = null, retryAt = 0, pending = null, failed = false;
  async function refresh() {
    try {
      const candidate = verifyPublicRelease(await download(fetcher), publicKey, now());
      if (cached && (Date.parse(candidate.publishedAt) < Date.parse(cached.publishedAt) ||
          (candidate.revision !== cached.revision && !candidate.ancestors.includes(cached.revision)))) throw new Error('PUBLIC_RELEASE_ROLLBACK');
      cached = candidate;
      failed = false;
      checkedAt = new Date(now()).toISOString();
      retryAt = now() + TTL;
    } catch {
      failed = true;
      retryAt = now() + 60000;
    }
  }
  return async function getPublicRelease(installedRevision) {
    if (!SHA.test(installedRevision || '')) return { state: 'unidentified', release: null, checkedAt: null };
    if (now() >= retryAt) {
      if (!pending) pending = refresh().finally(() => { pending = null; });
      await pending;
    } else if (pending) await pending;
    const expired = cached && Date.parse(cached.expiresAt) <= now();
    const release = cached && !expired ? Object.fromEntries(Object.entries(cached).filter(([key]) => key !== 'ancestors')) : null;
    return { state: failed || expired ? 'unavailable' : cached?.revision === installedRevision ? 'current' :
      cached?.ancestors.includes(installedRevision) ? 'available' : 'unrecognized',
      release, checkedAt, stale: failed || Boolean(expired) };
  };
}
module.exports = { CHANNEL_URL, verifyPublicRelease, createPublicReleaseService, getPublicRelease: createPublicReleaseService() };
