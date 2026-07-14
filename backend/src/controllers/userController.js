const db = require('../config/database');
const argon2 = require('argon2');
const crypto = require('crypto');
const { ensureSharingSchema } = require('../services/accessControlService');
const VALID_ROLES = new Set(['admin', 'user']);
const isStrongPassword = (password) => typeof password === 'string' && password.length >= 12;

const getValidGroupIds = async (groupIds = []) => {
  const uniqueIds = [...new Set((Array.isArray(groupIds) ? groupIds : []).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const result = await db.query('SELECT id FROM groups WHERE id = ANY($1::uuid[])', [uniqueIds]);
  return result.rows.map((row) => row.id);
};

const ensureAdminGroupMembership = async (client, userId) => {
  const adminGroup = await client.query("SELECT id FROM groups WHERE name = 'Administradores' LIMIT 1");
  if (adminGroup.rows.length > 0) {
    await client.query(
      'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, adminGroup.rows[0].id]
    );
  }
};

const loadUserGroups = async (userIds = []) => {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const result = await db.query(
    `SELECT ug.user_id, g.id, g.name, g.description, g.can_view, g.can_edit, g.can_add, g.can_delete
     FROM user_groups ug
     JOIN groups g ON g.id = ug.group_id
     WHERE ug.user_id = ANY($1::uuid[])
     ORDER BY g.name ASC`,
    [uniqueIds]
  );

  const map = new Map();
  uniqueIds.forEach((id) => map.set(id, []));

  result.rows.forEach((row) => {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push({
      id: row.id,
      name: row.name,
      description: row.description,
      can_view: row.can_view,
      can_edit: row.can_edit,
      can_add: row.can_add,
      can_delete: row.can_delete
    });
  });

  return map;
};

// GET /api/users - Lista todos os usuários com seus grupos
const getUsers = async (req, res) => {
  try {
    await ensureSharingSchema();

    const result = await db.query(
      'SELECT id, name, email, role, is_active, public_key, created_at FROM users ORDER BY name ASC'
    );

    const groupMap = await loadUserGroups(result.rows.map((user) => user.id));
    const users = result.rows.map((user) => ({
      ...user,
      groups: groupMap.get(user.id) || []
    }));

    res.status(200).json(users);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
};

// POST /api/users - Cadastra um novo usuário com chaves criptográficas
const createUser = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await ensureSharingSchema();

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem criar usuários' });
    }

    const { name, email, password, role, groupIds } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'A senha deve ter ao menos 12 caracteres' });
    }
    if (role !== undefined && !VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Nível de acesso inválido' });
    }

    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    const hashSenhaLogin = await argon2.hash(password);
    const cryptoSalt = crypto.randomBytes(32).toString('hex');
    const masterKeyBuffer = crypto.randomBytes(32);
    const kekBuffer = crypto.pbkdf2Sync(password, cryptoSalt, 100000, 32, 'sha256');

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', kekBuffer, iv);
    let wrappedKeyBuffer = cipher.update(masterKeyBuffer);
    wrappedKeyBuffer = Buffer.concat([wrappedKeyBuffer, cipher.final()]);
    const authTag = cipher.getAuthTag();
    const finalCiphertext = Buffer.concat([wrappedKeyBuffer, authTag]);
    const wrappedKey = `${iv.toString('base64')}:${finalCiphertext.toString('base64')}`;

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO users (name, email, hash_senha_login, role, wrapped_key, crypto_salt) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, is_active, created_at`,
      [name, email, hashSenhaLogin, role || 'user', wrappedKey, cryptoSalt]
    );

    const newUser = result.rows[0];
    const validGroupIds = await getValidGroupIds(groupIds);

    for (const groupId of validGroupIds) {
      await client.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [newUser.id, groupId]
      );
    }

    if (newUser.role === 'admin') {
      await ensureAdminGroupMembership(client, newUser.id);
    }

    await client.query('COMMIT');

    res.status(201).json(newUser);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro interno ao criar usuário' });
  } finally {
    client.release();
  }
};

// PUT /api/users/profile - Atualiza o próprio perfil (nome, email, senha e re-envelope da Master Key)
const updateProfile = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const userId = req.user.id;
    const { name, email, current_password, new_password, wrapped_key } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email são obrigatórios' });
    }

    await client.query('BEGIN');
    const currentResult = await client.query(
      'SELECT email, hash_senha_login FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const currentUser = currentResult.rows[0];
    if (!currentUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const sensitiveChange = new_password || String(email).trim().toLowerCase() !== currentUser.email;
    if (sensitiveChange) {
      if (!current_password || !(await argon2.verify(currentUser.hash_senha_login, current_password))) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Senha atual inválida' });
      }
    }

    if (new_password && wrapped_key) {
      if (!isStrongPassword(new_password)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A nova senha deve ter ao menos 12 caracteres' });
      }
      const hashSenhaLogin = await argon2.hash(new_password);
      
      await client.query(
        `UPDATE users SET name = $1, email = $2, hash_senha_login = $3, wrapped_key = $4,
                          token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [name, String(email).trim().toLowerCase(), hashSenhaLogin, wrapped_key, userId]
      );
    } else {
      await client.query(
        `UPDATE users SET name = $1, email = $2,
                          token_version = token_version + CASE WHEN email <> $2 THEN 1 ELSE 0 END,
                          updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [name, String(email).trim().toLowerCase(), userId]
      );
    }

    await client.query('COMMIT');

    const result = await client.query(
      'SELECT id, name, email, role, wrapped_key, crypto_salt FROM users WHERE id = $1',
      [userId]
    );

    res.status(200).json({
      message: 'Perfil atualizado com sucesso',
      user: result.rows[0],
      session_invalidated: Boolean(sensitiveChange)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao atualizar perfil:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Este e-mail já está em uso' });
    }
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  } finally {
    client.release();
  }
};

// PUT /api/users/:id - Atualiza um usuário específico (Apenas admin)
const updateUser = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await ensureSharingSchema();

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem editar usuários' });
    }

    const { id } = req.params;
    const { name, email, role, is_active, password, groupIds } = req.body;
    if (role !== undefined && !VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Nível de acesso inválido' });
    }
    if (password && !isStrongPassword(password)) {
      return res.status(400).json({ error: 'A senha deve ter ao menos 12 caracteres' });
    }

    const existingUser = await client.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const targetEmail = existingUser.rows[0].email;
    const nextRole = role !== undefined ? role : existingUser.rows[0].role;

    if (targetEmail === 'admin@admin.com.br') {
      if (role && role !== 'admin') {
        return res.status(403).json({ error: 'Não é possível remover o nível de administrador do usuário principal' });
      }
      if (is_active === false) {
        return res.status(403).json({ error: 'Não é possível inativar o administrador principal' });
      }
    }

    if (email && email !== targetEmail) {
      const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Este e-mail já está em uso por outro usuário' });
      }
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }

    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    
    if (role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    if (password && password.trim() !== '') {
      const hashSenhaLogin = await argon2.hash(password);
      updates.push(`hash_senha_login = $${paramIndex++}`);
      values.push(hashSenhaLogin);

      const cryptoSalt = crypto.randomBytes(32).toString('hex');
      const masterKeyBuffer = crypto.randomBytes(32);
      const kekBuffer = crypto.pbkdf2Sync(password, cryptoSalt, 100000, 32, 'sha256');

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', kekBuffer, iv);
      let wrappedKeyBuffer = cipher.update(masterKeyBuffer);
      wrappedKeyBuffer = Buffer.concat([wrappedKeyBuffer, cipher.final()]);
      const authTag = cipher.getAuthTag();
      const finalCiphertext = Buffer.concat([wrappedKeyBuffer, authTag]);
      const wrappedKey = `${iv.toString('base64')}:${finalCiphertext.toString('base64')}`;

      updates.push(`crypto_salt = $${paramIndex++}`);
      values.push(cryptoSalt);
      updates.push(`wrapped_key = $${paramIndex++}`);
      values.push(wrappedKey);
      updates.push(`public_key = $${paramIndex++}`);
      values.push(null);
      updates.push(`encrypted_private_key = $${paramIndex++}`);
      values.push(null);
    }

    if (password || role !== undefined || is_active !== undefined || email !== undefined) {
      updates.push('token_version = token_version + 1');
    }

    if (updates.length === 0 && groupIds === undefined) {
      return res.status(400).json({ error: 'Nenhum dado fornecido para atualização' });
    }

    await client.query('BEGIN');

    let updatedUser = null;
    if (updates.length > 0) {
      values.push(id);
      const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, name, email, role, is_active`;
      const result = await client.query(query, values);
      updatedUser = result.rows[0];
    } else {
      const result = await client.query('SELECT id, name, email, role, is_active FROM users WHERE id = $1', [id]);
      updatedUser = result.rows[0];
    }

    if (Array.isArray(groupIds)) {
      const validGroupIds = await getValidGroupIds(groupIds);
      await client.query('DELETE FROM user_groups WHERE user_id = $1', [id]);

      for (const groupId of validGroupIds) {
        await client.query(
          'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, groupId]
        );
      }
    }

    if (targetEmail === 'admin@admin.com.br' || nextRole === 'admin') {
      await ensureAdminGroupMembership(client, id);
    }

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Usuário atualizado com sucesso',
      user: updatedUser
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ error: 'Erro interno ao atualizar usuário' });
  } finally {
    client.release();
  }
};

// PUT /api/users/keys - Salva as chaves RSA do usuário autenticado
const updateKeys = async (req, res) => {
  try {
    const userId = req.user.id;
    const { public_key, encrypted_private_key } = req.body;

    if (!public_key || !encrypted_private_key) {
      return res.status(400).json({ error: 'Chaves pública e privada são obrigatórias' });
    }

    await db.query(
      'UPDATE users SET public_key = $1, encrypted_private_key = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [public_key, encrypted_private_key, userId]
    );

    res.status(200).json({ message: 'Chaves criptográficas salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar chaves RSA:', error);
    res.status(500).json({ error: 'Erro interno ao salvar chaves' });
  }
};

module.exports = {
  getUsers,
  createUser,
  updateProfile,
  updateUser,
  updateKeys
};
