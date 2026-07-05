const db = require('../config/database');

// GET /api/clients - Lista os clientes permitidos para o grupo do usuário logado
const getClients = async (req, res) => {
  try {
    const userGroups = req.user.groups;
    
    // Se o usuário não pertence a nenhum grupo e não é admin, não vê nada
    if ((!userGroups || userGroups.length === 0) && req.user.role !== 'admin') {
      return res.status(200).json([]);
    }

    let query;
    let params = [];

    // Se for admin, pode ver todos os clientes
    if (req.user.role === 'admin') {
      query = 'SELECT * FROM clients ORDER BY name ASC';
    } else {
      // Caso contrário, vê apenas clientes associados aos seus grupos
      query = `
        SELECT DISTINCT c.* 
        FROM clients c
        JOIN client_group_access cga ON c.id = cga.client_id
        WHERE cga.group_id = ANY($1)
        ORDER BY c.name ASC
      `;
      params = [userGroups];
    }

    const result = await db.query(query, params);
    res.status(200).json(result.rows);

  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
};

// POST /api/clients - Cadastra um novo cliente
const createClient = async (req, res) => {
  try {
    const { name, address, phone, email, group_ids } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    }

    // Iniciar transação
    await db.query('BEGIN');

    // Inserir cliente
    const clientResult = await db.query(
      'INSERT INTO clients (name, address, phone, email) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, address || null, phone || null, email || null]
    );
    
    const newClient = clientResult.rows[0];

    // Determinar os grupos para vincular ao cliente
    let groupsToLink = [];

    if (group_ids && Array.isArray(group_ids) && group_ids.length > 0) {
      // Grupos explicitamente fornecidos pelo frontend
      groupsToLink = group_ids;
    } else if (req.user.groups && req.user.groups.length > 0) {
      // Usar o primeiro grupo válido do usuário criador
      groupsToLink = [req.user.groups[0]];
    } else {
      // Fallback: buscar o grupo "Administradores" diretamente no banco
      // Isso garante que instalações limpas (onde o admin ainda não tem grupo no JWT)
      // não causem erro de chave estrangeira
      const adminGroupResult = await db.query(
        "SELECT id FROM groups WHERE name = 'Administradores' LIMIT 1"
      );

      if (adminGroupResult.rows.length > 0) {
        groupsToLink = [adminGroupResult.rows[0].id];
      } else {
        // Último recurso: buscar qualquer grupo existente
        const anyGroupResult = await db.query(
          'SELECT id FROM groups ORDER BY created_at ASC LIMIT 1'
        );
        if (anyGroupResult.rows.length > 0) {
          groupsToLink = [anyGroupResult.rows[0].id];
        }
        // Se não existir nenhum grupo, o cliente é criado sem vínculo (sem erro)
      }
    }

    // Inserir vínculos apenas com IDs válidos
    for (const groupId of groupsToLink) {
      // Verificar se o grupo realmente existe antes de inserir (evita FK violation)
      const groupCheck = await db.query('SELECT id FROM groups WHERE id = $1', [groupId]);
      if (groupCheck.rows.length > 0) {
        await db.query(
          'INSERT INTO client_group_access (client_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
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
