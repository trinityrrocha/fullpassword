const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');

// Static catalogue: a module exists only if it is listed here AND has a system_modules row.
const MODULES = Object.freeze({
  spfbl: Object.freeze({
    key: 'spfbl',
    name: 'SPFBL',
    description: 'Consulta e gestão de bloqueios de e-mail do Matrix SPFBL, com domínios do cPanel/WHM e acesso por usuário.'
  }),
  domain_manager: Object.freeze({
    key: 'domain_manager',
    name: 'Domain Manager',
    description: 'Lista de domínios com vencimento, DNS e certificado SSL, consultados por RDAP, com alertas de vencimento.'
  })
});

class ModuleError extends Error {
  constructor(message, code = 'MODULE_INVALID', statusCode = 400) {
    super(message);
    this.name = 'ModuleError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const assertKnownModule = (key) => {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(MODULES, key)) {
    throw new ModuleError('Módulo desconhecido.', 'MODULE_UNKNOWN', 404);
  }
  return key;
};

const listModules = async (queryable = db) => {
  const rows = (await queryable.query('SELECT module_key, enabled, updated_at FROM system_modules')).rows;
  const byKey = new Map(rows.map((row) => [row.module_key, row]));
  return Object.values(MODULES).map((module) => ({
    key: module.key,
    name: module.name,
    description: module.description,
    enabled: byKey.get(module.key)?.enabled === true,
    updated_at: byKey.get(module.key)?.updated_at || null
  }));
};

const isModuleEnabled = async (key, queryable = db) => {
  assertKnownModule(key);
  const result = await queryable.query('SELECT enabled FROM system_modules WHERE module_key = $1', [key]);
  return result.rows[0]?.enabled === true;
};

const setModuleEnabled = async (key, enabled, updatedBy, queryable = db) => {
  assertKnownModule(key);
  if (typeof enabled !== 'boolean') throw new ModuleError('Informe se o módulo deve ficar ativo ou inativo.', 'MODULE_STATE_INVALID');
  const result = await queryable.query(
    `INSERT INTO system_modules (module_key, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (module_key) DO UPDATE SET
       enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
     RETURNING module_key, enabled, updated_at`,
    [key, enabled, updatedBy]
  );
  const module = MODULES[key];
  return { key, name: module.name, description: module.description, enabled: result.rows[0].enabled, updated_at: result.rows[0].updated_at };
};

// Per-module "may this user open it?" checks. A module with no entry is Super Admin only.
const userAccessChecks = new Map();
const registerUserAccessCheck = (key, check) => { assertKnownModule(key); userAccessChecks.set(key, check); };

const canUserAccessModule = async (key, user, queryable = db) => {
  if (!user?.id) return false;
  if (!(await isModuleEnabled(key, queryable))) return false;
  if (isSuperAdmin(user)) return true;
  const check = userAccessChecks.get(key);
  return check ? (await check(user, queryable)) === true : false;
};

// Booleans only: the menu must not leak configuration or grants.
const getMenuModules = async (user, queryable = db) => {
  const menu = {};
  for (const key of Object.keys(MODULES)) menu[key] = await canUserAccessModule(key, user, queryable);
  return menu;
};

// Server-side enforcement for every route of a module: hiding the icon is not access control.
const requireModuleEnabled = (key) => async (req, res, next) => {
  try {
    if (!(await isModuleEnabled(key))) {
      return res.status(404).json({ error: 'Módulo não está ativo.', code: 'MODULE_DISABLED' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  MODULES,
  ModuleError,
  listModules,
  isModuleEnabled,
  setModuleEnabled,
  registerUserAccessCheck,
  canUserAccessModule,
  getMenuModules,
  requireModuleEnabled
};
