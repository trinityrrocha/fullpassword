const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const { verifyToken } = require('../middleware/authMiddleware');

// Middleware para verificar se o usuário é admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar grupos.' });
  }
  next();
};

// Todas as rotas de grupos exigem autenticação e nível de admin
router.use(verifyToken);
router.use(requireAdmin);

// Rotas CRUD
router.get('/', groupController.getGroups);
router.post('/', groupController.createGroup);
router.put('/:id', groupController.updateGroup);
router.delete('/:id', groupController.deleteGroup);

module.exports = router;
