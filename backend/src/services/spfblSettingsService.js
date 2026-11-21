const db = require('../config/database');
const { encryptConfigSecret, decryptConfigSecret } = require('./configSecretCrypto');

// Stored credentials are bound to their target inside the authenticated plaintext, so a ciphertext copied to
// another row, host or user never decrypts into a usable secret (same idea as the target check of sti-spfbl-portal).
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

const DEFAULTS = Object.freeze({
  matrix_user: '', encrypted_matrix_password: null, whm_host: '', whm_user: '', encrypted_whm_token: null
});

const sanitizeSettings = (row = DEFAULTS) => ({
  matrix_user: row.matrix_user || '',
  has_matrix_password: Boolean(row.encrypted_matrix_password),
  whm_host: row.whm_host || '',
  whm_user: row.whm_user || '',
  has_whm_token: Boolean(row.encrypted_whm_token),
  updated_at: row.updated_at || null
});

const normalizeSettings = (input, current = DEFAULTS) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SpfblSettingsError('Dados de configuração inválidos.');
  for (const flag of ['remove_matrix_credentials', 'remove_whm_token']) {
    if (input[flag] !== undefined && typeof input[flag] !== 'boolean') throw new SpfblSettingsError('Dados de configuração inválidos.');
  }
  const has = (field) => input[field] !== undefined && input[field] !== null;
  const given = (field) => has(field) && input[field] !== '';

  const matrixUser = has('matrix_user') ? normalizeMatrixUser(input.matrix_user) : current.matrix_user;
  const whmHost = has('whm_host') ? normalizeHost(input.whm_host) : current.whm_host;
  const whmUser = has('whm_user') ? normalizeWhmUser(input.whm_user) : current.whm_user;
  if (Boolean(whmHost) !== Boolean(whmUser)) {
    throw new SpfblSettingsError('Informe o servidor e o usuário WHM juntos, ou deixe os dois vazios.', 'SPFBL_WHM_INCOMPLETE');
  }

  // Anything the caller sends is validated, even when it ends up unused: a bad value is an error, not a no-op.
  const newMatrixSecret = given('matrix_password') ? normalizeSecret(input.matrix_password, 'Senha Matrix') : null;
  if (newMatrixSecret !== null && !matrixUser) throw new SpfblSettingsError('Informe o usuário Matrix junto com a senha.');
  let matrixPassword = current.encrypted_matrix_password || null;
  if (input.remove_matrix_credentials === true || !matrixUser) matrixPassword = null;
  else if (newMatrixSecret !== null) matrixPassword = sealSecret(PURPOSES.matrix, matrixUser, newMatrixSecret);
  else if (matrixPassword && matrixUser !== current.matrix_user) {
    throw new SpfblSettingsError('Informe novamente a senha do Matrix ao alterar o usuário.', 'SPFBL_SECRET_REENTRY_REQUIRED');
  }

  const newWhmSecret = given('whm_token') ? normalizeSecret(input.whm_token, 'Token WHM', WHM_TOKEN_PATTERN) : null;
  if (newWhmSecret !== null && !whmHost) throw new SpfblSettingsError('Informe o servidor e o usuário WHM junto com o token.', 'SPFBL_WHM_INCOMPLETE');
  let whmToken = current.encrypted_whm_token || null;
  if (input.remove_whm_token === true || !whmHost) whmToken = null;
  else if (newWhmSecret !== null) whmToken = sealSecret(PURPOSES.whm, `${whmUser}@${whmHost}`, newWhmSecret);
  else if (whmToken && (whmHost !== current.whm_host || whmUser !== current.whm_user)) {
    throw new SpfblSettingsError('Informe novamente o token WHM ao alterar o servidor ou o usuário.', 'SPFBL_SECRET_REENTRY_REQUIRED');
  }

  return {
    matrix_user: matrixUser,
    encrypted_matrix_password: matrixPassword,
    whm_host: whmHost,
    whm_user: whmUser,
    encrypted_whm_token: whmToken,
    matrix_password_changed: given('matrix_password'),
    whm_token_changed: given('whm_token')
  };
};

const getRawSettings = async (queryable = db, { forUpdate = false } = {}) => {
  const result = await queryable.query(`SELECT * FROM spfbl_settings WHERE id = 1${forUpdate ? ' FOR UPDATE' : ''}`);
  return result.rows[0] || { ...DEFAULTS };
};

const getSettings = async () => sanitizeSettings(await getRawSettings());

const updateSettings = async (input, updatedBy) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const current = await getRawSettings(client, { forUpdate: true });
    const next = normalizeSettings(input, current);
    const result = await client.query(
      `INSERT INTO spfbl_settings
         (id, matrix_user, encrypted_matrix_password, whm_host, whm_user, encrypted_whm_token, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         matrix_user = EXCLUDED.matrix_user,
         encrypted_matrix_password = EXCLUDED.encrypted_matrix_password,
         whm_host = EXCLUDED.whm_host,
         whm_user = EXCLUDED.whm_user,
         encrypted_whm_token = EXCLUDED.encrypted_whm_token,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [next.matrix_user, next.encrypted_matrix_password, next.whm_host, next.whm_user, next.encrypted_whm_token, updatedBy]
    );
    await client.query('COMMIT');
    return {
      settings: sanitizeSettings(result.rows[0]),
      matrix_password_changed: next.matrix_password_changed,
      whm_token_changed: next.whm_token_changed
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// Decrypted credentials exist only inside the caller's request; they are never returned to the browser.
const getMatrixCredentials = async (queryable = db) => {
  const row = await getRawSettings(queryable);
  if (!row.matrix_user || !row.encrypted_matrix_password) {
    throw new SpfblSettingsError('Matrix não configurado. Salve o usuário e a senha antes de testar.', 'MATRIX_NOT_CONFIGURED', 422);
  }
  return { user: row.matrix_user, password: openSecret(row.encrypted_matrix_password, PURPOSES.matrix, row.matrix_user) };
};

const getWhmCredentials = async (queryable = db) => {
  const row = await getRawSettings(queryable);
  if (!row.whm_host || !row.whm_user || !row.encrypted_whm_token) {
    throw new SpfblSettingsError('Salve o servidor, o usuário e o token WHM antes de usar esta ação.', 'WHM_NOT_CONFIGURED', 422);
  }
  return { host: row.whm_host, user: row.whm_user, token: openSecret(row.encrypted_whm_token, PURPOSES.whm, `${row.whm_user}@${row.whm_host}`) };
};

module.exports = {
  SpfblSettingsError,
  sanitizeSettings,
  normalizeSettings,
  getSettings,
  updateSettings,
  getMatrixCredentials,
  getWhmCredentials
};
