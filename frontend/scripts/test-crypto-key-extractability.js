import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { stdout } from 'node:process';

globalThis.window = {
  crypto: webcrypto,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value) => Buffer.from(value, 'base64').toString('binary')
};

const {
  decryptData,
  decryptPrivateKey,
  deriveMasterKey,
  encryptData,
  encryptPrivateKey,
  exportPublicKey,
  generateMasterKey,
  generateRSAKeyPair,
  importPublicKey,
  KDF_PARAMS,
  LEGACY_KDF_PARAMS,
  LEGACY_RSA_KEY_PARAMS,
  RSA_KEY_PARAMS,
  resolveKdfParams,
  unwrapMasterKey,
  unwrapMasterKeyForTransientUse,
  wrapMasterKey
} = await import('../src/services/cryptoService.js');

const {
  decryptVaultKeyShare,
  encryptWrappedVaultKeyForPublicKeys,
  encryptVaultKeyForPublicKey,
  encryptVaultKeyForPublicKeys,
  exportClientVaultKey,
  importClientVaultKey,
  reencryptVaultKeyShareForPublicKeys
} = await import('../src/services/clientVaultKeyService.js');
const {
  ensureUserCryptoIdentity,
  hasUserCryptoIdentity
} = await import('../src/services/userCryptoIdentityService.js');

const expectExportRejected = async (format, key) => {
  await assert.rejects(
    webcrypto.subtle.exportKey(format, key),
    (error) => error?.name === 'InvalidAccessException'
  );
};

const salt = '0123456789abcdef0123456789abcdef';
assert.deepEqual(resolveKdfParams({}), LEGACY_KDF_PARAMS);
assert.deepEqual(
  resolveKdfParams({
    kdf_version: 2,
    kdf_name: 'PBKDF2',
    kdf_hash: 'SHA-256',
    kdf_iterations: 310000
  }),
  KDF_PARAMS
);
assert.throws(
  () => resolveKdfParams({
    kdf_version: 2,
    kdf_name: 'PBKDF2',
    kdf_hash: 'SHA-256',
    kdf_iterations: 99999
  }),
  (error) => error?.code === 'CRYPTO_KDF_PARAMS_INVALID'
);

// Ausência de metadados mantém compatibilidade com wraps PBKDF2-100.000.
const kek = await deriveMasterKey('TEST_PASSWORD_NOT_A_SECRET', salt);
assert.equal(kek.extractable, false);
assert.deepEqual([...kek.usages].sort(), ['unwrapKey', 'wrapKey']);
await expectExportRejected('raw', kek);

const generatedMasterKey = await generateMasterKey();
assert.equal(generatedMasterKey.extractable, true);
const wrappedMasterKey = await wrapMasterKey(generatedMasterKey, kek);
const operationalMasterKey = await unwrapMasterKey(wrappedMasterKey, kek);
assert.equal(operationalMasterKey.extractable, false);
await expectExportRejected('raw', operationalMasterKey);
const encryptedPayload = await encryptData({ compatibility: true }, operationalMasterKey);
assert.deepEqual(await decryptData(encryptedPayload, operationalMasterKey), { compatibility: true });

// Novos wraps e trocas de senha usam os parâmetros versionados atuais.
const currentKdfStartedAt = performance.now();
const replacementKek = await deriveMasterKey(
  'TEST_REPLACEMENT_PASSWORD_NOT_A_SECRET',
  salt,
  KDF_PARAMS
);
const currentKdfDurationMs = performance.now() - currentKdfStartedAt;
assert.ok(currentKdfDurationMs < 10000, `PBKDF2 atual demorou ${currentKdfDurationMs.toFixed(0)} ms`);
const transientRewrapMasterKey = await unwrapMasterKeyForTransientUse(wrappedMasterKey, kek, 'rewrap');
assert.equal(transientRewrapMasterKey.extractable, true);
const rewrappedMasterKey = await wrapMasterKey(transientRewrapMasterKey, replacementKek);
const reUnlockedMasterKey = await unwrapMasterKey(rewrappedMasterKey, replacementKek);
assert.equal(reUnlockedMasterKey.extractable, false);
await expectExportRejected('raw', reUnlockedMasterKey);
assert.deepEqual(await decryptData(encryptedPayload, reUnlockedMasterKey), { compatibility: true });
await assert.rejects(
  unwrapMasterKeyForTransientUse(wrappedMasterKey, kek, 'runtime'),
  /Finalidade transitória/
);

const rsaKeyPair = await generateRSAKeyPair();
assert.equal(rsaKeyPair.publicKey.algorithm.modulusLength, RSA_KEY_PARAMS.modulusLength);
const publicKeyBase64 = await exportPublicKey(rsaKeyPair.publicKey);
const operationalPublicKey = await importPublicKey(publicKeyBase64);
assert.equal(operationalPublicKey.extractable, false);
await expectExportRejected('spki', operationalPublicKey);

const encryptedPrivateKey = await encryptPrivateKey(rsaKeyPair.privateKey, operationalMasterKey);
const operationalPrivateKey = await decryptPrivateKey(encryptedPrivateKey, operationalMasterKey);
assert.equal(operationalPrivateKey.extractable, false);
await expectExportRejected('pkcs8', operationalPrivateKey);

const rsaPlaintext = new TextEncoder().encode('compatibility-check');
const rsaCiphertext = await webcrypto.subtle.encrypt(
  { name: 'RSA-OAEP' },
  operationalPublicKey,
  rsaPlaintext
);
const rsaDecrypted = await webcrypto.subtle.decrypt(
  { name: 'RSA-OAEP' },
  operationalPrivateKey,
  rsaCiphertext
);
assert.equal(new TextDecoder().decode(rsaDecrypted), 'compatibility-check');

// A identidade RSA da conta é criada sem depender de qualquer cofre.
let savedIdentityPayload = null;
const identityResult = await ensureUserCryptoIdentity({
  user: {
    id: 'user-without-vault',
    wrapped_key: wrappedMasterKey,
    crypto_salt: salt
  },
  password: 'TEST_PASSWORD_NOT_A_SECRET',
  saveIdentity: async (payload) => {
    savedIdentityPayload = payload;
    return {
      created: true,
      key_metadata: {
        rsa_key_size: RSA_KEY_PARAMS.modulusLength,
        rsa_key_version: RSA_KEY_PARAMS.version
      }
    };
  }
});
assert.equal(identityResult.created, true);
assert.equal(hasUserCryptoIdentity(identityResult.user), true);
assert.equal(savedIdentityPayload.private_key, undefined);
assert.equal(typeof savedIdentityPayload.public_key, 'string');
assert.equal(typeof savedIdentityPayload.encrypted_private_key, 'string');
const identityPrivateKey = await decryptPrivateKey(
  savedIdentityPayload.encrypted_private_key,
  operationalMasterKey
);
assert.equal(identityPrivateKey.extractable, false);
await expectExportRejected('pkcs8', identityPrivateKey);

let idempotentSaveCalled = false;
const existingIdentityResult = await ensureUserCryptoIdentity({
  user: identityResult.user,
  password: 'IGNORED_PASSWORD',
  saveIdentity: async () => {
    idempotentSaveCalled = true;
  }
});
assert.equal(existingIdentityResult.created, false);
assert.equal(idempotentSaveCalled, false);

// Pares RSA-2048 existentes continuam importáveis e utilizáveis.
const legacyRsaKeyPair = await webcrypto.subtle.generateKey(
  {
    name: 'RSA-OAEP',
    modulusLength: LEGACY_RSA_KEY_PARAMS.modulusLength,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  },
  true,
  ['encrypt', 'decrypt']
);
const legacyPublicKeyBase64 = await exportPublicKey(legacyRsaKeyPair.publicKey);
const importedLegacyPublicKey = await importPublicKey(legacyPublicKeyBase64);
assert.equal(importedLegacyPublicKey.algorithm.modulusLength, LEGACY_RSA_KEY_PARAMS.modulusLength);
const encryptedLegacyPrivateKey = await encryptPrivateKey(legacyRsaKeyPair.privateKey, operationalMasterKey);
const importedLegacyPrivateKey = await decryptPrivateKey(encryptedLegacyPrivateKey, operationalMasterKey);
assert.equal(importedLegacyPrivateKey.algorithm.modulusLength, LEGACY_RSA_KEY_PARAMS.modulusLength);
const legacyCiphertext = await webcrypto.subtle.encrypt(
  { name: 'RSA-OAEP' },
  importedLegacyPublicKey,
  rsaPlaintext
);
const legacyPlaintext = await webcrypto.subtle.decrypt(
  { name: 'RSA-OAEP' },
  importedLegacyPrivateKey,
  legacyCiphertext
);
assert.equal(new TextDecoder().decode(legacyPlaintext), 'compatibility-check');

const exportedVaultKey = await exportClientVaultKey(generatedMasterKey);
const importedOperationalVaultKey = await importClientVaultKey(exportedVaultKey);
assert.equal(importedOperationalVaultKey.extractable, false);
await expectExportRejected('raw', importedOperationalVaultKey);

const encryptedVaultKey = await encryptVaultKeyForPublicKey(generatedMasterKey, publicKeyBase64);
const sharedOperationalVaultKey = await decryptVaultKeyShare(
  encryptedVaultKey,
  encryptedPrivateKey,
  operationalMasterKey
);
assert.equal(sharedOperationalVaultKey.extractable, false);
await expectExportRejected('raw', sharedOperationalVaultKey);

const sharedPayload = await encryptData({ shared: true }, sharedOperationalVaultKey);
assert.deepEqual(await decryptData(sharedPayload, sharedOperationalVaultKey), { shared: true });

const legacyEncryptedVaultKey = await encryptVaultKeyForPublicKey(
  generatedMasterKey,
  legacyPublicKeyBase64
);
const legacySharedOperationalVaultKey = await decryptVaultKeyShare(
  legacyEncryptedVaultKey,
  encryptedLegacyPrivateKey,
  operationalMasterKey
);
assert.equal(legacySharedOperationalVaultKey.extractable, false);
await expectExportRejected('raw', legacySharedOperationalVaultKey);
assert.deepEqual(
  await decryptData(sharedPayload, legacySharedOperationalVaultKey),
  { shared: true }
);

const reencryptedVaultKeys = await reencryptVaultKeyShareForPublicKeys(
  encryptedVaultKey,
  encryptedPrivateKey,
  operationalMasterKey,
  [publicKeyBase64]
);
assert.equal(reencryptedVaultKeys.length, 1);
const resharedOperationalVaultKey = await decryptVaultKeyShare(
  reencryptedVaultKeys[0],
  encryptedPrivateKey,
  operationalMasterKey
);
assert.equal(resharedOperationalVaultKey.extractable, false);
await expectExportRejected('raw', resharedOperationalVaultKey);
assert.deepEqual(await decryptData(sharedPayload, resharedOperationalVaultKey), { shared: true });

const transientShareMasterKey = await unwrapMasterKeyForTransientUse(wrappedMasterKey, kek, 'share');
const ownerEncryptedKeys = await encryptVaultKeyForPublicKeys(
  transientShareMasterKey,
  [publicKeyBase64]
);
assert.equal(ownerEncryptedKeys.length, 1);
await encryptVaultKeyForPublicKey(transientShareMasterKey, publicKeyBase64);
const ownerSharedOperationalKey = await decryptVaultKeyShare(
  ownerEncryptedKeys[0],
  encryptedPrivateKey,
  operationalMasterKey
);
assert.equal(ownerSharedOperationalKey.extractable, false);
await expectExportRejected('raw', ownerSharedOperationalKey);
assert.deepEqual(await decryptData(encryptedPayload, ownerSharedOperationalKey), { compatibility: true });

// Regressão: o share usa o wrapped key exato pareado com a KEK no desbloqueio,
// persiste as chaves e permissões e continua utilizável após recarregar o estado.
const persistedSharing = { keyShares: new Map(), groupShares: [] };
const recipientKeyPair = await generateRSAKeyPair();
const recipientPublicKey = await exportPublicKey(recipientKeyPair.publicKey);
const recipientKek = await deriveMasterKey(
  'TEST_RECIPIENT_PASSWORD_NOT_A_SECRET',
  'recipient-salt-0123456789abcdef'
);
const recipientGeneratedMasterKey = await generateMasterKey();
const recipientWrappedMasterKey = await wrapMasterKey(recipientGeneratedMasterKey, recipientKek);
const recipientOperationalMasterKey = await unwrapMasterKey(
  recipientWrappedMasterKey,
  recipientKek
);
const recipientEncryptedPrivateKey = await encryptPrivateKey(
  recipientKeyPair.privateKey,
  recipientOperationalMasterKey
);
const transientEncryptedKeys = await encryptWrappedVaultKeyForPublicKeys(
  wrappedMasterKey,
  kek,
  [recipientPublicKey]
);
persistedSharing.keyShares.set('recipient-user', transientEncryptedKeys[0]);
persistedSharing.groupShares = [{ group_id: 'shared-group', can_view: true }];

const reloadedGroupShares = structuredClone(persistedSharing.groupShares);
const reloadedEncryptedKey = persistedSharing.keyShares.get('recipient-user');
assert.deepEqual(reloadedGroupShares, [{ group_id: 'shared-group', can_view: true }]);
const reloadedSharedKey = await decryptVaultKeyShare(
  reloadedEncryptedKey,
  recipientEncryptedPrivateKey,
  recipientOperationalMasterKey
);
assert.equal(reloadedSharedKey.extractable, false);
await expectExportRejected('raw', reloadedSharedKey);
assert.deepEqual(await decryptData(encryptedPayload, reloadedSharedKey), { compatibility: true });

stdout.write(
  `Crypto parameter, extractability and compatibility tests passed ` +
  `(PBKDF2-310000: ${currentKdfDurationMs.toFixed(0)} ms).\n`
);
