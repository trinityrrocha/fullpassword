const express = require('express');
const router = express.Router();
const { requireUuidParam } = require('../middleware/uuidParam');
router.param('id', requireUuidParam);
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
// Membership grants vault access, so changes need the same reauth as editing a user's groups.
const { guard, guardFixed } = require('../services/reauthService');
router.post('/', guardFixed('group_create'), groupController.createGroup);
router.put('/:id', guard('group_change'), groupController.updateGroup);
router.delete('/:id', guard('group_delete'), groupController.deleteGroup);

module.exports = router;
