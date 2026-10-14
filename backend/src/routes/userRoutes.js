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
router.post('/profile/mfa/disable', mfaController.disableProfileMfa);
router.put('/profile', userController.updateProfile);
router.put('/keys', (_req,res)=>res.status(409).json({code:'IDENTITY_V2_REQUIRED',error:'Use a configuração de identidade independente.'}));
router.patch('/:id/mfa-policy', require('../services/reauthService').guard('admin_mfa_policy'), userController.updateMfaPolicy);
router.post('/:id/mfa-reset', require('../services/reauthService').guard('admin_mfa_reset'), userController.resetMfa);
router.put('/:id', userController.updateUser);
router.delete('/:id', require('../services/reauthService').guard('admin_user_delete'), userController.deleteUser);

module.exports = router;
