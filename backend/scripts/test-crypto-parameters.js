const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  LEGACY_KDF_PARAMS,
  CURRENT_KDF_PARAMS,
  LEGACY_RSA_PARAMS,
  CURRENT_RSA_PARAMS,
  deriveKek,
  matchesCurrentKdfMetadata,
  getRsaPublicKeySize
} = require('../src/config/cryptoParameters');

const repositoryRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const run = async () => {
  assert.equal(LEGACY_KDF_PARAMS.iterations, 100000);
  assert.equal(CURRENT_KDF_PARAMS.iterations, 310000);
  assert.equal(LEGACY_RSA_PARAMS.modulusLength, 2048);
  assert.equal(CURRENT_RSA_PARAMS.modulusLength, 3072);
  assert.equal(matchesCurrentKdfMetadata({
    kdf_version: 2,
    kdf_name: 'PBKDF2',
    kdf_hash: 'SHA-256',
    kdf_iterations: 310000
  }), true);
  assert.equal(matchesCurrentKdfMetadata({ kdf_iterations: 100000 }), false);

  const password = 'TEST_PASSWORD_NOT_A_SECRET';
  const salt = '0123456789abcdef0123456789abcdef';
  const legacyKek = await deriveKek(password, salt, LEGACY_KDF_PARAMS);
  const currentKek = await deriveKek(password, salt, CURRENT_KDF_PARAMS);
  assert.deepEqual(
    legacyKek,
    crypto.pbkdf2Sync(password, salt, LEGACY_KDF_PARAMS.iterations, 32, 'sha256')
  );
  assert.deepEqual(
    currentKek,
    crypto.pbkdf2Sync(password, salt, CURRENT_KDF_PARAMS.iterations, 32, 'sha256')
  );
  assert.notDeepEqual(currentKek, legacyKek);
  await assert.rejects(
    deriveKek(password, 'short', CURRENT_KDF_PARAMS),
    (error) => error?.code === 'CRYPTO_SALT_REQUIRED'
  );

  const makePublicKey = (modulusLength) => crypto.generateKeyPairSync('rsa', {
    modulusLength,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  }).publicKey.toString('base64');
  assert.equal(
    getRsaPublicKeySize(makePublicKey(LEGACY_RSA_PARAMS.modulusLength)),
    LEGACY_RSA_PARAMS.modulusLength
  );
  assert.equal(
    getRsaPublicKeySize(makePublicKey(CURRENT_RSA_PARAMS.modulusLength)),
    CURRENT_RSA_PARAMS.modulusLength
  );
  assert.throws(
    () => getRsaPublicKeySize('not-a-valid-key'),
    (error) => error?.code === 'RSA_PUBLIC_KEY_INVALID'
  );

  const authController = read('backend/src/controllers/authController.js');
  const mfaController = read('backend/src/controllers/mfaController.js');
  const userController = read('backend/src/controllers/userController.js');
  const securitySchema = read('backend/src/config/securitySchema.js');
  const initSql = read('database/init.sql');
  const cryptoService = read('frontend/src/services/cryptoService.js');
  const authContext = read('frontend/src/context/AuthContext.jsx');
  const profileModal = read('frontend/src/components/UserProfileModal.jsx');

  assert.doesNotMatch(authController, /pbkdf2Sync\(/);
  assert.doesNotMatch(userController, /pbkdf2Sync\(/);
  assert.match(authController, /CURRENT_KDF_PARAMS/);
  assert.match(authController, /kdf_version, kdf_name, kdf_hash, kdf_iterations/);
  assert.match(mfaController, /kdf_version, kdf_name, kdf_hash, kdf_iterations/);
  assert.match(userController, /CURRENT_KDF_PARAMS/);
  assert.match(userController, /CURRENT_RSA_PARAMS/);
  assert.match(userController, /matchesCurrentKdfMetadata\(req\.body\)/);
  assert.match(securitySchema, /kdf_iterations INTEGER NOT NULL DEFAULT 100000/);
  assert.match(securitySchema, /rsa_key_size INTEGER NOT NULL DEFAULT 2048/);
  assert.match(initSql, /kdf_iterations INTEGER NOT NULL DEFAULT 100000/);
  assert.match(initSql, /rsa_key_size INTEGER NOT NULL DEFAULT 2048/);
  assert.match(cryptoService, /modulusLength:\s*RSA_KEY_PARAMS\.modulusLength/);
  assert.match(authContext, /resolveKdfParams\(user \|\| \{\}\)/);
  assert.match(profileModal, /deriveMasterKey\(formData\.newPassword, currentSalt, KDF_PARAMS\)/);

  console.log('Crypto parameter versioning tests passed.');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
