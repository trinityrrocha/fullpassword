const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const mfaController = require('../controllers/mfaController');
const { verifyToken } = require('../middleware/authMiddleware');

// Todas as rotas de usuários requerem autenticação
router.use(verifyToken);

router.get('/', userController.getUsers);
router.post('/', userController.createUser);
router.get('/profile/mfa', mfaController.getProfileStatus);
router.post('/profile/mfa/setup/start', mfaController.startProfileSetup);
router.post('/profile/mfa/setup/confirm', mfaController.confirmProfileSetup);
router.post('/profile/mfa/recovery-codes/regenerate', mfaController.regenerateRecoveryCodes);
router.put('/profile', userController.updateProfile);
router.put('/keys', userController.updateKeys);
router.patch('/:id/mfa-policy', userController.updateMfaPolicy);
router.post('/:id/mfa-reset', userController.resetMfa);
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;
