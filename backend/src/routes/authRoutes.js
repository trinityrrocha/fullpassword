const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Rota POST /api/auth/login
router.post('/login', authController.login);
router.get('/bootstrap/status', authController.bootstrapStatus);
router.post('/bootstrap', authController.bootstrapAdmin);

module.exports = router;
