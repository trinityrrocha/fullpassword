const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { safeLogError } = require('../utils/safeLogger');

const normalizeBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';

const normalizePermissionSet = (permissions = {}) => {
  const canEdit = normalizeBoolean(permissions.can_edit ?? permissions.canEdit);
  const canAdd = normalizeBoolean(permissions.can_add ?? permissions.canAdd);
  const canDelete = normalizeBoolean(permissions.can_delete ?? permissions.canDelete);
  const explicitView = permissions.can_view ?? permissions.canView;

  return {
    can_view: explicitView === undefined ? canEdit || canAdd || canDelete : normalizeBoolean(explicitView),
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

// Startup only: DDL belongs to the caller's reserved migration transaction.
const ensureSharingSchema = async (client) => {
    if (!client) throw new Error('SHARING_SCHEMA_REQUIRES_MIGRATION_CLIENT');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL');
    await client.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS enabled_modules TEXT[]');
    await client.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_add BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_add BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP');
    await client.query(`CREATE TABLE IF NOT EXISTS client_key_shares (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      encrypted_client_key TEXT NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(client_id, user_id)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS vault_access_audit (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(80) NOT NULL,
      details JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`);
};

const getClientPermissions = async (clientId, user = {}, queryable = db) => {

  if (!user.id) return emptyPermissions();

  // Ownership is evaluated before administrative access.
  if (isSuperAdmin(user)) {
    const ownerResult = await queryable.query('SELECT created_by FROM clients WHERE id = $1 LIMIT 1', [clientId]);
    if (ownerResult.rows.length === 0) return emptyPermissions();
    if (ownerResult.rows[0].created_by === user.id) return fullPermissions('owner');
    return fullPermissions('admin');
  }

  const result = await queryable.query(
    `SELECT
       c.created_by,
       COALESCE(bool_or(g.can_view AND cga.can_view), false) AS can_view,
       COALESCE(bool_or(g.can_view AND cga.can_view AND g.can_edit AND cga.can_edit), false) AS can_edit,
       COALESCE(bool_or(g.can_view AND cga.can_view AND g.can_add AND cga.can_add), false) AS can_add,
       COALESCE(bool_or(g.can_view AND cga.can_view AND g.can_delete AND cga.can_delete), false) AS can_delete
     FROM clients c
     LEFT JOIN client_group_access cga
       ON c.id = cga.client_id
      AND cga.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
     LEFT JOIN groups g ON g.id = cga.group_id
     WHERE c.id = $1
     GROUP BY c.id, c.created_by`,
    [clientId, user.id]
  );

  if (result.rows.length === 0) return emptyPermissions();

  const row = result.rows[0];
  if (row.created_by && row.created_by === user.id) return fullPermissions('owner');

  // A direct share to this user (set by the owner's key rotation) adds to what the groups give: the effective right is the OR of both paths.
  const direct = (await queryable.query(
    'SELECT can_edit, can_add, can_delete FROM client_user_access WHERE client_id = $1 AND user_id = $2 AND can_view = TRUE',
    [clientId, user.id]
  )).rows[0];
  const fromGroup = !!row.can_view;
  const merged = {
    can_view: fromGroup || !!direct,
    can_edit: !!row.can_edit || !!direct?.can_edit,
    can_add: !!row.can_add || !!direct?.can_add,
    can_delete: !!row.can_delete || !!direct?.can_delete
  };

  return {
    ...merged,
    is_owner: false,
    is_admin: false,
    source: fromGroup && direct ? 'group+user' : direct ? 'user' : fromGroup ? 'group' : 'none'
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

const requireClientPermission = async (clientId, user, action, queryable = db) => {
  const permissions = await getClientPermissions(clientId, user, queryable);
  if (!hasPermission(permissions, action)) {
    const error = new Error('Acesso negado');
    error.statusCode = action === 'view' ? 404 : 403;
    error.permissions = permissions;
    throw error;
  }
  return permissions;
};

const canManageClientShares = async (clientId, user, queryable = db) => {
  const permissions = await getClientPermissions(clientId, user, queryable);
  return permissions.is_admin || permissions.is_owner;
};

const logVaultAccess = async (clientId, actorUserId, action, details = {}, queryable = db) => {
  try {
    await queryable.query(
      'INSERT INTO vault_access_audit (client_id, actor_user_id, action, details) VALUES ($1, $2, $3, $4)',
      [clientId, actorUserId || null, action, details]
    );
  } catch (error) {
    safeLogError('Erro ao registrar auditoria de acesso ao cofre.', error);
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
