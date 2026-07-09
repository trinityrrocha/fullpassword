const db = require('../config/database');
const { ensureSharingSchema } = require('../services/accessControlService');

// GET /api/clients - Lista apenas cofres próprios ou compartilhados com visualização
const getClients = async (req, res) => {
  try {
    await ensureSharingSchema();

    const userGroups = Array.isArray(req.user.groups) ? req.user.groups.filter(Boolean) : [];
    let query;
    let params = [];

    if (req.user.role === 'admin') {
      query = `
        SELECT c.*,
               TRUE AS can_view,
               TRUE AS can_edit,
               TRUE AS can_add,
               TRUE AS can_delete,
               TRUE AS is_admin,
               (c.created_by = $1) AS is_owner
        FROM clients c
        ORDER BY c.name ASC
      `;
      params = [req.user.id];
    } else {
      query = `
        SELECT DISTINCT c.*,
               COALESCE(bool_or(cga.can_view), false) OR c.created_by = $1 AS can_view,
               COALESCE(bool_or(cga.can_edit), false) OR c.created_by = $1 AS can_edit,
               COALESCE(bool_or(cga.can_add), false) OR c.created_by = $1 AS can_add,
               COALESCE(bool_or(cga.can_delete), false) OR c.created_by = $1 AS can_delete,
               FALSE AS is_admin,
               c.created_by = $1 AS is_owner
        FROM clients c
        LEFT JOIN client_group_access cga
          ON c.id = cga.client_id
         AND cga.group_id = ANY($2::uuid[])
        WHERE c.created_by = $1 OR cga.can_view = TRUE
        GROUP BY c.id
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
      'INSERT INTO clients (name, address, phone, email, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, address || null, phone || null, email || null, req.user.id]
    );
    
    const newClient = clientResult.rows[0];

    const groupsToLink = Array.isArray(group_ids) ? group_ids.filter(Boolean) : [];

    for (const groupId of groupsToLink) {
      const groupCheck = await db.query('SELECT id FROM groups WHERE id = $1', [groupId]);
      if (groupCheck.rows.length > 0) {
        await db.query(
          `INSERT INTO client_group_access
             (client_id, group_id, can_view, can_edit, can_add, can_delete)
           VALUES ($1, $2, TRUE, TRUE, TRUE, FALSE)
           ON CONFLICT (client_id, group_id)
           DO UPDATE SET
             can_view = TRUE,
             can_edit = TRUE,
             can_add = TRUE,
             updated_at = CURRENT_TIMESTAMP`,
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

module.exports = {
  getClients,
  createClient
};
