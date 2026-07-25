const {
  LEGACY_RSA_PARAMS,
  CURRENT_RSA_PARAMS,
  getRsaPublicKeySize
} = require('../config/cryptoParameters');

const MAX_PUBLIC_KEY_LENGTH = 8192;
const MAX_ENCRYPTED_PRIVATE_KEY_LENGTH = 32768;

const isCanonicalBase64 = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
};

const invalidPayload = (message) => {
  const error = new Error(message);
  error.code = 'CRYPTO_IDENTITY_INVALID';
  error.statusCode = 400;
  return error;
};

const validateUserCryptoIdentityPayload = (payload = {}) => {
  const publicKey = payload.public_key;
  const encryptedPrivateKey = payload.encrypted_private_key;

  if (
    typeof publicKey !== 'string'
    || typeof encryptedPrivateKey !== 'string'
    || !publicKey
    || !encryptedPrivateKey
  ) {
    throw invalidPayload('Chaves pública e privada criptografada são obrigatórias');
  }
  if (
    publicKey.length > MAX_PUBLIC_KEY_LENGTH
    || encryptedPrivateKey.length > MAX_ENCRYPTED_PRIVATE_KEY_LENGTH
  ) {
    throw invalidPayload('Payload de identidade criptográfica excede o tamanho permitido');
  }
  if (!isCanonicalBase64(publicKey)) {
    throw invalidPayload('Chave pública RSA inválida');
  }

  const encryptedParts = encryptedPrivateKey.split(':');
  if (
    encryptedParts.length !== 2
    || !isCanonicalBase64(encryptedParts[0])
    || !isCanonicalBase64(encryptedParts[1])
    || Buffer.from(encryptedParts[0], 'base64').length !== 12
    || Buffer.from(encryptedParts[1], 'base64').length < 17
  ) {
    throw invalidPayload('Chave privada criptografada inválida');
  }

  let modulusLength;
  try {
    modulusLength = getRsaPublicKeySize(publicKey);
  } catch {
    throw invalidPayload('Chave pública RSA inválida');
  }
  if (![LEGACY_RSA_PARAMS.modulusLength, CURRENT_RSA_PARAMS.modulusLength].includes(modulusLength)) {
    throw invalidPayload('Tamanho da chave pública RSA incompatível');
  }

  return {
    publicKey,
    encryptedPrivateKey,
    rsaKeySize: modulusLength,
    rsaKeyVersion: modulusLength === CURRENT_RSA_PARAMS.modulusLength
      ? CURRENT_RSA_PARAMS.version
      : LEGACY_RSA_PARAMS.version
  };
};

const cryptoIdentityMatches = (user, identity) => (
  user?.public_key === identity.publicKey
  && user?.encrypted_private_key === identity.encryptedPrivateKey
);

module.exports = {
  MAX_PUBLIC_KEY_LENGTH,
  MAX_ENCRYPTED_PRIVATE_KEY_LENGTH,
  validateUserCryptoIdentityPayload,
  cryptoIdentityMatches
};
