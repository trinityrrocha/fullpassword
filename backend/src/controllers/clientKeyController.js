const db = require('../config/database');
const {
  requireClientPermission,
  canManageClientShares,
  logVaultAccess
} = require('../services/accessControlService');
const { safeLogError } = require('../utils/safeLogger');

const getClientKeyShare = async (req, res) => {
  try {

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

    safeLogError('Erro ao buscar chave compartilhada do cofre.', error);
    res.status(500).json({ error: 'Erro ao buscar chave compartilhada do cofre' });
  }
};

const updateClientKeyShares = async (req, res) => {
  let transaction;
  try {
    transaction = await db.pool.connect();

    const { clientId } = req.params;
    const { shares } = req.body;

    if (!Array.isArray(shares)) {
      return res.status(400).json({ error: 'Lista de chaves compartilhadas inválida' });
    }

    const canManage = await canManageClientShares(clientId, req.user, transaction);
    if (!canManage) {
      await logVaultAccess(clientId, req.user.id, 'client_key_share_update_denied');
      return res.status(403).json({ error: 'Apenas o dono do cofre ou admin pode atualizar chaves de compartilhamento' });
    }

    await transaction.query('BEGIN');

    let saved = 0;
    for (const share of shares) {
      const userId = share.user_id || share.userId;
      const encryptedClientKey = share.encrypted_client_key || share.encryptedClientKey;

      if (!userId || !encryptedClientKey) continue;

      const userCheck = await transaction.query('SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [userId]);
      if (userCheck.rows.length === 0) continue;

      await transaction.query(
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

    await transaction.query('COMMIT');
    await logVaultAccess(clientId, req.user.id, 'client_key_share_update', { shares: saved });

    res.status(200).json({ message: 'Chaves de compartilhamento atualizadas', saved });
  } catch (error) {
    if (transaction) await transaction.query('ROLLBACK').catch(() => {});
    safeLogError('Erro ao atualizar chaves compartilhadas do cofre.', error);
    res.status(500).json({ error: 'Erro ao atualizar chaves compartilhadas do cofre' });
  } finally {
    transaction?.release();
  }
};

module.exports = {
  getClientKeyShare,
  updateClientKeyShares
};
