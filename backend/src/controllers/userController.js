const db = require('../config/database');
const argon2 = require('argon2');
const crypto = require('crypto');

// GET /api/users - Lista todos os usuários (apenas admin ou leitura básica)
const getUsers = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY name ASC'
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
};

// POST /api/users - Cadastra um novo usuário com chaves criptográficas
const createUser = async (req, res) => {
  try {
    // Apenas admins podem criar usuários (proteção extra)
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem criar usuários' });
    }

    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    // Verificar se o email já existe
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    // 1. Hash da senha para login (Argon2)
    const hashSenhaLogin = await argon2.hash(password);

    // 2. Gerar Salt Criptográfico Único
    const cryptoSalt = crypto.randomBytes(32).toString('hex');

    // 3. Gerar Master Key Randômica (256 bits / 32 bytes)
    const masterKeyBuffer = crypto.randomBytes(32);

    // 4. Derivar KEK usando PBKDF2 (Senha + Salt)
    // Parâmetros: senha, salt, iterações (100000), tamanho da chave (32 bytes = 256 bits), hash (sha256)
    const kekBuffer = crypto.pbkdf2Sync(password, cryptoSalt, 100000, 32, 'sha256');

    // 5. Envelopar (Wrap) a Master Key com a KEK usando AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', kekBuffer, iv);
    
    let wrappedKeyBuffer = cipher.update(masterKeyBuffer);
    wrappedKeyBuffer = Buffer.concat([wrappedKeyBuffer, cipher.final()]);
    const authTag = cipher.getAuthTag();

    // No Node.js com AES-GCM, precisamos concatenar o authTag ao ciphertext
    // Para manter compatibilidade com o formato da Web Crypto API do frontend:
    // A Web Crypto API anexa a auth tag de 16 bytes no final do ciphertext
    const finalCiphertext = Buffer.concat([wrappedKeyBuffer, authTag]);
    
    // Formato final: base64(iv):base64(ciphertext+authtag)
    const wrappedKey = `${iv.toString('base64')}:${finalCiphertext.toString('base64')}`;

    // 6. Salvar no banco de dados
    const result = await db.query(
      `INSERT INTO users (name, email, hash_senha_login, role, wrapped_key, crypto_salt) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, created_at`,
      [name, email, hashSenhaLogin, role || 'user', wrappedKey, cryptoSalt]
    );

    const newUser = result.rows[0];

    // Se for admin, adicionar ao grupo Administradores (se existir)
    if (newUser.role === 'admin') {
      const adminGroup = await db.query("SELECT id FROM groups WHERE name = 'Administradores'");
      if (adminGroup.rows.length > 0) {
        await db.query(
          'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)',
          [newUser.id, adminGroup.rows[0].id]
        );
      }
    }

    res.status(201).json(newUser);

  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro interno ao criar usuário' });
  }
};

// PUT /api/users/profile - Atualiza o próprio perfil (nome, email, senha e re-envelope da Master Key)
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, new_password, wrapped_key } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email são obrigatórios' });
    }

    // Iniciar transação
    await db.query('BEGIN');

    // Se forneceu nova senha, atualiza a senha e o novo wrapped_key
    if (new_password && wrapped_key) {
      const hashSenhaLogin = await argon2.hash(new_password);
      
      await db.query(
        'UPDATE users SET name = $1, email = $2, hash_senha_login = $3, wrapped_key = $4 WHERE id = $5',
        [name, email, hashSenhaLogin, wrapped_key, userId]
      );
    } else {
      // Atualiza apenas nome e email
      await db.query(
        'UPDATE users SET name = $1, email = $2 WHERE id = $3',
        [name, email, userId]
      );
    }

    await db.query('COMMIT');

    // Retorna o usuário atualizado
    const result = await db.query(
      'SELECT id, name, email, role, wrapped_key, crypto_salt FROM users WHERE id = $1',
      [userId]
    );

    res.status(200).json({
      message: 'Perfil atualizado com sucesso',
      user: result.rows[0]
    });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Erro ao atualizar perfil:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Este e-mail já está em uso' });
    }
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
};

module.exports = {
  getUsers,
  createUser,
  updateProfile
};
