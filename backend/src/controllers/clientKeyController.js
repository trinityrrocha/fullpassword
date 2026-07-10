const db = require('../config/database');
const {
  ensureSharingSchema,
  requireClientPermission,
  canManageClientShares,
  logVaultAccess
} = require('../services/accessControlService');

const getClientKeyShare = async (req, res) => {
  try {
    await ensureSharingSchema();

    const { clientId } = req.params;
    await requireClientPermission(clientId, req.user, 'view');

    const result = await db.query(
      `SELECT encrypted_client_key, updated_at
       FROM client_key_shares
       WHERE client_id = $1 AND user_id = $2
       LIMIT 1`,
      [clientId, req.user.id]
    );

    res.status(200).json(result.rows[0] || { encrypted_client_key: null });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.statusCode === 404 ? 'Cofre não encontrado' : 'Acesso negado' });
    }

    console.error('Erro ao buscar chave compartilhada do cofre:', error);
    res.status(500).json({ error: 'Erro ao buscar chave compartilhada do cofre' });
  }
};

const updateClientKeyShares = async (req, res) => {
  try {
    await ensureSharingSchema();

    const { clientId } = req.params;
    const { shares } = req.body;

    if (!Array.isArray(shares)) {
      return res.status(400).json({ error: 'Lista de chaves compartilhadas inválida' });
    }

    const canManage = await canManageClientShares(clientId, req.user);
    if (!canManage) {
      return res.status(403).json({ error: 'Apenas o dono do cofre ou admin pode atualizar chaves de compartilhamento' });
    }

    await db.query('BEGIN');

    let saved = 0;
    for (const share of shares) {
      const userId = share.user_id || share.userId;
      const encryptedClientKey = share.encrypted_client_key || share.encryptedClientKey;

      if (!userId || !encryptedClientKey) continue;

      const userCheck = await db.query('SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [userId]);
      if (userCheck.rows.length === 0) continue;

      await db.query(
        `INSERT INTO client_key_shares (client_id, user_id, encrypted_client_key, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, user_id)
         DO UPDATE SET
           encrypted_client_key = EXCLUDED.encrypted_client_key,
           updated_at = CURRENT_TIMESTAMP`,
        [clientId, userId, encryptedClientKey, req.user.id]
      );
      saved += 1;
    }

    await db.query('COMMIT');
    await logVaultAccess(clientId, req.user.id, 'client_key_share_update', { shares: saved });

    res.status(200).json({ message: 'Chaves de compartilhamento atualizadas', saved });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Erro ao atualizar chaves compartilhadas do cofre:', error);
    res.status(500).json({ error: 'Erro ao atualizar chaves compartilhadas do cofre' });
  }
};

module.exports = {
  getClientKeyShare,
  updateClientKeyShares
};
