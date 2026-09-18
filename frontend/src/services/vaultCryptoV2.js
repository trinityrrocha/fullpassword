// Versioned migration primitives. Not yet enabled by the application.
// The independent unlock secret must never be submitted to an API.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const VAULT_CRYPTO_VERSION = 2;
export const UNLOCK_KDF = Object.freeze({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
const b64 = bytes => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 32768) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 32768));
  }
  return btoa(binary);
};
const unb64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
const context = (purpose, ...values) => {
  if (values.some(value => typeof value !== 'string' || !value || value.length > 256)) throw new Error('Invalid encryption context');
  return encoder.encode(JSON.stringify(['FullPassword', VAULT_CRYPTO_VERSION, purpose, ...values]));
};
const importAes = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const seal = async (key, bytes, aad) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { version: VAULT_CRYPTO_VERSION, iv: b64(iv), ciphertext: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, bytes)) };
};
const open = async (key, envelope, aad) => {
  if (envelope?.version !== VAULT_CRYPTO_VERSION) throw new Error('Unsupported encryption version');
  const iv = unb64(envelope.iv);
  if (iv.length !== 12) throw new Error('Invalid nonce');
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, unb64(envelope.ciphertext));
};
const deriveUnlockKey = async (secret, salt, params = UNLOCK_KDF) => {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('Use an independent unlock secret of at least 16 characters');
  if (params.name !== 'PBKDF2' || params.hash !== 'SHA-256' || params.iterations !== 600000 || salt.length !== 32) throw new Error('Invalid unlock KDF');
  const source = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ ...params, salt }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};
const fingerprint = async publicKey => b64(await crypto.subtle.digest('SHA-256', unb64(publicKey)));

export const createIndependentIdentity = async (userId, unlockSecret) => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const rawMaster = crypto.getRandomValues(new Uint8Array(32));
  let privateBytes;
  try {
    const masterKey = await importAes(rawMaster);
    const kek = await deriveUnlockKey(unlockSecret, salt);
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const publicKey = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
    privateBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    return {
      version: VAULT_CRYPTO_VERSION, userId, kdf: { ...UNLOCK_KDF }, salt: b64(salt), publicKey,
      fingerprint: await fingerprint(publicKey),
      wrappedMasterKey: await seal(kek, rawMaster, context('personal-master', userId)),
      encryptedPrivateKey: await seal(masterKey, privateBytes, context('personal-private', userId))
    };
  } finally { rawMaster.fill(0); privateBytes?.fill(0); }
};

export const unlockIndependentIdentity = async (identity, unlockSecret) => {
  if (identity.version !== VAULT_CRYPTO_VERSION || identity.fingerprint !== await fingerprint(identity.publicKey)) throw new Error('Invalid identity');
  const kek = await deriveUnlockKey(unlockSecret, unb64(identity.salt), identity.kdf);
  const rawMaster = new Uint8Array(await open(kek, identity.wrappedMasterKey, context('personal-master', identity.userId)));
  let privateBytes;
  try {
    const masterKey = await importAes(rawMaster);
    privateBytes = new Uint8Array(await open(masterKey, identity.encryptedPrivateKey, context('personal-private', identity.userId)));
    const privateKey = await crypto.subtle.importKey('pkcs8', privateBytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    return { masterKey, privateKey };
  } finally { rawMaster.fill(0); privateBytes?.fill(0); }
};

export const createVaultEpoch = async (vaultId, epoch, recipients) => {
  if (!Number.isSafeInteger(epoch) || epoch < 1 || !recipients.length) throw new Error('Invalid vault epoch');
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  try {
    const envelopes = [];
    const seen = new Set();
    for (const recipient of recipients) {
      if (seen.has(recipient.userId) || recipient.fingerprint !== await fingerprint(recipient.publicKey)) throw new Error('Invalid recipient identity');
      seen.add(recipient.userId);
      const publicKey = await crypto.subtle.importKey('spki', unb64(recipient.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      if (publicKey.algorithm.modulusLength < 3072) throw new Error('Invalid recipient RSA strength');
      const label = context('vault-key', vaultId, String(epoch), recipient.userId, recipient.fingerprint);
      envelopes.push({ version: VAULT_CRYPTO_VERSION, vaultId, epoch, userId: recipient.userId, fingerprint: recipient.fingerprint,
        ciphertext: b64(await crypto.subtle.encrypt({ name: 'RSA-OAEP', label }, publicKey, rawKey)) });
    }
    return { key: await importAes(rawKey), envelopes };
  } finally { rawKey.fill(0); }
};

export const openVaultEnvelope = async (privateKey, envelope, expected) => {
  if (envelope.version !== VAULT_CRYPTO_VERSION || ['vaultId', 'epoch', 'userId', 'fingerprint'].some(field => envelope[field] !== expected[field])) throw new Error('Vault envelope context mismatch');
  const label = context('vault-key', expected.vaultId, String(expected.epoch), expected.userId, expected.fingerprint);
  const rawKey = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP', label }, privateKey, unb64(envelope.ciphertext)));
  try { return await importAes(rawKey); } finally { rawKey.fill(0); }
};
const recordContext = metadata => {
  if (!Number.isSafeInteger(metadata.epoch) || metadata.epoch < 1 || !Number.isSafeInteger(metadata.revision) || metadata.revision < 1) throw new Error('Invalid record version');
  return context('record', metadata.vaultId, metadata.recordId, metadata.category, String(metadata.epoch), String(metadata.revision));
};
export const encryptVaultRecord = (key, metadata, plaintext) => seal(key, encoder.encode(JSON.stringify(plaintext)), recordContext(metadata));
export const decryptVaultRecord = async (key, metadata, envelope) => JSON.parse(decoder.decode(await open(key, envelope, recordContext(metadata))));

// Candidate ciphertexts are staged, never written over the legacy source here.
// Caller must authenticate persisted candidates and atomically activate the batch.
export const stageVaultRecords = async (key, { vaultId, epoch }, records, verifiedExisting = new Map()) => {
  const result = [];
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error('Duplicate migration record');
    seen.add(record.id);
    const metadata = { vaultId, epoch, recordId: record.id, category: record.category, revision: 1 };
    const envelope = verifiedExisting.get(record.id) || await encryptVaultRecord(key, metadata, record.data);
    const verified = await decryptVaultRecord(key, metadata, envelope);
    if (JSON.stringify(verified) !== JSON.stringify(record.data)) throw new Error('Migration integrity mismatch');
    result.push({ ...metadata, envelope });
  }
  return result;
};
