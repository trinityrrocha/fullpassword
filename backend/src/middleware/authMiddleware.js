const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui';

const verifyToken = (req, res, next) => {
  // Pegar o token do header de autorização
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido ou em formato inválido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verificar o token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Adicionar os dados do usuário ao objeto request
    req.user = decoded;
    
    next(); // Continuar para a próxima rota
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
};

module.exports = {
  verifyToken
};
