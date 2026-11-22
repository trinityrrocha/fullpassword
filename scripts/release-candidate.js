// Maintainer tooling, runs in CI and offline. Builds the UNSIGNED release candidate and, offline, signs the stable channel.
//   node scripts/release-candidate.js candidate --revision SHA --backend REF@sha256:.. --frontend REF@sha256:.. --out release-candidate.json
//   node scripts/release-candidate.js sign release-candidate.json /path/OUTSIDE/checkout/release-private.pem
// The private key never enters GitHub or the checkout; "sign" refuses a key inside the checkout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const SHA = /^[a-f0-9]{40}$/;
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const TYPES = { feat: 'feat', fix: 'fix', security: 'security', perf: 'perf' };

// Release notes from commit subjects since the previous stable revision. Presentation only.
const changesSince = (previous, revision) => {
  const range = previous && SHA.test(previous) ? `${previous}..${revision}` : revision;
  const subjects = git('log', '--no-merges', '--format=%s', '-n', '200', range).split('\n').filter(Boolean);
  const seen = new Set();
  const changes = [];
  for (const subject of subjects) {
    const match = /^(feat|fix|security|perf)(?:\([^)]*\))?!?:\s*(.+)$/i.exec(subject);
    const title = (match ? match[2] : subject).replace(/[<>\x00-\x1f\x7f`]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 200).trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    changes.push({ type: match ? TYPES[match[1].toLowerCase()] : 'change', title });
    if (changes.length === 50) break;
  }
  return changes.length ? changes : [{ type: 'release', title: 'Atualização de manutenção' }];
};

const candidate = ({ revision, backend, frontend, previous }) => {
  if (!SHA.test(revision)) throw new Error('EXACT_REVISION_REQUIRED');
  for (const [service, ref] of [['backend', backend], ['frontend', frontend]]) {
    if (!new RegExp(`^ghcr\\.io/trinityrrocha/fullpassword-${service}@sha256:[a-f0-9]{64}$`).test(ref || '')) throw new Error('UNPINNED_RELEASE_IMAGE');
  }
  return { revision, backend, frontend, changes: changesSince(previous, revision) };
};

const sign = (candidateFile, privateKeyFile, outputFile = path.join(ROOT, 'releases/stable.json'), now = Date.now()) => {
  const signerPath = fs.realpathSync(privateKeyFile);
  const relative = path.relative(fs.realpathSync(ROOT), signerPath);
  if (!relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('EXTERNAL_SIGNER_REQUIRED');
  const value = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
  const checked = candidate({ ...value, previous: null }); // re-validates shapes; notes below come from the candidate itself
  const ancestors = git('rev-list', checked.revision).split(/\r?\n/).filter((entry) => entry && entry !== checked.revision);
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: 'trinityrrocha/fullpassword', channel: 'stable', revision: checked.revision,
    backend: checked.backend, frontend: checked.frontend, publishedAt: new Date(now).toISOString(), expiresAt: new Date(now + 90 * 86400000).toISOString(),
    ancestors, changes: value.changes }));
  const envelope = { payload: payload.toString('base64'), signature: crypto.sign('sha256', payload, fs.readFileSync(signerPath)).toString('base64') };
  const { verifyPublicRelease } = require('../backend/src/services/publicReleaseService');
  verifyPublicRelease(envelope, fs.readFileSync(path.join(ROOT, 'backend/src/config/release-public.pem')), now); // key, schema, history, immutable images
  fs.writeFileSync(outputFile, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o644 });
  return checked.revision;
};

if (require.main === module) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (command === 'candidate') {
      const options = Object.fromEntries(rest.reduce((pairs, item, index, all) => (item.startsWith('--') ? [...pairs, [item.slice(2), all[index + 1]]] : pairs), []));
      let previous = null;
      try { previous = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(path.join(ROOT, 'releases/stable.json'), 'utf8')).payload, 'base64')).revision; } catch { /* first release */ }
      fs.writeFileSync(options.out, JSON.stringify(candidate({ ...options, previous }), null, 2) + '\n', { flag: 'wx' });
      console.log(`Release candidate written for ${options.revision}`);
    } else if (command === 'sign' && rest.length === 2) {
      console.log(`Signed stable channel written for ${sign(rest[0], rest[1])}. Commit releases/stable.json in a pull request.`);
    } else throw new Error('USAGE');
  } catch (error) { console.error(`RELEASE_TOOLING_FAILED: ${error.message}`); process.exitCode = 1; }
}
module.exports = { candidate, sign, changesSince };
