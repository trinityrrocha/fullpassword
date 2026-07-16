const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { verifyToken } = require('../middleware/authMiddleware');

// Rotas de sistema requerem autenticação
router.use(verifyToken);

router.get('/permissions', systemController.getSystemPermissions);
router.get('/audit-events', systemController.getAuditEvents);
router.post('/update', systemController.updateSystem);
router.get('/backup', systemController.rejectLegacyBackupDownload);
router.post('/backup', systemController.downloadBackup);

module.exports = router;
