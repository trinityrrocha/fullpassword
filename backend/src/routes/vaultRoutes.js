const express = require('express');
const router = express.Router();
const vaultController = require('../controllers/vaultController');
const { verifyToken } = require('../middleware/authMiddleware');

// Todas as rotas do cofre requerem autenticação
router.use(verifyToken);

// GET /api/vault-items/:clientId
router.get('/:clientId', vaultController.getVaultItems);

// POST /api/vault-items/:clientId
router.post('/:clientId', vaultController.createVaultItem);

module.exports = router;
