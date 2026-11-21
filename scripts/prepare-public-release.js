// Offline channel publication. The private signing key stays outside the checkout/VM.
// This produces discovery metadata only; it cannot approve or deploy an installation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyPublicRelease } = require('../backend/src/services/publicReleaseService');
function prepare(manifestFile, signatureFile, privateKeyFile, outputFile) {
  const checkout = fs.realpathSync(path.join(__dirname, '..'));
  const signerPath = fs.realpathSync(privateKeyFile);
  const relative = path.relative(checkout, signerPath);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error('EXTERNAL_SIGNER_REQUIRED');
  const bytes = fs.readFileSync(manifestFile);
  const publicKey = fs.readFileSync(path.join(__dirname, '../backend/src/config/release-public.pem'));
  if (!crypto.verify('sha256', bytes, publicKey, fs.readFileSync(signatureFile))) throw new Error('REVIEWED_MANIFEST_SIGNATURE_REQUIRED');
  const manifest = JSON.parse(bytes);
  if (!/^[a-f0-9]{40}$/.test(manifest.revision || '')) throw new Error('EXACT_REVISION_REQUIRED');
  const ancestors = execFileSync('git', ['rev-list', manifest.revision], { cwd: path.join(__dirname, '..'), encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(sha => sha !== manifest.revision);
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: manifest.repository, channel: 'stable',
    revision: manifest.revision, backend: manifest.backend, frontend: manifest.frontend,
    publishedAt: new Date(now).toISOString(), expiresAt: new Date(now + 90 * 86400000).toISOString(),
    ancestors, changes: manifest.changes || [] }));
  const envelope = { payload: payload.toString('base64'), signature: crypto.sign('sha256', payload, fs.readFileSync(signerPath)).toString('base64') };
  verifyPublicRelease(envelope, publicKey, now); // includes key, repository, history and immutable registry checks
  fs.writeFileSync(outputFile, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  return manifest.revision;
}
if (require.main === module) {
  try {
    if (process.argv.length !== 6) throw new Error('Usage: node scripts/prepare-public-release.js MANIFEST SIGNATURE EXTERNAL_PRIVATE_KEY NEW_OUTPUT');
    console.log('Signed public discovery channel prepared: ' + prepare(...process.argv.slice(2)));
  } catch { console.error('PUBLIC_CHANNEL_PREPARATION_FAILED: verify signed input, external signer and new output path.'); process.exitCode = 1; }
}
module.exports = { prepare };
