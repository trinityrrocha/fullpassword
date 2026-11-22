// Offline signing tool: external key required, strict output accepted by both the backend reader and the host agent.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tool = require('../../scripts/release-candidate');
const agent = require('../../scripts/auto-update-agent');
const root = path.join(__dirname, '../..');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const ref = (service) => `ghcr.io/trinityrrocha/fullpassword-${service}@sha256:${'a'.repeat(64)}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
const value = tool.candidate({ revision, backend: ref('backend'), frontend: ref('frontend'), previous: null });
assert.ok(value.changes.length >= 1 && value.changes.every((c) => c.title.length <= 200 && !/[<>`]/.test(c.title)));
assert.throws(() => tool.candidate({ revision, backend: 'ghcr.io/evil/x@sha256:' + 'a'.repeat(64), frontend: ref('frontend') }), /UNPINNED/);
assert.throws(() => tool.candidate({ revision: 'main', backend: ref('backend'), frontend: ref('frontend') }), /EXACT_REVISION/);
const candidateFile = path.join(dir, 'candidate.json'); fs.writeFileSync(candidateFile, JSON.stringify(value));
// A key inside the checkout is refused: signing is offline by design.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const insideKey = path.join(root, `.tmp-key-${process.pid}.pem`); fs.writeFileSync(insideKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
try { assert.throws(() => tool.sign(candidateFile, insideKey, path.join(dir, 'out.json')), /EXTERNAL_SIGNER_REQUIRED/); } finally { fs.rmSync(insideKey); }
// Signed with a key that is not the embedded public key: the tool's own verification refuses to publish it.
const outsideKey = path.join(dir, 'key.pem'); fs.writeFileSync(outsideKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
assert.throws(() => tool.sign(candidateFile, outsideKey, path.join(dir, 'out.json')), /INVALID_PUBLIC_RELEASE_SIGNATURE/);
assert.equal(fs.existsSync(path.join(dir, 'out.json')), false, 'nothing is written for a wrong key');
assert.deepEqual(tool.changesSince(null, revision).map((c) => Object.keys(c).sort().join()), tool.changesSince(null, revision).map(() => 'title,type'));
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS release candidate/sign tooling: strict input, external signer only, verified before writing.');
