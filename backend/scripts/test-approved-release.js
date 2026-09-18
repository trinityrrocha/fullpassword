const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {validateManifest}=require('../../scripts/deploy-approved-release');
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
const manifest={repository:'trinityrrocha/fullpassword',revision:'a'.repeat(40),origin:'https://test.example.invalid',
 backend:'ghcr.io/trinityrrocha/fullpassword-backend@sha256:'+'b'.repeat(64),frontend:'ghcr.io/trinityrrocha/fullpassword-frontend@sha256:'+'c'.repeat(64)};
const policy={origin:manifest.origin,environment:'test',approvedRevision:manifest.revision};
const verify=value=>{const bytes=Buffer.from(JSON.stringify(value));return validateManifest(bytes,crypto.sign('sha256',bytes,privateKey),publicKey,policy);};
assert.equal(verify(manifest).revision,manifest.revision);
assert.throws(()=>verify({...manifest,revision:'d'.repeat(40)}),/NOT_APPROVED/);
assert.throws(()=>verify({...manifest,repository:'attacker/repo'}),/ORIGIN/);
assert.throws(()=>verify({...manifest,backend:'ghcr.io/trinityrrocha/fullpassword-backend:latest'}),/UNPINNED/);
assert.throws(()=>verify({...manifest,origin:'https://production.example.invalid'}),/TEST_ENVIRONMENT/);
assert.throws(()=>validateManifest(Buffer.from(JSON.stringify(manifest)),Buffer.alloc(384),publicKey,policy),/SIGNATURE/);
console.log('PASS signed release: invalid signature/origin/mutable tag/non-test target rejected; no deployment executed.');
