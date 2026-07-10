import { generateMasterKey, importPublicKey, decryptPrivateKey } from './cryptoService';

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
  const rawKey = await window.crypto.subtle.exportKey('raw', clientVaultKey);
  return bufferToBase64(rawKey);
};

export const importClientVaultKey = async (base64Key) => {
  const rawKey = base64ToBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};

export const encryptVaultKeyForPublicKey = async (clientVaultKey, publicKeyBase64) => {
  if (!clientVaultKey || !publicKeyBase64) {
    throw new Error('Chave do cofre e chave pública são obrigatórias');
  }

  const publicKey = await importPublicKey(publicKeyBase64);
  const rawKey = await window.crypto.subtle.exportKey('raw', clientVaultKey);
  const encryptedKey = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    rawKey
  );

  return bufferToBase64(encryptedKey);
};

export const decryptVaultKeyShare = async (encryptedClientKey, encryptedPrivateKey, masterKey) => {
  if (!encryptedClientKey || !encryptedPrivateKey || !masterKey) {
    throw new Error('Chave compartilhada, chave privada e master key são obrigatórias');
  }

  const privateKey = await decryptPrivateKey(encryptedPrivateKey, masterKey);
  const encryptedKeyBuffer = base64ToBuffer(encryptedClientKey);
  const rawKey = await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedKeyBuffer
  );

  return await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};
