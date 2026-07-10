const db = require('../config/database');
const { ensureSharingSchema, normalizePermissionSet } = require('../services/accessControlService');

const normalizeGroupPayload = (body = {}, forceAdmin = false) => {
  if (forceAdmin) {
    return { can_view: true, can_edit: true, can_add: true, can_delete: true };
  }

  return normalizePermissionSet({
    can_view: body.can_view ?? body.canView,
    can_edit: body.can_edit ?? body.canEdit,
    can_add: body.can_add ?? body.canAdd,
    can_delete: body.can_delete ?? body.canDelete
  });
};

// GET /api/groups/options - Lista grupos para seleção em compartilhamento de cofres
const getGroupOptions = async (req, res) => {
  try {
    await ensureSharingSchema();

    const result = await db.query(`
      SELECT
        g.id,
        g.name,
        g.description,
        g.can_view,
        g.can_edit,
        g.can_add,
        g.can_delete,
        COUNT(ug.user_id)::int AS members_count
      FROM groups g
      LEFT JOIN user_groups ug ON ug.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name ASC
    `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar opções de grupos:', error);
    res.status(500).json({ error: 'Erro ao buscar opções de grupos' });
  }
};

// GET /api/groups - Lista todos os grupos e seus usuários
const getGroups = async (req, res) => {
  try {
    await ensureSharingSchema();

    const groupsResult = await db.query('SELECT id, name, description, can_view, can_edit, can_add, can_delete, created_at FROM groups ORDER BY name ASC');
    const groups = groupsResult.rows;

    for (let group of groups) {
      const usersResult = await db.query(`
        SELECT u.id, u.name, u.email, u.role, u.is_active 
        FROM users u
        JOIN user_groups ug ON u.id = ug.user_id
        WHERE ug.group_id = $1
        ORDER BY u.name ASC
      `, [group.id]);
      
      group.users = usersResult.rows;
    }

    res.status(200).json(groups);
  } catch (error) {
    console.error('Erro ao buscar grupos:', error);
    res.status(500).json({ error: 'Erro ao buscar grupos' });
  }
};

// POST /api/groups - Cria um novo grupo
const createGroup = async (req, res) => {
  const client = await db.pool.connect();
  
  try {
    await ensureSharingSchema();

    const { name, description, userIds } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'O nome do grupo é obrigatório' });
    }

    const permissions = normalizeGroupPayload(req.body);

    await client.query('BEGIN');

    const groupResult = await client.query(
      `INSERT INTO groups (name, description, can_view, can_edit, can_add, can_delete)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, can_view, can_edit, can_add, can_delete`,
      [name, description || null, permissions.can_view, permissions.can_edit, permissions.can_add, permissions.can_delete]
    );
    
    const groupId = groupResult.rows[0].id;

    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      for (const userId of userIds) {
        await client.query(
          'INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [groupId, userId]
        );
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Grupo criado com sucesso',
      group: groupResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar grupo:', error);
    res.status(500).json({ error: 'Erro interno ao criar grupo' });
  } finally {
    client.release();
  }
};

// PUT /api/groups/:id - Atualiza um grupo
const updateGroup = async (req, res) => {
  const client = await db.pool.connect();
  
  try {
    await ensureSharingSchema();

    const { id } = req.params;
    const { name, description, userIds } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'O nome do grupo é obrigatório' });
    }

    const existingGroup = await client.query('SELECT name FROM groups WHERE id = $1', [id]);
    if (existingGroup.rows.length === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado' });
    }
    
    const isAdminGroup = existingGroup.rows[0].name === 'Administradores';
    if (isAdminGroup && name !== 'Administradores') {
      return res.status(403).json({ error: 'Não é possível renomear o grupo padrão de Administradores' });
    }

    const permissions = normalizeGroupPayload(req.body, isAdminGroup);

    await client.query('BEGIN');

    const groupResult = await client.query(
      `UPDATE groups
       SET name = $1,
           description = $2,
           can_view = $3,
           can_edit = $4,
           can_add = $5,
           can_delete = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, name, description, can_view, can_edit, can_add, can_delete`,
      [name, description || null, permissions.can_view, permissions.can_edit, permissions.can_add, permissions.can_delete, id]
    );

    if (userIds && Array.isArray(userIds)) {
      await client.query('DELETE FROM user_groups WHERE group_id = $1', [id]);
      
      if (userIds.length > 0) {
        for (const userId of userIds) {
          await client.query(
            'INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, userId]
          );
        }
      }
    }

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Grupo atualizado com sucesso',
      group: groupResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao atualizar grupo:', error);
    res.status(500).json({ error: 'Erro interno ao atualizar grupo' });
  } finally {
    client.release();
  }
};

// DELETE /api/groups/:id - Exclui um grupo
const deleteGroup = async (req, res) => {
  try {
    await ensureSharingSchema();

    const { id } = req.params;

    const existingGroup = await db.query('SELECT name FROM groups WHERE id = $1', [id]);
    if (existingGroup.rows.length === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado' });
    }
    
    if (existingGroup.rows[0].name === 'Administradores') {
      return res.status(403).json({ error: 'Não é possível excluir o grupo padrão de Administradores' });
    }

    await db.query('DELETE FROM groups WHERE id = $1', [id]);

    res.status(200).json({ message: 'Grupo excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir grupo:', error);
    res.status(500).json({ error: 'Erro interno ao excluir grupo' });
  }
};

module.exports = {
  getGroupOptions,
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup
};
