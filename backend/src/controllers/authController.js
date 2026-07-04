const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const db = require('../config/database');

// Chave secreta para JWT
const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    // Buscar usuário no banco
    const result = await db.query(
      'SELECT id, name, email, hash_senha_login, role FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Verificar a senha com Argon2
    // Nota: Em um ambiente real, a senha inicial do seeder precisa ser gerada com Argon2.
    // Como usamos um placeholder no SQL, para testes de desenvolvimento, 
    // podemos adicionar um bypass se a senha do banco for o placeholder e a senha enviada for '@dmin123'
    let isPasswordValid = false;
    
    if (user.hash_senha_login === '$argon2id$v=19$m=65536,t=3,p=4$PLACEHOLDER_HASH_FOR_@dmin123' && password === '@dmin123') {
      isPasswordValid = true;
    } else {
      try {
        isPasswordValid = await argon2.verify(user.hash_senha_login, password);
      } catch (err) {
        console.error('Erro ao verificar senha com Argon2:', err);
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Buscar grupos do usuário
    const groupsResult = await db.query(
      'SELECT group_id FROM user_groups WHERE user_id = $1',
      [user.id]
    );
    
    const groups = groupsResult.rows.map(row => row.group_id);

    // Gerar token JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        groups: groups
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Retornar dados (sem o hash da senha)
    res.status(200).json({
      message: 'Login realizado com sucesso',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor durante a autenticação' });
  }
};

module.exports = {
  login
};
