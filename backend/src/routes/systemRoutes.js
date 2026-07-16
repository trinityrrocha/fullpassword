const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const securityController = require('../controllers/securityController');
const { verifyToken } = require('../middleware/authMiddleware');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Rotas de sistema requerem autenticação
router.use(verifyToken);

router.get('/permissions', systemController.getSystemPermissions);
router.get('/audit-events', systemController.getAuditEvents);
router.get('/login-security-policy', asyncRoute(securityController.getPolicy));
router.put('/login-security-policy', asyncRoute(securityController.updatePolicy));
router.get('/login-failures', asyncRoute(securityController.getLoginFailures));
router.post('/ip-rules', asyncRoute(securityController.createIpRule));
router.get('/ip-rules', asyncRoute(securityController.listIpRules));
router.patch('/ip-rules/:id/deactivate', asyncRoute(securityController.deactivateIpRule));
router.post('/ip-rules/block-from-audit', asyncRoute(securityController.blockFromAudit));
router.get('/security-notifications', asyncRoute(securityController.getSecurityNotifications));
router.post('/update', systemController.updateSystem);
router.get('/backup', systemController.rejectLegacyBackupDownload);
router.post('/backup', systemController.downloadBackup);

module.exports = router;
