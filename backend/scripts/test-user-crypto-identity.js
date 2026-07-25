const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  MAX_PUBLIC_KEY_LENGTH,
  MAX_ENCRYPTED_PRIVATE_KEY_LENGTH,
  validateUserCryptoIdentityPayload,
  cryptoIdentityMatches
} = require('../src/services/userCryptoIdentityService');

const repositoryRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const keyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicExponent: 0x10001,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' }
});
const publicKey = keyPair.publicKey.toString('base64');
const encryptedPrivateKey = `${crypto.randomBytes(12).toString('base64')}:${crypto.randomBytes(2048).toString('base64')}`;
const identity = validateUserCryptoIdentityPayload({
  public_key: publicKey,
  encrypted_private_key: encryptedPrivateKey
});

assert.equal(identity.rsaKeySize, 3072);
assert.equal(cryptoIdentityMatches({
  public_key: publicKey,
  encrypted_private_key: encryptedPrivateKey
}, identity), true);
assert.equal(cryptoIdentityMatches({
  public_key: publicKey,
  encrypted_private_key: `${crypto.randomBytes(12).toString('base64')}:${crypto.randomBytes(32).toString('base64')}`
}, identity), false);

const legacyKeyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' }
});
const legacyIdentity = validateUserCryptoIdentityPayload({
  public_key: legacyKeyPair.publicKey.toString('base64'),
  encrypted_private_key: encryptedPrivateKey
});
assert.equal(legacyIdentity.rsaKeySize, 2048);

assert.throws(
  () => validateUserCryptoIdentityPayload({
    public_key: 'not-base64',
    encrypted_private_key: encryptedPrivateKey
  }),
  (error) => error?.statusCode === 400
);
assert.throws(
  () => validateUserCryptoIdentityPayload({
    public_key: publicKey,
    encrypted_private_key: 'invalid'
  }),
  (error) => error?.statusCode === 400
);
assert.throws(
  () => validateUserCryptoIdentityPayload({
    public_key: 'A'.repeat(MAX_PUBLIC_KEY_LENGTH + 1),
    encrypted_private_key: encryptedPrivateKey
  }),
  (error) => error?.statusCode === 400
);
assert.throws(
  () => validateUserCryptoIdentityPayload({
    public_key: publicKey,
    encrypted_private_key: 'A'.repeat(MAX_ENCRYPTED_PRIVATE_KEY_LENGTH + 1)
  }),
  (error) => error?.statusCode === 400
);

const controller = read('backend/src/controllers/userController.js');
const backendCryptoIdentityService = read('backend/src/services/userCryptoIdentityService.js');
const userRoutes = read('backend/src/routes/userRoutes.js');
assert.match(controller, /FROM users[\s\S]*FOR UPDATE/);
assert.match(controller, /cryptoIdentityMatches\(currentUser, identity\)/);
assert.match(controller, /CRYPTO_IDENTITY_ALREADY_CONFIGURED/);
assert.match(controller, /public_key IS NULL AND encrypted_private_key IS NULL/);
assert.doesNotMatch(controller, /generateKeyPair|privateKey/);
assert.doesNotMatch(backendCryptoIdentityService, /generateKeyPair|privateKey/);
assert.match(userRoutes, /router\.use\(verifyToken\)[\s\S]*router\.put\('\/keys', userController\.updateKeys\)/);

console.log('User crypto identity backend tests passed.');
