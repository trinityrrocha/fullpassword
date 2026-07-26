const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const googleDriveBackupController = require('../controllers/googleDriveBackupController');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// O callback valida state de uso único porque o cookie SameSite não acompanha
// necessariamente o retorno do provedor OAuth.
router.get('/google-drive/oauth/callback', asyncRoute(googleDriveBackupController.oauthCallback));

router.use(verifyToken);
router.get('/google-drive/status', asyncRoute(googleDriveBackupController.getStatus));
router.get('/google-drive/oauth/start', asyncRoute(googleDriveBackupController.startOAuth));
router.put('/google-drive/settings', asyncRoute(googleDriveBackupController.saveSettings));
router.post('/google-drive/disconnect', asyncRoute(googleDriveBackupController.disconnect));
router.post('/google-drive/test', asyncRoute(googleDriveBackupController.test));
router.post('/google-drive/backup-now', asyncRoute(googleDriveBackupController.backupNow));

module.exports = router;
