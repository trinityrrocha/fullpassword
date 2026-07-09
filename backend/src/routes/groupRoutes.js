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

router.use(verifyToken);

// Lista simples de grupos para seleção de compartilhamento de cofres.
// Usuários autenticados podem consultar grupos existentes, mas somente admin gerencia grupos.
router.get('/options', groupController.getGroupOptions);

// Rotas CRUD restritas a administradores
router.use(requireAdmin);
router.get('/', groupController.getGroups);
router.post('/', groupController.createGroup);
router.put('/:id', groupController.updateGroup);
router.delete('/:id', groupController.deleteGroup);

module.exports = router;
