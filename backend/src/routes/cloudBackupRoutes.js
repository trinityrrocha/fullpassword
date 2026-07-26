const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const cloudBackupController = require('../controllers/cloudBackupController');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.use(verifyToken);
router.get('/status', asyncRoute(cloudBackupController.status));
router.put('/settings', asyncRoute(cloudBackupController.saveSettings));
router.put('/provider', asyncRoute(cloudBackupController.saveProvider));
router.post('/test', asyncRoute(cloudBackupController.test));
router.post('/run', asyncRoute(cloudBackupController.run));
router.post('/disconnect', asyncRoute(cloudBackupController.disconnect));
router.get('/runs', asyncRoute(cloudBackupController.runs));

module.exports = router;
