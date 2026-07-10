const db = require('../config/database');

let schemaReady = false;

const normalizeBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';

const normalizePermissionSet = (permissions = {}) => {
  const canEdit = normalizeBoolean(permissions.can_edit ?? permissions.canEdit);
  const canAdd = normalizeBoolean(permissions.can_add ?? permissions.canAdd);
  const canDelete = normalizeBoolean(permissions.can_delete ?? permissions.canDelete);
  const explicitView = permissions.can_view ?? permissions.canView;

  return {
    can_view: normalizeBoolean(explicitView) || canEdit || canAdd || canDelete,
    can_edit: canEdit,
    can_add: canAdd,
    can_delete: canDelete
  };
};

const fullPermissions = (source = 'admin') => ({
  can_view: true,
  can_edit: true,
  can_add: true,
  can_delete: true,
  is_owner: source === 'owner',
  is_admin: source === 'admin',
  source
});

const emptyPermissions = () => ({
  can_view: false,
  can_edit: false,
  can_add: false,
  can_delete: false,
  is_owner: false,
  is_admin: false,
  source: 'none'
});

const ensureSharingSchema = async () => {
  if (schemaReady) return;

  await db.query('BEGIN');
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL');
    await db.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE');
    await db.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE');
    await db.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_add BOOLEAN NOT NULL DEFAULT FALSE');
    await db.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT FALSE');
    await db.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE');
    await db.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT TRUE');
    await db.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_add BOOLEAN NOT NULL DEFAULT TRUE');
    await db.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT FALSE');
    await db.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP');
    await db.query(`UPDATE groups
       SET can_view = TRUE, can_edit = TRUE, can_add = TRUE, can_delete = TRUE
       WHERE name = 'Administradores'`);
    await db.query(`CREATE TABLE IF NOT EXISTS vault_access_audit (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(80) NOT NULL,
      details JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query('COMMIT');
    schemaReady = true;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
};

const getUserGroups = (user = {}) => Array.isArray(user.groups) ? user.groups.filter(Boolean) : [];

const getClientPermissions = async (clientId, user = {}) => {
  await ensureSharingSchema();

  if (!user.id) return emptyPermissions();
  if (user.role === 'admin') return fullPermissions('admin');

  const userGroups = getUserGroups(user);
  const result = await db.query(
    `SELECT
       c.created_by,
       COALESCE(bool_or(g.can_view), false) AS can_view,
       COALESCE(bool_or(g.can_edit), false) AS can_edit,
       COALESCE(bool_or(g.can_add), false) AS can_add,
       COALESCE(bool_or(g.can_delete), false) AS can_delete
     FROM clients c
     LEFT JOIN client_group_access cga
       ON c.id = cga.client_id
      AND cga.group_id = ANY($2::uuid[])
     LEFT JOIN groups g ON g.id = cga.group_id
     WHERE c.id = $1
     GROUP BY c.id, c.created_by`,
    [clientId, userGroups]
  );

  if (result.rows.length === 0) return emptyPermissions();

  const row = result.rows[0];
  if (row.created_by && row.created_by === user.id) return fullPermissions('owner');

  return {
    can_view: !!row.can_view,
    can_edit: !!row.can_edit,
    can_add: !!row.can_add,
    can_delete: !!row.can_delete,
    is_owner: false,
    is_admin: false,
    source: row.can_view ? 'group' : 'none'
  };
};

const hasPermission = (permissions, action) => {
  if (!permissions) return false;
  if (permissions.is_admin || permissions.is_owner) return true;

  if (action === 'view') return !!permissions.can_view;
  if (action === 'edit') return !!permissions.can_edit;
  if (action === 'add') return !!permissions.can_add;
  if (action === 'delete') return !!permissions.can_delete;
  if (action === 'write') return !!(permissions.can_edit || permissions.can_add);
  if (action === 'manage_share') return !!(permissions.is_admin || permissions.is_owner);

  return false;
};

const requireClientPermission = async (clientId, user, action) => {
  const permissions = await getClientPermissions(clientId, user);
  if (!hasPermission(permissions, action)) {
    const error = new Error('Acesso negado');
    error.statusCode = action === 'view' ? 404 : 403;
    error.permissions = permissions;
    throw error;
  }
  return permissions;
};

const canManageClientShares = async (clientId, user) => {
  const permissions = await getClientPermissions(clientId, user);
  return permissions.is_admin || permissions.is_owner;
};

const logVaultAccess = async (clientId, actorUserId, action, details = {}) => {
  await ensureSharingSchema();

  try {
    await db.query(
      'INSERT INTO vault_access_audit (client_id, actor_user_id, action, details) VALUES ($1, $2, $3, $4)',
      [clientId, actorUserId || null, action, details]
    );
  } catch (error) {
    console.error('Erro ao registrar auditoria de acesso ao cofre:', error);
  }
};

module.exports = {
  ensureSharingSchema,
  normalizePermissionSet,
  getClientPermissions,
  hasPermission,
  requireClientPermission,
  canManageClientShares,
  logVaultAccess,
  fullPermissions,
  emptyPermissions
};
