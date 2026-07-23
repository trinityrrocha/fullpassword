const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const securityController = require('../controllers/securityController');
const sessionController = require('../controllers/sessionController');
const passwordPolicyController = require('../controllers/passwordPolicyController');
const backupRestoreController = require('../controllers/backupRestoreController');
const multer = require('multer');
const { verifyToken } = require('../middleware/authMiddleware');
const { MAX_BACKUP_BYTES, isEncryptedBackupFilename } = require('../services/backupRestoreService');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BACKUP_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (isEncryptedBackupFilename(file.originalname)) return callback(null, true);
    const error = new Error('A extensão do arquivo precisa ser .enc.json.');
    error.code = 'BACKUP_INVALID_EXTENSION';
    console.warn('Upload de backup recusado.', {
      stage: 'upload',
      code: error.code,
      originalname: String(file.originalname || '').slice(0, 255),
      mimetype: String(file.mimetype || '').slice(0, 100)
    });
    return callback(error);
  }
});
const receiveRestoreFile = (req, res, next) => restoreUpload.single('backup')(req, res, (error) => {
  if (!error) return next();
  const tooLarge = error.code === 'LIMIT_FILE_SIZE';
  const invalidExtension = error.code === 'BACKUP_INVALID_EXTENSION';
  return res.status(tooLarge ? 413 : 400).json({
    error: tooLarge
      ? 'BACKUP_RESTORE_FILE_TOO_LARGE'
      : invalidExtension
        ? 'BACKUP_INVALID_EXTENSION'
        : 'BACKUP_RESTORE_INVALID_UPLOAD',
    message: invalidExtension
      ? 'A extensão do arquivo precisa ser .enc.json.'
      : 'O arquivo de backup não pôde ser enviado.',
    details: tooLarge
      ? 'O backup excede o limite de 50 MB.'
      : invalidExtension
        ? undefined
        : 'O upload informado é inválido.'
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
