const db = require('../config/database');
const { getClientPermissions, requireClientPermission, logVaultAccess } = require('../services/accessControlService');
const { isSuperAdmin } = require('../config/security');
const { safeLogError } = require('../utils/safeLogger');
const { syncDomainExpirationNotifications } = require('../services/domainExpirationService');

// GET /api/clients - Lista apenas cofres próprios ou compartilhados com grupos que podem visualizar
const getClients = async (req, res) => {
  try {

    const result = await db.query(`
      SELECT c.*, creator.name AS created_by_name FROM clients c
      LEFT JOIN users creator ON creator.id = c.created_by
      WHERE c.created_by = $1 OR $2::boolean OR EXISTS (
        SELECT 1 FROM client_group_access cga
        JOIN user_groups ug ON ug.group_id = cga.group_id
        WHERE cga.client_id = c.id AND ug.user_id = $1
      ) ORDER BY c.name ASC`, [req.user.id, isSuperAdmin(req.user)]);
    const visible = [];
    for (const row of result.rows) {
      const permissions = await getClientPermissions(row.id, req.user);
      if (permissions.can_view) visible.push({ ...row, ...permissions });
    }
    res.status(200).json(visible);
  } catch (error) {
    safeLogError('Erro ao buscar clientes.', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
};

// POST /api/clients - Cadastra um novo cofre/cliente
const createClient = async (req, res) => {
  let transaction;
  try {
    transaction = await db.pool.connect();

    const { name, address, phone, email, group_ids } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    }

    await transaction.query('BEGIN');

    const clientResult = await transaction.query(
      'INSERT INTO clients (name, address, phone, email, created_by, enabled_modules) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, address || null, phone || null, email || null, req.user.id, []]
    );
    
    const newClient = clientResult.rows[0];

    const groupsToLink = Array.isArray(group_ids) ? group_ids.filter(Boolean) : [];

    for (const groupId of groupsToLink) {
      const groupCheck = await transaction.query('SELECT id FROM groups WHERE id = $1', [groupId]);
      if (groupCheck.rows.length > 0) {
        await transaction.query(
          `INSERT INTO client_group_access (client_id, group_id)
           VALUES ($1, $2)
           ON CONFLICT (client_id, group_id) DO NOTHING`,
          [newClient.id, groupId]
        );
      }
    }

    await transaction.query('COMMIT');
    res.status(201).json(newClient);
  } catch (error) {
    if (transaction) await transaction.query('ROLLBACK').catch(() => {});
    safeLogError('Erro ao criar cliente.', error);
    res.status(500).json({ error: 'Erro interno ao criar cliente' });
  } finally {
    transaction?.release();
  }
};

const allowedModules = ['cpanelWeb', 'vpn', 'windowsServer', 'linuxServer', 'devices'];
const legacyDefaultModules = allowedModules.filter((moduleId) => moduleId !== 'devices');
const moduleVaultCategories = Object.freeze({
  cpanelWeb: ['cPanel'],
  vpn: ['VPN'],
  windowsServer: ['Servidor TS'],
  linuxServer: ['Servidor Linux', 'Servidores Diversos'],
  devices: ['Dispositivos']
});

const getClientModules = async (req, res) => {
  try {
    await requireClientPermission(req.params.clientId, req.user, 'view');
    const result = await db.query('SELECT enabled_modules FROM clients WHERE id = $1', [req.params.clientId]);
    res.status(200).json({ enabledModules: result.rows[0]?.enabled_modules ?? null });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Acesso negado' });
    safeLogError('Erro ao buscar módulos da empresa.', error);
    res.status(500).json({ error: 'Erro ao buscar módulos da empresa' });
  }
};

const updateClientModules = async (req, res) => {
  try {
    await requireClientPermission(req.params.clientId, req.user, 'edit');
    const requestedModules = req.body?.enabledModules;
    if (!Array.isArray(requestedModules)) return res.status(400).json({ error: 'Lista de módulos inválida' });
    const enabledModules = allowedModules.filter((moduleId) => requestedModules.includes(moduleId));
    await db.query('UPDATE clients SET enabled_modules = $1 WHERE id = $2', [enabledModules, req.params.clientId]);
    res.status(200).json({ enabledModules });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Acesso negado' });
    safeLogError('Erro ao atualizar módulos da empresa.', error);
    res.status(500).json({ error: 'Erro ao atualizar módulos da empresa' });
  }
};

const updateDomainExpirationNotifications = async (req, res) => {
  try {
    await requireClientPermission(req.params.clientId, req.user, 'edit');
    const synchronized = await syncDomainExpirationNotifications(
      req.params.clientId,
      req.body?.notifications,
      req.user.id
    );
    return res.status(200).json({ synchronized });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.statusCode === 404 ? 'Cofre não encontrado' : error.message || 'Acesso negado'
      });
    }
    safeLogError('Erro ao sincronizar alertas de vencimento de domínio.', error);
    return res.status(500).json({ error: 'Não foi possível sincronizar os alertas de vencimento de domínio' });
  }
};

const deleteClientModule = async (req, res) => {
  let transaction;
  let committed = false;

  try {

    const { clientId, moduleId } = req.params;
    const categories = moduleVaultCategories[moduleId];

    if (!categories) {
      return res.status(400).json({ error: 'Módulo inválido' });
    }

    if (req.body?.confirmation !== 'EXCLUIR') {
      return res.status(400).json({ error: 'Confirmação de exclusão inválida' });
    }

    transaction = await db.pool.connect();
    await transaction.query('BEGIN');
    await transaction.query('SELECT pg_advisory_xact_lock($1)',[8142027]);

    const clientResult = await transaction.query(
      'SELECT enabled_modules,crypto_epoch,crypto_revision,rotation_required FROM clients WHERE id = $1 FOR UPDATE',
      [clientId]
    );

    if (clientResult.rows.length === 0) {
      await transaction.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    await requireClientPermission(clientId, req.user, 'delete', transaction);
    const vault=clientResult.rows[0];
    if (!vault.crypto_epoch || vault.rotation_required || String(req.body.revision)!==String(vault.crypto_revision)) {
      throw Object.assign(new Error('VAULT_VERSION_CONFLICT'),{statusCode:409});
    }

    const currentModules = Array.isArray(clientResult.rows[0].enabled_modules)
      ? allowedModules.filter((allowedModule) => clientResult.rows[0].enabled_modules.includes(allowedModule))
      : legacyDefaultModules;
    const enabledModules = currentModules.filter((enabledModule) => enabledModule !== moduleId);

    const deletedItems = await transaction.query(
      'UPDATE vault_records SET deleted=TRUE WHERE client_id = $1 AND category = ANY($2::text[]) AND deleted=FALSE RETURNING id',
      [clientId, categories]
    );

    if (moduleId === 'cpanelWeb') {
      await transaction.query('DELETE FROM domain_expiration_notifications WHERE client_id = $1', [clientId]);
    }

    await transaction.query(
      'UPDATE clients SET enabled_modules = $1, crypto_revision=crypto_revision+1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [enabledModules, clientId]
    );

    await transaction.query('COMMIT');
    committed = true;

    try {
      await logVaultAccess(clientId, req.user.id, 'vault_module_delete', {
        module_id: moduleId,
        deleted_items: deletedItems.rowCount
      });
    } catch (auditError) {
      safeLogError('Módulo excluído, mas não foi possível registrar a auditoria.', auditError);
    }

    return res.status(200).json({
      deleted: true,
      moduleId,
      enabledModules,
      deletedItems: deletedItems.rowCount
    });
  } catch (error) {
    if (transaction && !committed) {
      try {
        await transaction.query('ROLLBACK');
      } catch (rollbackError) {
        safeLogError('Erro ao reverter exclusão de módulo.', rollbackError);
      }
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Você não tem permissão para excluir este módulo'
      });
    }

    safeLogError('Erro ao excluir módulo da empresa.', error);
    return res.status(500).json({ error: 'Não foi possível excluir o módulo da empresa' });
  } finally {
    if (transaction) transaction.release();
  }
};

const updateClient = async (req, res) => {
  try {
    await requireClientPermission(req.params.clientId, req.user, 'edit');
    const name = String(req.body?.name || '').trim();
    const address = String(req.body?.address || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const email = String(req.body?.email || '').trim();

    if (!name) return res.status(400).json({ error: 'Nome do cliente é obrigatório' });

    const result = await db.query(
      `UPDATE clients
       SET name = $1, address = $2, phone = $3, email = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, name, address, phone, email, created_by, created_at, updated_at, enabled_modules`,
      [name, address || null, phone || null, email || null, req.params.clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.status(200).json(result.rows[0]);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cliente não encontrado' : 'Acesso negado' });
    safeLogError('Erro ao atualizar cliente.', error);
    res.status(500).json({ error: 'Erro ao atualizar cliente' });
  }
};

const deleteClient = async (req, res) => {
  try {
    await requireClientPermission(req.params.clientId, req.user, 'delete');
    if (req.body?.confirmation !== 'EXCLUIR') {
      return res.status(400).json({ error: 'Confirmação de exclusão inválida' });
    }
    const result = await db.query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.clientId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.status(200).json({ deleted: true, id: result.rows[0].id });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cliente não encontrado' : 'Acesso negado' });
    safeLogError('Erro ao excluir cliente.', error);
    res.status(500).json({ error: 'Erro ao excluir cliente' });
  }
};

module.exports = {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getClientModules,
  updateClientModules,
  updateDomainExpirationNotifications,
  deleteClientModule
};
