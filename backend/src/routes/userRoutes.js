const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');

// Todas as rotas de usuários requerem autenticação
router.use(verifyToken);

router.get('/', userController.getUsers);
router.post('/', userController.createUser);
router.put('/profile', userController.updateProfile);
router.put('/:id', userController.updateUser);

module.exports = router;
