const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { verifyToken } = require('../middleware/authMiddleware');

// Todas as rotas de clientes requerem autenticação
router.use(verifyToken);

// GET /api/clients
router.get('/', clientController.getClients);

// POST /api/clients
router.post('/', clientController.createClient);

module.exports = router;
