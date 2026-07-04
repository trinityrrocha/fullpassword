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
    const result = await db.query(
      `SELECT id, category, encrypted_data, encrypted_attachment, metadata, created_at, updated_at 
       FROM vault_items 
       WHERE client_id = $1 
       ORDER BY created_at DESC`,
      [clientId]
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

module.exports = {
  getVaultItems,
  createVaultItem
};
