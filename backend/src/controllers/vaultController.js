const db = require('../config/database');
const {
  ensureSharingSchema,
  normalizePermissionSet,
  getClientPermissions,
  requireClientPermission,
  canManageClientShares,
  logVaultAccess
} = require('../services/accessControlService');

// GET /api/vault-items/:clientId/permissions - Retorna as permissões efetivas do usuário no cofre
const getVaultPermissions = async (req, res) => {
  try {
    const { clientId } = req.params;
    const permissions = await getClientPermissions(clientId, req.user);

    if (!permissions.can_view) {
      return res.status(404).json({ error: 'Cofre não encontrado' });
    }

    res.status(200).json(permissions);
  } catch (error) {
    console.error('Erro ao buscar permissões do cofre:', error);
    res.status(500).json({ error: 'Erro ao buscar permissões do cofre' });
  }
};

// GET /api/vault-items/:clientId - Retorna os itens do cofre daquele cliente
const getVaultItems = async (req, res) => {
  try {
    const { clientId } = req.params;

    await requireClientPermission(clientId, req.user, 'view');

    const result = await db.query(
      `SELECT 
         v.id, v.category, v.encrypted_data, v.encrypted_attachment, v.metadata, v.created_by, v.created_at, v.updated_at,
         vs.encrypted_vault_key
       FROM vault_items v
       LEFT JOIN vault_shares vs ON v.id = vs.vault_item_id AND vs.user_id = $2
       WHERE v.client_id = $1 
       ORDER BY v.created_at DESC`,
      [clientId, req.user.id]
    );

    await logVaultAccess(clientId, req.user.id, 'vault_view');
    res.status(200).json(result.rows);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Acesso negado' });
    }

    console.error('Erro ao buscar itens do cofre:', error);
    res.status(500).json({ error: 'Erro ao buscar itens do cofre' });
  }
};

// POST /api/vault-items/:clientId - Salva um novo bloco de dados no cofre
const createVaultItem = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { category, encrypted_data, encrypted_attachment, metadata } = req.body;

    if (!category || !encrypted_data) {
      return res.status(400).json({ error: 'Categoria e dados criptografados são obrigatórios' });
    }

    await requireClientPermission(clientId, req.user, 'write');

    const result = await db.query(
      `INSERT INTO vault_items 
       (client_id, category, encrypted_data, encrypted_attachment, metadata, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, category, metadata, created_at`,
      [clientId, category, encrypted_data, encrypted_attachment, metadata, req.user.id]
    );

    await logVaultAccess(clientId, req.user.id, 'vault_write', { category });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: 'Você não tem permissão para alterar este cofre' });
    }

    console.error('Erro ao salvar item no cofre:', error);
    res.status(500).json({ error: 'Erro ao salvar item no cofre' });
  }
};

// GET /api/vault-items/:clientId/shares - Lista grupos compartilhados e permissões do cofre
const getClientShares = async (req, res) => {
  try {
    const { clientId } = req.params;
    const canManage = await canManageClientShares(clientId, req.user);

    if (!canManage) {
      return res.status(403).json({ error: 'Apenas o dono do cofre ou admin pode gerenciar compartilhamentos' });
    }

    await ensureSharingSchema();

    const result = await db.query(
      `SELECT
         cga.group_id,
         g.name AS group_name,
         g.description AS group_description,
         cga.can_view,
         cga.can_edit,
         cga.can_add,
         cga.can_delete,
         cga.updated_at
       FROM client_group_access cga
       JOIN groups g ON g.id = cga.group_id
       WHERE cga.client_id = $1
       ORDER BY g.name ASC`,
      [clientId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar compartilhamentos do cofre:', error);
    res.status(500).json({ error: 'Erro ao buscar compartilhamentos do cofre' });
  }
};

// PUT /api/vault-items/:clientId/shares - Atualiza grupos e permissões do compartilhamento do cofre
const updateClientShares = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { shares } = req.body;

    if (!Array.isArray(shares)) {
      return res.status(400).json({ error: 'Lista de compartilhamentos inválida' });
    }

    const canManage = await canManageClientShares(clientId, req.user);
    if (!canManage) {
      return res.status(403).json({ error: 'Apenas o dono do cofre ou admin pode gerenciar compartilhamentos' });
    }

    await ensureSharingSchema();
    await db.query('BEGIN');

    await db.query('DELETE FROM client_group_access WHERE client_id = $1', [clientId]);

    for (const share of shares) {
      if (!share.group_id) continue;
      const permissions = normalizePermissionSet(share);
      if (!permissions.can_view) continue;

      const groupCheck = await db.query('SELECT id FROM groups WHERE id = $1', [share.group_id]);
      if (groupCheck.rows.length === 0) continue;

      await db.query(
        `INSERT INTO client_group_access
           (client_id, group_id, can_view, can_edit, can_add, can_delete)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (client_id, group_id)
         DO UPDATE SET
           can_view = EXCLUDED.can_view,
           can_edit = EXCLUDED.can_edit,
           can_add = EXCLUDED.can_add,
           can_delete = EXCLUDED.can_delete,
           updated_at = CURRENT_TIMESTAMP`,
        [clientId, share.group_id, permissions.can_view, permissions.can_edit, permissions.can_add, permissions.can_delete]
      );
    }

    await db.query('COMMIT');
    await logVaultAccess(clientId, req.user.id, 'vault_share_update', { shares: shares.length });
    res.status(200).json({ message: 'Compartilhamento atualizado com sucesso' });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Erro ao atualizar compartilhamentos do cofre:', error);
    res.status(500).json({ error: 'Erro ao atualizar compartilhamentos do cofre' });
  }
};

// POST /api/vault-items/:id/share - Compartilha um item criptográfico com múltiplos usuários (compatibilidade)
const shareVaultItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { shares } = req.body;

    if (!shares || !Array.isArray(shares) || shares.length === 0) {
      return res.status(400).json({ error: 'Nenhum dado de compartilhamento fornecido' });
    }

    const itemCheck = await db.query(
      'SELECT id, client_id, created_by FROM vault_items WHERE id = $1',
      [id]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Item do cofre não encontrado' });
    }

    const canManage = await canManageClientShares(itemCheck.rows[0].client_id, req.user);
    if (!canManage && itemCheck.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Apenas o criador, dono do cofre ou admin pode compartilhar este item' });
    }

    await db.query('BEGIN');

    for (const share of shares) {
      await db.query(
        `INSERT INTO vault_shares (vault_item_id, user_id, encrypted_vault_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (vault_item_id, user_id) 
         DO UPDATE SET encrypted_vault_key = EXCLUDED.encrypted_vault_key, created_at = CURRENT_TIMESTAMP`,
        [id, share.userId, share.encryptedVaultKey]
      );
    }

    await db.query('COMMIT');
    res.status(200).json({ message: 'Cofre compartilhado com sucesso' });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Erro ao compartilhar cofre:', error);
    res.status(500).json({ error: 'Erro ao compartilhar cofre' });
  }
};

module.exports = {
  getVaultPermissions,
  getVaultItems,
  createVaultItem,
  getClientShares,
  updateClientShares,
  shareVaultItem
};
