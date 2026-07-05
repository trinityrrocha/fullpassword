const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { verifyToken } = require('../middleware/authMiddleware');

// Rotas de sistema requerem autenticação
router.use(verifyToken);

router.post('/update', systemController.updateSystem);

module.exports = router;
