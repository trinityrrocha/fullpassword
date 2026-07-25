import { generateMasterKey, importPublicKey, decryptPrivateKey } from './cryptoService.js';

const bufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

const base64ToBuffer = (base64) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const generateClientVaultKey = async () => generateMasterKey();

export const exportClientVaultKey = async (clientVaultKey) => {
  /*
   * extractable=true é aceito somente para uma chave recém-criada e ainda
   * transitória. Chaves importadas por importClientVaultKey são operacionais,
   * non-extractable e nunca passam por este helper.
   */
  const rawKeyBytes = new Uint8Array(await window.crypto.subtle.exportKey('raw', clientVaultKey));
  try {
    return bufferToBase64(rawKeyBytes);
  } finally {
    rawKeyBytes.fill(0);
  }
};

export const importClientVaultKey = async (base64Key) => {
  const rawKeyBytes = new Uint8Array(base64ToBuffer(base64Key));
  try {
    return await window.crypto.subtle.importKey(
      'raw',
      rawKeyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } finally {
    rawKeyBytes.fill(0);
  }
};

const encryptRawVaultKeyForPublicKeys = async (rawKeyBytes, publicKeysBase64) => {
  if (!Array.isArray(publicKeysBase64) || publicKeysBase64.some((key) => !key)) {
    throw new Error('Chaves públicas dos destinatários são obrigatórias');
  }

  return Promise.all(publicKeysBase64.map(async (publicKeyBase64) => {
    const publicKey = await importPublicKey(publicKeyBase64);
    const encryptedKey = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      rawKeyBytes
    );
    return bufferToBase64(encryptedKey);
  }));
};

export const encryptVaultKeyForPublicKeys = async (clientVaultKey, publicKeysBase64) => {
  if (!clientVaultKey) throw new Error('Chave do cofre é obrigatória');

  /*
   * A exportação existe somente no escopo transitório de criação/rewrap/share.
   * O CryptoKey recebido aqui nunca deve ser armazenado no React state; os bytes
   * são sobrescritos imediatamente depois de cifrados para os destinatários.
   */
  const rawKeyBytes = new Uint8Array(await window.crypto.subtle.exportKey('raw', clientVaultKey));
  try {
    return await encryptRawVaultKeyForPublicKeys(rawKeyBytes, publicKeysBase64);
  } finally {
    rawKeyBytes.fill(0);
  }
};

export const encryptVaultKeyForPublicKey = async (clientVaultKey, publicKeyBase64) => (
  (await encryptVaultKeyForPublicKeys(clientVaultKey, [publicKeyBase64]))[0]
);

export const decryptVaultKeyShare = async (
  encryptedClientKey,
  encryptedPrivateKey,
  masterKey
) => {
  if (!encryptedClientKey || !encryptedPrivateKey || !masterKey) {
    throw new Error('Chave compartilhada, chave privada e master key são obrigatórias');
  }

  const privateKey = await decryptPrivateKey(encryptedPrivateKey, masterKey);
  const encryptedKeyBuffer = base64ToBuffer(encryptedClientKey);
  const rawKeyBytes = new Uint8Array(await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedKeyBuffer
  ));

  try {
    return await window.crypto.subtle.importKey(
      'raw',
      rawKeyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } finally {
    rawKeyBytes.fill(0);
  }
};

export const reencryptVaultKeyShareForPublicKeys = async (
  encryptedClientKey,
  encryptedPrivateKey,
  operationalMasterKey,
  publicKeysBase64
) => {
  if (!encryptedClientKey || !encryptedPrivateKey || !operationalMasterKey) {
    throw new Error('Material criptográfico do compartilhamento é obrigatório');
  }

  const privateKey = await decryptPrivateKey(encryptedPrivateKey, operationalMasterKey);
  const rawKeyBytes = new Uint8Array(await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBuffer(encryptedClientKey)
  ));

  try {
    /*
     * O plaintext da chave compartilhada existe apenas neste escopo local para
     * redistribuição RSA. Ele não vira CryptoKey extractable nem entra em state,
     * context, ref ou storage e é sobrescrito no finally.
     */
    return await encryptRawVaultKeyForPublicKeys(rawKeyBytes, publicKeysBase64);
  } finally {
    rawKeyBytes.fill(0);
  }
};
