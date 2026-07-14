const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { JWT_SECRET } = require('../config/security');

const verifyToken = async (req, res, next) => {
  // Pegar o token do header de autorização
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido ou em formato inválido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.id || !Number.isInteger(decoded.token_version)) {
      return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
    }

    const userResult = await db.query(
      `SELECT id, email, role, is_active, token_version
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [decoded.id]
    );

    const user = userResult.rows[0];
    if (!user || user.is_active === false || user.token_version !== decoded.token_version) {
      return res.status(401).json({ error: 'Sessão revogada. Faça login novamente.' });
    }

    const groupsResult = await db.query(
      'SELECT group_id FROM user_groups WHERE user_id = $1',
      [user.id]
    );

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      token_version: user.token_version,
      groups: groupsResult.rows.map((row) => row.group_id)
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
    }
    if (error.code) {
      console.error('Erro ao validar sessão no banco:', error);
      return res.status(503).json({ error: 'Não foi possível validar a sessão.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
};

module.exports = {
  verifyToken
};
