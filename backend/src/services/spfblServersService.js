const db = require('../config/database');
const {
  SpfblSettingsError, PURPOSES, WHM_TOKEN_PATTERN, normalizeHost, normalizeWhmUser, normalizeMatrixUser, normalizeSecret, sealSecret, openSecret
} = require('./spfblSettingsService');

// A WHM server (lists the domains) with ITS Matrix connection (the SPFBL history of those domains). Credentials are sealed with their
// target inside the ciphertext, exactly like before; a ciphertext copied to another server, host or user never opens.
const SERVER_LIMIT = 50;
const KINDS = Object.freeze(['cpanel']); // the select in the UI; more types can be added here and in the CHECK constraint
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (message, code, statusCode = 400) => { throw new SpfblSettingsError(message, code, statusCode); };

const normalizeName = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 80 || /[\u0000-\u001f\u007f<>]/.test(text)) fail('Informe um nome de 1 a 80 caracteres para o servidor.', 'SPFBL_SERVER_NAME_INVALID');
  return text;
};
const normalizeKind = (value) => {
  if (value === undefined || value === null || value === '') return 'cpanel';
  if (!KINDS.includes(value)) fail('Tipo de servidor inválido.', 'SPFBL_SERVER_KIND_INVALID');
  return value;
};
const requireId = (id) => { if (typeof id !== 'string' || !UUID_PATTERN.test(id)) fail('Servidor não encontrado.', 'SPFBL_SERVER_NOT_FOUND', 404); return id; };

const sanitize = (row) => ({
  id: row.id,
  name: row.name,
  kind: row.server_kind || 'cpanel',
  host: row.host,
  whm_user: row.whm_user,
  has_token: Boolean(row.encrypted_token),
  matrix_user: row.matrix_user || '',
  has_matrix_password: Boolean(row.encrypted_matrix_password),
  matrix_configured: Boolean(row.matrix_user && row.encrypted_matrix_password),
  sync_at: row.sync_at || null,
  sync_status: row.sync_status || null,
  history_last_run_at: row.history_last_run_at || null,
  domains_total: Number(row.domains_total || 0),
  domains_active: Number(row.domains_active || 0),
  updated_at: row.updated_at || null
});

const SELECT = `SELECT s.*, (SELECT count(*) FROM spfbl_domains d WHERE d.server_id = s.id) AS domains_total,
  (SELECT count(*) FROM spfbl_domains d WHERE d.server_id = s.id AND d.active) AS domains_active FROM spfbl_whm_servers s`;

const listServers = async (queryable = db) => (await queryable.query(`${SELECT} ORDER BY lower(s.name)`)).rows.map(sanitize);
const getRow = async (id, queryable = db, { forUpdate = false } = {}) => {
  const row = (await queryable.query(`SELECT * FROM spfbl_whm_servers WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [requireId(id)])).rows[0];
  if (!row) fail('Servidor não encontrado.', 'SPFBL_SERVER_NOT_FOUND', 404);
  return row;
};

const mapUnique = (error) => {
  if (error?.code !== '23505') return error;
  if (String(error.constraint).includes('name')) return new SpfblSettingsError('Já existe um servidor com este nome.', 'SPFBL_SERVER_NAME_EXISTS', 409);
  if (String(error.constraint).includes('matrix')) return new SpfblSettingsError('Esta conta Matrix já está vinculada a outro servidor.', 'SPFBL_MATRIX_IN_USE', 409);
  return new SpfblSettingsError('Este servidor WHM (host e usuário) já está cadastrado.', 'SPFBL_SERVER_EXISTS', 409);
};

const given = (input, field) => input[field] !== undefined && input[field] !== null && input[field] !== '';
const checkInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Dados do servidor inválidos.', 'SPFBL_SERVER_INVALID');
  if (input.remove_matrix !== undefined && typeof input.remove_matrix !== 'boolean') fail('Dados do servidor inválidos.', 'SPFBL_SERVER_INVALID');
};

const createServer = async (input, actorId) => {
  checkInput(input);
  const name = normalizeName(input.name);
  const kind = normalizeKind(input.kind);
  const host = normalizeHost(typeof input.host === 'string' ? input.host : '');
  const whmUser = normalizeWhmUser(typeof input.whm_user === 'string' ? input.whm_user : '');
  if (!host || !whmUser) fail('Informe o servidor e o usuário WHM.', 'SPFBL_WHM_INCOMPLETE');
  if (!given(input, 'token')) fail('Informe o token WHM.', 'SPFBL_WHM_TOKEN_INVALID');
  const token = normalizeSecret(input.token, 'Token WHM', WHM_TOKEN_PATTERN);
  const matrixUser = given(input, 'matrix_user') ? normalizeMatrixUser(input.matrix_user) : '';
  const matrixSecret = given(input, 'matrix_password') ? normalizeSecret(input.matrix_password, 'Senha Matrix') : null;
  if (Boolean(matrixUser) !== Boolean(matrixSecret)) fail('Informe o usuário e a senha do Matrix juntos, ou deixe os dois vazios.', 'SPFBL_MATRIX_INCOMPLETE');
  const count = Number((await db.query('SELECT count(*) AS n FROM spfbl_whm_servers')).rows[0].n);
  if (count >= SERVER_LIMIT) fail('O limite de servidores foi atingido.', 'SPFBL_SERVER_LIMIT', 422);
  try {
    const row = (await db.query(
      `INSERT INTO spfbl_whm_servers (name, server_kind, host, whm_user, encrypted_token, matrix_user, encrypted_matrix_password, created_by)
       VALUES ($1, $8, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, host, whmUser, sealSecret(PURPOSES.whm, `${whmUser}@${host}`, token), matrixUser, matrixSecret ? sealSecret(PURPOSES.matrix, matrixUser, matrixSecret) : null, actorId, kind])).rows[0];
    return { server: sanitize(row), whm_token_changed: true, matrix_password_changed: Boolean(matrixSecret) };
  } catch (error) { throw mapUnique(error); }
};

const updateServer = async (id, input, actorId) => {
  checkInput(input);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const current = await getRow(id, client, { forUpdate: true });
    const name = input.name !== undefined ? normalizeName(input.name) : current.name;
    const kind = input.kind !== undefined ? normalizeKind(input.kind) : current.server_kind;
    const host = input.host !== undefined ? normalizeHost(input.host) : current.host;
    const whmUser = input.whm_user !== undefined ? normalizeWhmUser(input.whm_user) : current.whm_user;
    if (!host || !whmUser) fail('Informe o servidor e o usuário WHM.', 'SPFBL_WHM_INCOMPLETE');
    const newToken = given(input, 'token') ? normalizeSecret(input.token, 'Token WHM', WHM_TOKEN_PATTERN) : null;
    let encryptedToken = current.encrypted_token;
    if (newToken !== null) encryptedToken = sealSecret(PURPOSES.whm, `${whmUser}@${host}`, newToken);
    else if (host !== current.host || whmUser !== current.whm_user) fail('Informe novamente o token WHM ao alterar o servidor ou o usuário.', 'SPFBL_SECRET_REENTRY_REQUIRED');

    let matrixUser = current.matrix_user;
    let encryptedMatrix = current.encrypted_matrix_password;
    const newMatrixSecret = given(input, 'matrix_password') ? normalizeSecret(input.matrix_password, 'Senha Matrix') : null;
    if (input.remove_matrix === true) { matrixUser = ''; encryptedMatrix = null; }
    else {
      if (input.matrix_user !== undefined) matrixUser = normalizeMatrixUser(input.matrix_user);
      if (newMatrixSecret !== null && !matrixUser) fail('Informe o usuário Matrix junto com a senha.', 'SPFBL_MATRIX_INCOMPLETE');
      if (newMatrixSecret !== null) encryptedMatrix = sealSecret(PURPOSES.matrix, matrixUser, newMatrixSecret);
      else if (!matrixUser) encryptedMatrix = null;
      else if (matrixUser !== current.matrix_user && current.encrypted_matrix_password) fail('Informe novamente a senha do Matrix ao alterar o usuário.', 'SPFBL_SECRET_REENTRY_REQUIRED');
      else if (matrixUser && !encryptedMatrix) fail('Informe a senha do Matrix.', 'SPFBL_MATRIX_INCOMPLETE');
    }
    const row = (await client.query(
      `UPDATE spfbl_whm_servers SET name = $2, host = $3, whm_user = $4, encrypted_token = $5, matrix_user = $6, encrypted_matrix_password = $7,
              server_kind = $8, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [current.id, name, host, whmUser, encryptedToken, matrixUser, encryptedMatrix, kind])).rows[0];
    await client.query('COMMIT');
    return { server: sanitize(row), previous_matrix_user: current.matrix_user, whm_token_changed: newToken !== null, matrix_password_changed: newMatrixSecret !== null,
      matrix_user_changed: matrixUser !== current.matrix_user };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapUnique(error);
  } finally { client.release(); }
};

// Removing a server asks what to do with its domains: remove them too, or keep them WITHOUT a query server (history only).
const removeServer = async (id, removeDomains) => {
  if (typeof removeDomains !== 'boolean') fail('Informe se os domínios vinculados também devem ser removidos.', 'SPFBL_REMOVE_CHOICE_REQUIRED', 422);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const row = await getRow(id, client, { forUpdate: true });
    const total = Number((await client.query('SELECT count(*) AS n FROM spfbl_domains WHERE server_id = $1', [row.id])).rows[0].n);
    // Imported domains go with the server when asked; a hand-typed domain is never deleted by this: it just loses its server.
    const removed = removeDomains ? (await client.query("DELETE FROM spfbl_domains WHERE server_id = $1 AND source = 'whm'", [row.id])).rowCount : 0; // the access links cascade
    await client.query('DELETE FROM spfbl_whm_servers WHERE id = $1', [row.id]); // kept domains: server_id becomes NULL
    await client.query('COMMIT');
    return { name: row.name, matrix_user: row.matrix_user, domains_removed: removed, domains_kept: total - removed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
};

// Decrypted credentials exist only inside the caller's request; they are never returned to the browser.
const getWhmCredentials = async (id, queryable = db) => {
  const row = await getRow(id, queryable);
  return { host: row.host, user: row.whm_user, token: openSecret(row.encrypted_token, PURPOSES.whm, `${row.whm_user}@${row.host}`) };
};
const getMatrixCredentials = async (id, queryable = db) => {
  const row = await getRow(id, queryable);
  if (!row.matrix_user || !row.encrypted_matrix_password) {
    throw new SpfblSettingsError('Este servidor não tem conexão Matrix. Salve o usuário e a senha do Matrix no servidor.', 'MATRIX_NOT_CONFIGURED', 422);
  }
  return { user: row.matrix_user, password: openSecret(row.encrypted_matrix_password, PURPOSES.matrix, row.matrix_user), serverId: row.id };
};

// The Matrix connection that serves a domain: its server's. A domain without server has none (history only).
const serverIdOfDomain = async (domain, queryable = db) => (await queryable.query('SELECT server_id FROM spfbl_domains WHERE name = $1', [domain])).rows[0]?.server_id || null;
const credentialsForDomain = async (domain, queryable = db) => {
  const serverId = await serverIdOfDomain(domain, queryable);
  if (!serverId) throw new SpfblSettingsError('Este domínio está sem servidor de consulta: só o histórico fica disponível.', 'SPFBL_DOMAIN_NO_SERVER', 409);
  return getMatrixCredentials(serverId, queryable);
};
const matrixServers = async (queryable = db) => (await queryable.query(
  "SELECT id, name, matrix_user FROM spfbl_whm_servers WHERE matrix_user <> '' AND encrypted_matrix_password IS NOT NULL ORDER BY lower(name)")).rows;

// Credentials typed in the form, checked WITHOUT storing anything. A blank secret means "the saved one" and is only honoured for the
// same target (host+user / Matrix user) of an existing server: otherwise the person must type it again.
const credentialsToValidate = async (input, queryable = db) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Dados inválidos.', 'SPFBL_SERVER_INVALID');
  const host = normalizeHost(typeof input.host === 'string' ? input.host : '');
  const user = normalizeWhmUser(typeof input.whm_user === 'string' ? input.whm_user : '');
  if (!host || !user) fail('Informe o servidor e o usuário WHM.', 'SPFBL_WHM_INCOMPLETE');
  if (given(input, 'token')) return { host, user, token: normalizeSecret(input.token, 'Token WHM', WHM_TOKEN_PATTERN) };
  if (input.id) {
    const row = await getRow(input.id, queryable);
    if (row.host === host && row.whm_user === user) return { host, user, token: openSecret(row.encrypted_token, PURPOSES.whm, `${user}@${host}`) };
    fail('Informe novamente o token WHM ao alterar o servidor ou o usuário.', 'SPFBL_SECRET_REENTRY_REQUIRED');
  }
  fail('Informe o token WHM.', 'SPFBL_WHM_TOKEN_INVALID');
  return null;
};
const matrixCredentialsToValidate = async (input, queryable = db) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Dados inválidos.', 'SPFBL_SERVER_INVALID');
  const user = given(input, 'matrix_user') ? normalizeMatrixUser(input.matrix_user) : '';
  if (!user) fail('Informe o usuário do Matrix.', 'SPFBL_MATRIX_INCOMPLETE');
  if (given(input, 'matrix_password')) return { user, password: normalizeSecret(input.matrix_password, 'Senha Matrix') };
  if (input.id) {
    const row = await getRow(input.id, queryable);
    if (row.matrix_user === user && row.encrypted_matrix_password) return { user, password: openSecret(row.encrypted_matrix_password, PURPOSES.matrix, user) };
    fail('Informe novamente a senha do Matrix ao alterar o usuário.', 'SPFBL_SECRET_REENTRY_REQUIRED');
  }
  fail('Informe a senha do Matrix.', 'SPFBL_MATRIX_INCOMPLETE');
  return null;
};

module.exports = { KINDS, credentialsToValidate, matrixCredentialsToValidate, SERVER_LIMIT, listServers, createServer, updateServer, removeServer, getWhmCredentials, getMatrixCredentials, credentialsForDomain, serverIdOfDomain, matrixServers };
