const db = require('../config/database');
const { registerUserAccessCheck } = require('./modulesService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNLOCK_MODES = new Set(['review', 'direct']);
const MAX_DOMAINS_PER_USER = 100;

class AccessError extends Error {
  constructor(message, code = 'SPFBL_ACCESS_INVALID', statusCode = 400) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

const validateInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccessError('Dados de acesso inválidos.');
  if (!UNLOCK_MODES.has(input.unlock_mode)) throw new AccessError('Selecione o modo de tratamento dos bloqueios: revisão ou desbloqueio direto.', 'SPFBL_ACCESS_MODE_INVALID');
  const ids = input.domain_ids;
  if (!Array.isArray(ids) || !ids.every(isUuid)) throw new AccessError('Selecione os domínios do acesso.', 'SPFBL_ACCESS_DOMAINS_INVALID');
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (unique.length < 1 || unique.length > MAX_DOMAINS_PER_USER) {
    throw new AccessError(`Selecione de 1 a ${MAX_DOMAINS_PER_USER} domínios.`, 'SPFBL_ACCESS_DOMAINS_INVALID');
  }
  return { unlockMode: input.unlock_mode, domainIds: unique };
};

const accessRows = async (queryable, where = '', params = []) => (await queryable.query(
  `SELECT a.user_id, u.name, u.email, u.role, (u.is_active IS TRUE) AS user_active, a.unlock_mode, a.created_at, a.updated_at,
          COALESCE(json_agg(json_build_object('id', d.id, 'name', d.name, 'active', d.active) ORDER BY d.name)
                   FILTER (WHERE d.id IS NOT NULL), '[]'::json) AS domains
     FROM spfbl_user_access a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN spfbl_user_domains ud ON ud.user_id = a.user_id
     LEFT JOIN spfbl_domains d ON d.id = ud.domain_id
     ${where}
    GROUP BY a.user_id, u.name, u.email, u.role, u.is_active, a.unlock_mode, a.created_at, a.updated_at
    ORDER BY lower(u.name), u.email`,
  params
)).rows;

const listAccess = async (queryable = db) => accessRows(queryable);

// Super Admin accounts always have access and need no grant; inactive accounts cannot receive one.
const saveAccess = async (targetUserId, input, grantedBy) => {
  if (!isUuid(targetUserId)) throw new AccessError('Usuário não encontrado.', 'SPFBL_ACCESS_USER_NOT_FOUND', 404);
  const { unlockMode, domainIds } = validateInput(input);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const user = (await client.query('SELECT id, is_active, is_super_admin FROM users WHERE id = $1 FOR UPDATE', [targetUserId])).rows[0];
    if (!user) throw new AccessError('Usuário não encontrado.', 'SPFBL_ACCESS_USER_NOT_FOUND', 404);
    if (user.is_super_admin === true) throw new AccessError('O Super Admin já tem acesso ao módulo.', 'SPFBL_ACCESS_SUPER_ADMIN', 409);
    if (user.is_active !== true) throw new AccessError('Não é possível dar acesso a um usuário inativo.', 'SPFBL_ACCESS_USER_INACTIVE', 409);
    const found = (await client.query('SELECT count(*)::int AS n FROM spfbl_domains WHERE id = ANY($1::uuid[])', [domainIds])).rows[0].n;
    if (found !== domainIds.length) throw new AccessError('Um ou mais domínios selecionados não existem mais. Atualize a lista.', 'SPFBL_ACCESS_DOMAINS_INVALID', 422);
    await client.query(
      `INSERT INTO spfbl_user_access (user_id, unlock_mode, granted_by) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET unlock_mode = EXCLUDED.unlock_mode, granted_by = EXCLUDED.granted_by, updated_at = CURRENT_TIMESTAMP`,
      [targetUserId, unlockMode, grantedBy]
    );
    await client.query('DELETE FROM spfbl_user_domains WHERE user_id = $1 AND NOT (domain_id = ANY($2::uuid[]))', [targetUserId, domainIds]);
    await client.query(
      'INSERT INTO spfbl_user_domains (user_id, domain_id) SELECT $1, d FROM unnest($2::uuid[]) AS d ON CONFLICT DO NOTHING',
      [targetUserId, domainIds]
    );
    const saved = (await accessRows(client, 'WHERE a.user_id = $1', [targetUserId]))[0];
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const revokeAccess = async (targetUserId) => {
  if (!isUuid(targetUserId)) throw new AccessError('Acesso não encontrado.', 'SPFBL_ACCESS_NOT_FOUND', 404);
  const result = await db.query('DELETE FROM spfbl_user_access WHERE user_id = $1 RETURNING user_id', [targetUserId]);
  if (!result.rows[0]) throw new AccessError('Acesso não encontrado.', 'SPFBL_ACCESS_NOT_FOUND', 404);
  return { user_id: result.rows[0].user_id };
};

// The module menu / routes ask this on every request: a grant exists and the account is still active.
const hasAccess = async (user, queryable = db) => {
  if (!isUuid(user?.id)) return false;
  const result = await queryable.query(
    'SELECT 1 FROM spfbl_user_access a JOIN users u ON u.id = a.user_id WHERE a.user_id = $1 AND u.is_active = TRUE',
    [user.id]
  );
  return result.rows.length > 0;
};

registerUserAccessCheck('spfbl', hasAccess);

// What the module page shows: the Super Admin gets the configuration summary, everyone else only their own scope.
const getOwnAccess = async (user, queryable = db) => {
  if (!isUuid(user?.id)) return null;
  return (await accessRows(queryable, 'WHERE a.user_id = $1 AND u.is_active = TRUE', [user.id]))[0] || null;
};

module.exports = { AccessError, MAX_DOMAINS_PER_USER, UNLOCK_MODES, listAccess, saveAccess, revokeAccess, hasAccess, getOwnAccess };
