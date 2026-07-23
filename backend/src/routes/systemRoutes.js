const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const systemController = require('../controllers/systemController');
const securityController = require('../controllers/securityController');
const sessionController = require('../controllers/sessionController');
const passwordPolicyController = require('../controllers/passwordPolicyController');
const backupRestoreController = require('../controllers/backupRestoreController');
const multer = require('multer');
const { verifyToken } = require('../middleware/authMiddleware');
const { isEncryptedBackupFilename } = require('../services/backupRestoreService');
const { isBackupPackageV2Filename } = require('../services/backupPackageV2Service');
const {
  BACKUP_MAX_UPLOAD_BYTES,
  BACKUP_MAX_UPLOAD_MB,
  BACKUP_RESTORE_TIMEOUT_MS,
  BACKUP_TEMP_DIR
} = require('../config/backupConfig');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const restoreUploadDirectory = path.join(BACKUP_TEMP_DIR, 'uploads');
fs.mkdirSync(restoreUploadDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(restoreUploadDirectory, 0o700);
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, restoreUploadDirectory),
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
  }),
  limits: { fileSize: BACKUP_MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (isEncryptedBackupFilename(file.originalname) || isBackupPackageV2Filename(file.originalname)) {
      return callback(null, true);
    }
    const error = new Error('A extensão do arquivo precisa ser .enc.json ou .zip.');
    error.code = 'BACKUP_INVALID_EXTENSION';
    console.warn('Upload de backup recusado.', {
      stage: 'upload',
      code: error.code
    });
    return callback(error);
  }
});
const receiveRestoreFile = (req, res, next) => {
  req.setTimeout(BACKUP_RESTORE_TIMEOUT_MS);
  res.setTimeout(BACKUP_RESTORE_TIMEOUT_MS);
  restoreUpload.single('backup')(req, res, (error) => {
    if (!error) {
      if (!req.file?.path) return next();
      fs.chmod(req.file.path, 0o600, (chmodError) => {
        if (!chmodError) return next();
        fs.rm(req.file.path, { force: true }, () => next(chmodError));
      });
      return;
    }
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const invalidExtension = error.code === 'BACKUP_INVALID_EXTENSION';
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? 'BACKUP_RESTORE_FILE_TOO_LARGE'
        : invalidExtension
          ? 'BACKUP_INVALID_EXTENSION'
          : 'BACKUP_RESTORE_INVALID_UPLOAD',
      message: invalidExtension
        ? 'A extensão do arquivo precisa ser .enc.json ou .zip.'
        : 'O arquivo de backup não pôde ser enviado.',
      details: tooLarge
        ? `O backup excede o limite configurado de ${BACKUP_MAX_UPLOAD_MB} MB.`
        : invalidExtension
          ? undefined
          : 'O upload informado é inválido.'
    });
  });
};

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
