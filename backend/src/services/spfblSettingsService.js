const { encryptConfigSecret, decryptConfigSecret } = require('./configSecretCrypto');

// Validation and sealing helpers for the WHM servers and their Matrix connections (see spfblServersService).
// Stored credentials are bound to their target inside the authenticated plaintext, so a ciphertext copied to
// another row, host or user never decrypts into a usable secret (same idea as the target check of the original PHP SPFBL portal).
const SECRET_VERSION = 1;
const PURPOSES = Object.freeze({ matrix: 'spfbl.matrix.password', whm: 'spfbl.whm.token' });

class SpfblSettingsError extends Error {
  constructor(message, code = 'SPFBL_SETTINGS_INVALID', statusCode = 400) {
    super(message);
    this.name = 'SpfblSettingsError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const WHM_USER_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const WHM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

const requireString = (value, label) => {
  if (typeof value !== 'string') throw new SpfblSettingsError(`${label} inválido.`);
  return value;
};

const normalizeMatrixUser = (value) => {
  const text = requireString(value, 'Usuário Matrix').trim();
  if (text.length > 254 || /[\s\0]/.test(text)) throw new SpfblSettingsError('Usuário Matrix inválido.');
  return text;
};

const normalizeHost = (value) => {
  const text = requireString(value, 'Servidor WHM').trim().toLowerCase();
  if (text && !HOST_PATTERN.test(text)) {
    throw new SpfblSettingsError('Informe somente o hostname do servidor WHM, sem https://, porta, caminho ou endereço IP.', 'SPFBL_WHM_HOST_INVALID');
  }
  return text;
};

const normalizeWhmUser = (value) => {
  const text = requireString(value, 'Usuário WHM').trim();
  if (text && !WHM_USER_PATTERN.test(text)) {
    throw new SpfblSettingsError('Informe o usuário WHM (root ou revendedor) que criou o token, não um e-mail.', 'SPFBL_WHM_USER_INVALID');
  }
  return text;
};

// Tokens are trimmed (copy/paste artefacts); a password is kept exactly as typed.
const normalizeSecret = (value, label, pattern) => {
  const raw = requireString(value, label);
  const text = pattern ? raw.trim() : raw;
  const valid = text.length > 0 && (pattern ? pattern.test(text) : (text.length <= 1024 && !/[\r\n\0]/.test(text)));
  if (!valid) throw new SpfblSettingsError(`${label} inválido.`, label.includes('WHM') ? 'SPFBL_WHM_TOKEN_INVALID' : 'SPFBL_SETTINGS_INVALID');
  return text;
};

const sealSecret = (purpose, target, secret) => encryptConfigSecret(JSON.stringify({ v: SECRET_VERSION, purpose, target, secret }));

const openSecret = (envelope, purpose, target) => {
  let payload;
  try { payload = JSON.parse(decryptConfigSecret(envelope)); } catch (error) {
    if (error?.name === 'ConfigEncryptionError') throw error;
    throw new SpfblSettingsError('Credencial salva inválida. Salve-a novamente.', 'SPFBL_CREDENTIAL_INVALID', 409);
  }
  if (payload?.v !== SECRET_VERSION || payload.purpose !== purpose || payload.target !== target || typeof payload.secret !== 'string' || !payload.secret) {
    throw new SpfblSettingsError('A credencial salva não corresponde ao destino atual. Salve-a novamente.', 'SPFBL_CREDENTIAL_TARGET_MISMATCH', 409);
  }
  return payload.secret;
};

module.exports = {
  PURPOSES, WHM_TOKEN_PATTERN, normalizeHost, normalizeWhmUser, normalizeMatrixUser, normalizeSecret, sealSecret, openSecret,
  SpfblSettingsError
};
