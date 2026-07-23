const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const securityController = require('../controllers/securityController');
const sessionController = require('../controllers/sessionController');
const passwordPolicyController = require('../controllers/passwordPolicyController');
const backupRestoreController = require('../controllers/backupRestoreController');
const multer = require('multer');
const { verifyToken } = require('../middleware/authMiddleware');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, /\.enc\.json$/i.test(file.originalname))
});
const receiveRestoreFile = (req, res, next) => restoreUpload.single('backup')(req, res, (error) => {
  if (!error) return next();
  const tooLarge = error.code === 'LIMIT_FILE_SIZE';
  return res.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? 'BACKUP_RESTORE_FILE_TOO_LARGE' : 'BACKUP_RESTORE_INVALID_UPLOAD',
    message: 'O arquivo de backup não pôde ser enviado.',
    details: tooLarge ? 'O backup excede o limite de 50 MB.' : 'O upload informado é inválido.'
  });
});

// Rotas de sistema requerem autenticação
router.use(verifyToken);

router.get('/permissions', systemController.getSystemPermissions);
router.get('/sessions', sessionController.listAllSessions);
router.delete('/sessions/:id', sessionController.revokeSessionByAdmin);
router.get('/password-policy', passwordPolicyController.getPolicy);
router.put('/password-policy', passwordPolicyController.updatePolicy);
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
router.post('/backup/restore/dry-run', receiveRestoreFile, backupRestoreController.dryRun);
router.post('/backup/restore', receiveRestoreFile, backupRestoreController.restore);

module.exports = router;
