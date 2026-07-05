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
      // Usamos ANY($1) para passar o array de grupos
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
    // O frontend envia phone e email, mas o banco atual (init.sql) só tem address.
    // Vamos juntar tudo no campo address para não precisar rodar migration agora,
    // ou se preferir salvar no metadata futuramente.
    // O ideal seria adicionar colunas 'phone' e 'email' na tabela clients.
    const { name, address, phone, email, group_ids } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    }

    // Compõe um endereço enriquecido com telefone e e-mail
    let fullAddress = address || '';
    if (phone) fullAddress += ` | Tel: ${phone}`;
    if (email) fullAddress += ` | E-mail: ${email}`;

    // Iniciar transação
    await db.query('BEGIN');

    // Inserir cliente
    const clientResult = await db.query(
      'INSERT INTO clients (name, address) VALUES ($1, $2) RETURNING *',
      [name, fullAddress]
    );
    
    const newClient = clientResult.rows[0];

    // Associar aos grupos, se fornecidos
    if (group_ids && Array.isArray(group_ids) && group_ids.length > 0) {
      for (const groupId of group_ids) {
        await db.query(
          'INSERT INTO client_group_access (client_id, group_id) VALUES ($1, $2)',
          [newClient.id, groupId]
        );
      }
    } else if (req.user.groups && req.user.groups.length > 0) {
      // Se nenhum grupo for especificado, associar ao primeiro grupo do usuário criador (opcional)
      await db.query(
        'INSERT INTO client_group_access (client_id, group_id) VALUES ($1, $2)',
        [newClient.id, req.user.groups[0]]
      );
    }

    await db.query('COMMIT');
    
    res.status(201).json(newClient);

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro ao criar cliente' });
  }
};

module.exports = {
  getClients,
  createClient
};
