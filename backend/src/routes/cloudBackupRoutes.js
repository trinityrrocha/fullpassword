const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const cloudBackupController = require('../controllers/cloudBackupController');
const {
  cloudBackupConfigLimiter,
  cloudBackupOperationLimiter
} = require('../middleware/writeRateLimiters');

const { guardFixed } = require('../services/reauthService');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.use(verifyToken);
router.get('/status', asyncRoute(cloudBackupController.status));
router.put('/settings', cloudBackupConfigLimiter, guardFixed('backup_settings'), asyncRoute(cloudBackupController.saveSettings));
router.put('/provider', cloudBackupConfigLimiter, guardFixed('backup_settings'), asyncRoute(cloudBackupController.saveProvider));
router.post('/test', cloudBackupOperationLimiter, asyncRoute(cloudBackupController.test));
router.post('/run', cloudBackupOperationLimiter, asyncRoute(cloudBackupController.run));
router.post('/disconnect', cloudBackupConfigLimiter, guardFixed('backup_settings'), asyncRoute(cloudBackupController.disconnect));
router.get('/runs', asyncRoute(cloudBackupController.runs));

module.exports = router;
