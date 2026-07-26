const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const cloudBackupController = require('../controllers/cloudBackupController');
const {
  cloudBackupConfigLimiter,
  cloudBackupOperationLimiter
} = require('../middleware/writeRateLimiters');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.use(verifyToken);
router.get('/status', asyncRoute(cloudBackupController.status));
router.put('/settings', cloudBackupConfigLimiter, asyncRoute(cloudBackupController.saveSettings));
router.put('/provider', cloudBackupConfigLimiter, asyncRoute(cloudBackupController.saveProvider));
router.post('/test', cloudBackupOperationLimiter, asyncRoute(cloudBackupController.test));
router.post('/run', cloudBackupOperationLimiter, asyncRoute(cloudBackupController.run));
router.post('/disconnect', cloudBackupConfigLimiter, asyncRoute(cloudBackupController.disconnect));
router.get('/runs', asyncRoute(cloudBackupController.runs));

module.exports = router;
