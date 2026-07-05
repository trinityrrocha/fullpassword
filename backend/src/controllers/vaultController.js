const db = require('../config/database');

// Middleware interno para verificar se o usuário tem acesso ao cliente
const checkClientAccess = async (clientId, user) => {
  if (user.role === 'admin') return true;
  
  if (!user.groups || user.groups.length === 0) return false;

  const result = await db.query(
    'SELECT 1 FROM client_group_access WHERE client_id = $1 AND group_id = ANY($2)',
    [clientId, user.groups]
  );

  return result.rows.length > 0;
};

// GET /api/vault-items/:clientId - Retorna os itens do cofre daquele cliente
const getVaultItems = async (req, res) => {
  try {
    const { clientId } = req.params;

    // Verificar acesso
    const hasAccess = await checkClientAccess(clientId, req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Acesso negado a este cliente' });
    }

    // Retorna os dados criptografados (Zero-Knowledge)
    // Agora busca os itens que o usuário criou OU que foram compartilhados com ele
    const result = await db.query(
      `SELECT 
         v.id, v.category, v.encrypted_data, v.encrypted_attachment, v.metadata, v.created_by, v.created_at, v.updated_at,
         vs.encrypted_vault_key
       FROM vault_items v
       LEFT JOIN vault_shares vs ON v.id = vs.vault_item_id AND vs.user_id = $2
       WHERE v.client_id = $1 
         AND (v.created_by = $2 OR vs.user_id = $2 OR $3 = 'admin')
       ORDER BY v.created_at DESC`,
      [clientId, req.user.id, req.user.role]
    );

    res.status(200).json(result.rows);

  } catch (error) {
    console.error('Erro ao buscar itens do cofre:', error);
    res.status(500).json({ error: 'Erro ao buscar itens do cofre' });
  }
};

// POST /api/vault-items/:clientId - Salva um novo bloco de dados no cofre
const createVaultItem = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { category, encrypted_data, encrypted_attachment, metadata } = req.body;

    // Validações básicas
    if (!category || !encrypted_data) {
      return res.status(400).json({ error: 'Categoria e dados criptografados são obrigatórios' });
    }

    // Verificar acesso
    const hasAccess = await checkClientAccess(clientId, req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Acesso negado a este cliente' });
    }

    // Inserir no banco de dados (backend apenas armazena o que recebe)
    const result = await db.query(
      `INSERT INTO vault_items 
       (client_id, category, encrypted_data, encrypted_attachment, metadata, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, category, metadata, created_at`,
      [clientId, category, encrypted_data, encrypted_attachment, metadata, req.user.id]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error('Erro ao salvar item no cofre:', error);
    res.status(500).json({ error: 'Erro ao salvar item no cofre' });
  }
};

// POST /api/vault-items/:id/share - Compartilha um cofre com múltiplos usuários
const shareVaultItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { shares } = req.body; // Array de { userId, encryptedVaultKey }

    if (!shares || !Array.isArray(shares) || shares.length === 0) {
      return res.status(400).json({ error: 'Nenhum dado de compartilhamento fornecido' });
    }

    // Verificar se o usuário é dono do cofre ou admin
    const itemCheck = await db.query(
      'SELECT created_by FROM vault_items WHERE id = $1',
      [id]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Item do cofre não encontrado' });
    }

    if (itemCheck.rows[0].created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas o criador ou admin pode compartilhar este cofre' });
    }

    await db.query('BEGIN');

    // Limpar compartilhamentos anteriores deste cofre para estes usuários (se for re-compartilhamento)
    // Opcional: dependendo da regra de negócio, você pode deletar todos os compartilhamentos antigos ou apenas dar upsert
    // Usaremos ON CONFLICT para simplificar

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
  getVaultItems,
  createVaultItem,
  shareVaultItem
};
