const db = require('../config/database');
const { ensureSharingSchema, requireClientPermission } = require('../services/accessControlService');
const { isSuperAdmin } = require('../config/security');

// GET /api/clients - Lista apenas cofres próprios ou compartilhados com grupos que podem visualizar
const getClients = async (req, res) => {
  try {
    await ensureSharingSchema();

    const userGroups = Array.isArray(req.user.groups) ? req.user.groups.filter(Boolean) : [];
    let query;
    let params = [];

    if (isSuperAdmin(req.user)) {
      query = `
        SELECT c.*,
               creator.name AS created_by_name,
               TRUE AS can_view,
               TRUE AS can_edit,
               TRUE AS can_add,
               TRUE AS can_delete,
               TRUE AS is_admin,
               (c.created_by = $1) AS is_owner
        FROM clients c
        LEFT JOIN users creator ON creator.id = c.created_by
        ORDER BY c.name ASC
      `;
      params = [req.user.id];
    } else {
      query = `
        SELECT DISTINCT c.*,
               creator.name AS created_by_name,
               COALESCE(bool_or(g.can_view), false) OR c.created_by = $1 AS can_view,
               COALESCE(bool_or(g.can_edit), false) OR c.created_by = $1 AS can_edit,
               COALESCE(bool_or(g.can_add), false) OR c.created_by = $1 AS can_add,
               COALESCE(bool_or(cga.can_delete), false) OR c.created_by = $1 AS can_delete,
               FALSE AS is_admin,
               c.created_by = $1 AS is_owner
        FROM clients c
        LEFT JOIN users creator ON creator.id = c.created_by
        LEFT JOIN client_group_access cga
          ON c.id = cga.client_id
         AND cga.group_id = ANY($2::uuid[])
        LEFT JOIN groups g ON g.id = cga.group_id
        WHERE c.created_by = $1 OR g.can_view = TRUE
        GROUP BY c.id, creator.name
        ORDER BY c.name ASC
      `;
      params = [req.user.id, userGroups];
    }

    const result = await db.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
};

// POST /api/clients - Cadastra um novo cofre/cliente
const createClient = async (req, res) => {
  try {
    await ensureSharingSchema();

    const { name, address, phone, email, group_ids } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    }

    await db.query('BEGIN');

    const clientResult = await db.query(
      'INSERT INTO clients (name, address, phone, email, created_by, enabled_modules) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, address || null, phone || null, email || null, req.user.id, []]
    );
    
    const newClient = clientResult.rows[0];

    const groupsToLink = Array.isArray(group_ids) ? group_ids.filter(Boolean) : [];

    for (const groupId of groupsToLink) {
      const groupCheck = await db.query('SELECT id FROM groups WHERE id = $1', [groupId]);
      if (groupCheck.rows.length > 0) {
        await db.query(
          `INSERT INTO client_group_access (client_id, group_id)
           VALUES ($1, $2)
           ON CONFLICT (client_id, group_id) DO NOTHING`,
          [newClient.id, groupId]
        );
      }
    }

    await db.query('COMMIT');
    res.status(201).json(newClient);
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro ao criar cliente: ' + error.message });
  }
};

const allowedModules = ['cpanelWeb', 'vpn', 'windowsServer', 'linuxServer'];
const moduleVaultCategories = Object.freeze({
  cpanelWeb: ['cPanel'],
  vpn: ['VPN'],
  windowsServer: ['Servidor TS'],
  linuxServer: ['Servidor Linux', 'Servidores Diversos']
});

const getClientModules = async (req, res) => {
  try {
    await ensureSharingSchema();
    await requireClientPermission(req.params.clientId, req.user, 'view');
    const result = await db.query('SELECT enabled_modules FROM clients WHERE id = $1', [req.params.clientId]);
    res.status(200).json({ enabledModules: result.rows[0]?.enabled_modules ?? null });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Acesso negado' });
    console.error('Erro ao buscar módulos da empresa:', error);
    res.status(500).json({ error: 'Erro ao buscar módulos da empresa' });
  }
};

const updateClientModules = async (req, res) => {
  try {
    await ensureSharingSchema();
    await requireClientPermission(req.params.clientId, req.user, 'edit');
    const requestedModules = req.body?.enabledModules;
    if (!Array.isArray(requestedModules)) return res.status(400).json({ error: 'Lista de módulos inválida' });
    const enabledModules = allowedModules.filter((moduleId) => requestedModules.includes(moduleId));
    await db.query('UPDATE clients SET enabled_modules = $1 WHERE id = $2', [enabledModules, req.params.clientId]);
    res.status(200).json({ enabledModules });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Acesso negado' });
    console.error('Erro ao atualizar módulos da empresa:', error);
    res.status(500).json({ error: 'Erro ao atualizar módulos da empresa' });
  }
};

const deleteClientModule = async (req, res) => {
  let transaction;

  try {
    await ensureSharingSchema();

    const { clientId, moduleId } = req.params;
    const categories = moduleVaultCategories[moduleId];

    if (!categories) {
      return res.status(400).json({ error: 'Módulo inválido' });
    }

    if (req.body?.confirmation !== 'EXCLUIR') {
      return res.status(400).json({ error: 'Confirmação de exclusão inválida' });
    }

    await requireClientPermission(clientId, req.user, 'delete');

    transaction = await db.pool.connect();
    await transaction.query('BEGIN');

    const clientResult = await transaction.query(
      'SELECT enabled_modules FROM clients WHERE id = $1 FOR UPDATE',
      [clientId]
    );

    if (clientResult.rows.length === 0) {
      await transaction.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const currentModules = Array.isArray(clientResult.rows[0].enabled_modules)
      ? allowedModules.filter((allowedModule) => clientResult.rows[0].enabled_modules.includes(allowedModule))
      : allowedModules;
    const enabledModules = currentModules.filter((enabledModule) => enabledModule !== moduleId);

    const deletedItems = await transaction.query(
      'DELETE FROM vault_items WHERE client_id = $1 AND category = ANY($2::text[]) RETURNING id',
      [clientId, categories]
    );

    await transaction.query(
      'UPDATE clients SET enabled_modules = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [enabledModules, clientId]
    );

    await transaction.query('COMMIT');

    await logVaultAccess(clientId, req.user.id, 'vault_module_delete', {
      module_id: moduleId,
      deleted_items: deletedItems.rowCount
    });

    return res.status(200).json({
      deleted: true,
      moduleId,
      enabledModules,
      deletedItems: deletedItems.rowCount
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao reverter exclusão de módulo:', rollbackError);
      }
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Você não tem permissão para excluir este módulo'
      });
    }

    console.error('Erro ao excluir módulo da empresa:', error);
    return res.status(500).json({ error: 'Não foi possível excluir o módulo da empresa' });
  } finally {
    if (transaction) transaction.release();
  }
};

const updateClient = async (req, res) => {
  try {
    await ensureSharingSchema();
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
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({ error: 'Erro ao atualizar cliente' });
  }
};

const deleteClient = async (req, res) => {
  try {
    await ensureSharingSchema();
    await requireClientPermission(req.params.clientId, req.user, 'delete');
    if (req.body?.confirmation !== 'EXCLUIR') {
      return res.status(400).json({ error: 'Confirmação de exclusão inválida' });
    }
    const result = await db.query('DELETE FROM clients WHERE id = $1 RETURNING id', [req.params.clientId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.status(200).json({ deleted: true, id: result.rows[0].id });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cliente não encontrado' : 'Acesso negado' });
    console.error('Erro ao excluir cliente:', error);
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
  deleteClientModule
};
