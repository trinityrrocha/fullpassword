const express = require('express');
const router = express.Router();
const vaultController = require('../controllers/vaultController');
const clientKeyController = require('../controllers/clientKeyController');
const { verifyToken } = require('../middleware/authMiddleware');

// Todas as rotas do cofre requerem autenticação
router.use(verifyToken);

// GET /api/vault-items/:clientId/permissions
router.get('/:clientId/permissions', vaultController.getVaultPermissions);

// GET /api/vault-items/:clientId/key-share
router.get('/:clientId/key-share', clientKeyController.getClientKeyShare);

// PUT /api/vault-items/:clientId/key-shares
router.put('/:clientId/key-shares', clientKeyController.updateClientKeyShares);

// GET /api/vault-items/:clientId/shares
router.get('/:clientId/shares', vaultController.getClientShares);

// PUT /api/vault-items/:clientId/shares
router.put('/:clientId/shares', vaultController.updateClientShares);

// GET /api/vault-items/:clientId
router.get('/:clientId', vaultController.getVaultItems);

// POST /api/vault-items/:clientId
router.post('/:clientId', vaultController.createVaultItem);

// POST /api/vault-items/:id/share
router.post('/:id/share', vaultController.shareVaultItem);

module.exports = router;
