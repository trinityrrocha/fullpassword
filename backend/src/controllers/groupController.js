const db = require('../config/database');

// GET /api/groups - Lista todos os grupos e seus usuários
const getGroups = async (req, res) => {
  try {
    // Buscar todos os grupos
    const groupsResult = await db.query('SELECT id, name, description, created_at FROM groups ORDER BY name ASC');
    const groups = groupsResult.rows;

    // Para cada grupo, buscar os usuários vinculados
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
    const { name, description, userIds } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'O nome do grupo é obrigatório' });
    }

    await client.query('BEGIN');

    // Inserir o grupo
    const groupResult = await client.query(
      'INSERT INTO groups (name, description) VALUES ($1, $2) RETURNING id, name, description',
      [name, description || null]
    );
    
    const groupId = groupResult.rows[0].id;

    // Vincular usuários ao grupo, se fornecidos
    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      for (const userId of userIds) {
        await client.query(
          'INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2)',
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
    const { id } = req.params;
    const { name, description, userIds } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'O nome do grupo é obrigatório' });
    }

    // Proteger o grupo de Administradores
    const existingGroup = await client.query('SELECT name FROM groups WHERE id = $1', [id]);
    if (existingGroup.rows.length === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado' });
    }
    
    if (existingGroup.rows[0].name === 'Administradores' && name !== 'Administradores') {
      return res.status(403).json({ error: 'Não é possível renomear o grupo padrão de Administradores' });
    }

    await client.query('BEGIN');

    // Atualizar o grupo
    const groupResult = await client.query(
      'UPDATE groups SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, name, description',
      [name, description || null, id]
    );

    // Atualizar vínculos apenas se userIds for fornecido
    if (userIds && Array.isArray(userIds)) {
      // 1. Remover todos os vínculos atuais
      await client.query('DELETE FROM user_groups WHERE group_id = $1', [id]);
      
      // 2. Inserir os novos vínculos
      if (userIds.length > 0) {
        for (const userId of userIds) {
          await client.query(
            'INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2)',
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
    const { id } = req.params;

    // Proteger o grupo de Administradores
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
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup
};
