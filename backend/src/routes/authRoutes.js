const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// Rota POST /api/auth/login
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/me', verifyToken, authController.me);
router.get('/bootstrap/status', authController.bootstrapStatus);
router.post('/bootstrap', authController.bootstrapAdmin);

module.exports = router;
