const crypto = require('crypto');

const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const CONFIG_KEY_PLACEHOLDERS = new Set([
  'changeme',
  'change_me',
  'change-me',
  'example'
]);

class ConfigEncryptionError extends Error {
  constructor(message, code = 'CONFIG_ENCRYPTION_ERROR') {
    super(message);
    this.name = 'ConfigEncryptionError';
    this.code = code;
    this.statusCode = 503;
  }
}

const decodeCanonicalBase64 = (value, label, code = 'CONFIG_SECRET_INVALID') => {
  const normalized = String(value || '').trim();
  if (
    !normalized
    || normalized.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    throw new ConfigEncryptionError(`${label} inválida.`, code);
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64') !== normalized) {
    decoded.fill(0);
    throw new ConfigEncryptionError(`${label} inválida.`, code);
  }
  return decoded;
};

const validateConfigEncryptionKey = (value = process.env.CONFIG_ENCRYPTION_KEY) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new ConfigEncryptionError(
      'CONFIG_ENCRYPTION_KEY não está configurada.',
      'CONFIG_ENCRYPTION_KEY_MISSING'
    );
  }

  const lowercase = normalized.toLowerCase();
  if (lowercase.startsWith('gere_') || CONFIG_KEY_PLACEHOLDERS.has(lowercase)) {
    throw new ConfigEncryptionError(
      'CONFIG_ENCRYPTION_KEY ainda contém um placeholder.',
      'CONFIG_ENCRYPTION_KEY_PLACEHOLDER'
    );
  }

  const key = decodeCanonicalBase64(
    normalized,
    'CONFIG_ENCRYPTION_KEY',
    'CONFIG_ENCRYPTION_KEY_INVALID'
  );
  if (key.length !== 32) {
    key.fill(0);
    throw new ConfigEncryptionError(
      'CONFIG_ENCRYPTION_KEY deve ser uma chave base64 de 32 bytes.',
      'CONFIG_ENCRYPTION_KEY_INVALID'
    );
  }
  return key;
};

const getConfigEncryptionKey = () => validateConfigEncryptionKey();

const encryptConfigSecret = (plainText) => {
  if (typeof plainText !== 'string' || plainText.length === 0) {
    throw new ConfigEncryptionError(
      'O segredo de configuração precisa ser informado.',
      'CONFIG_SECRET_REQUIRED'
    );
  }

  const key = getConfigEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const plainBuffer = Buffer.from(plainText, 'utf8');

  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      ENVELOPE_VERSION,
      iv.toString('base64'),
      encrypted.toString('base64'),
      authTag.toString('base64')
    ].join(':');
  } finally {
    key.fill(0);
    plainBuffer.fill(0);
  }
};

const decryptConfigSecret = (envelope) => {
  const parts = String(envelope || '').split(':');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new ConfigEncryptionError(
      'Segredo de configuração criptografado inválido.',
      'CONFIG_SECRET_INVALID'
    );
  }

  const key = getConfigEncryptionKey();
  let iv;
  let encrypted;
  let authTag;

  try {
    iv = decodeCanonicalBase64(parts[1], 'IV');
    encrypted = decodeCanonicalBase64(parts[2], 'Ciphertext');
    authTag = decodeCanonicalBase64(parts[3], 'Auth tag');
    if (iv.length !== IV_BYTES || encrypted.length === 0 || authTag.length !== AUTH_TAG_BYTES) {
      throw new ConfigEncryptionError(
        'Segredo de configuração criptografado inválido.',
        'CONFIG_SECRET_INVALID'
      );
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof ConfigEncryptionError) throw error;
    throw new ConfigEncryptionError(
      'Não foi possível descriptografar o segredo de configuração.',
      'CONFIG_SECRET_DECRYPTION_FAILED'
    );
  } finally {
    key.fill(0);
    iv?.fill(0);
    encrypted?.fill(0);
    authTag?.fill(0);
  }
};

module.exports = {
  ConfigEncryptionError,
  validateConfigEncryptionKey,
  encryptConfigSecret,
  decryptConfigSecret
};
