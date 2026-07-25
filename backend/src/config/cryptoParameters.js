const crypto = require('crypto');
const { promisify } = require('util');

const pbkdf2Async = promisify(crypto.pbkdf2);

const LEGACY_KDF_PARAMS = Object.freeze({
  version: 1,
  name: 'PBKDF2',
  hash: 'SHA-256',
  nodeHash: 'sha256',
  iterations: 100000,
  keyLength: 32
});

const CURRENT_KDF_PARAMS = Object.freeze({
  version: 2,
  name: 'PBKDF2',
  hash: 'SHA-256',
  nodeHash: 'sha256',
  iterations: 310000,
  keyLength: 32
});

const LEGACY_RSA_PARAMS = Object.freeze({
  version: 1,
  modulusLength: 2048
});

const CURRENT_RSA_PARAMS = Object.freeze({
  version: 2,
  modulusLength: 3072
});

const deriveKek = async (password, salt, params = CURRENT_KDF_PARAMS) => {
  if (typeof salt !== 'string' || salt.trim().length < 16) {
    const error = new Error('Salt criptográfico único por usuário é obrigatório');
    error.code = 'CRYPTO_SALT_REQUIRED';
    throw error;
  }

  if (
    params?.name !== 'PBKDF2'
    || params?.hash !== 'SHA-256'
    || !Number.isInteger(params?.iterations)
    || params.iterations < LEGACY_KDF_PARAMS.iterations
    || params.iterations > 2000000
  ) {
    const error = new Error('Parâmetros KDF inválidos');
    error.code = 'CRYPTO_KDF_PARAMS_INVALID';
    throw error;
  }

  return pbkdf2Async(password, salt, params.iterations, params.keyLength, params.nodeHash);
};

const matchesCurrentKdfMetadata = (value = {}) => (
  Number(value.kdf_version) === CURRENT_KDF_PARAMS.version
  && value.kdf_name === CURRENT_KDF_PARAMS.name
  && value.kdf_hash === CURRENT_KDF_PARAMS.hash
  && Number(value.kdf_iterations) === CURRENT_KDF_PARAMS.iterations
);

const getRsaPublicKeySize = (publicKeyBase64) => {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki'
    });
    const modulusLength = Number(publicKey.asymmetricKeyDetails?.modulusLength);
    if (publicKey.asymmetricKeyType !== 'rsa' || !Number.isInteger(modulusLength)) {
      throw new Error('Tipo de chave pública incompatível');
    }
    return modulusLength;
  } catch (cause) {
    const error = new Error('Chave pública RSA inválida', { cause });
    error.code = 'RSA_PUBLIC_KEY_INVALID';
    throw error;
  }
};

module.exports = {
  LEGACY_KDF_PARAMS,
  CURRENT_KDF_PARAMS,
  LEGACY_RSA_PARAMS,
  CURRENT_RSA_PARAMS,
  deriveKek,
  matchesCurrentKdfMetadata,
  getRsaPublicKeySize
};
