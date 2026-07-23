const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const path = require('path');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const { buildBackupPayload, encryptBackupPayload } = require('./systemController');
const {
  MAX_BACKUP_BYTES,
  parseAndDecryptBackup,
  summarizeBackup,
  restoreBackupPayload
} = require('../services/backupRestoreService');
const {
  createBackupPackageV2,
  inspectBackupPackageV2,
  restoreBackupPackageV2,
  cleanupBackupWorkspace,
  isBackupPackageV2Filename
} = require('../services/backupPackageV2Service');
const { BACKUP_TEMP_DIR } = require('../config/backupConfig');

const BACKUP_ARCHIVE_DIR = process.env.BACKUP_ARCHIVE_DIR || '/var/lib/fullpassword-backups';
const BACKUP_VALIDATION_CODES = new Set([
  'BACKUP_INVALID_JSON',
  'BACKUP_INVALID_ENVELOPE',
  'BACKUP_INVALID_PASSPHRASE'
]);

const sendRestoreError = (res, status, error, message, details) => {
  return res.status(status).json({
    error,
    message,
    ...(details ? { details } : {})
  });
};

const getSafeErrorDetails = (error, fallback) => {
  const details = String(error?.message || fallback || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 500);
  return details || fallback;
};

const getUploadMetadata = (file) => ({
  extension: path.extname(String(file?.originalname || '')).toLowerCase().slice(0, 20),
  size: Number(file?.size || 0),
  storedOnDisk: Boolean(file?.path)
});

const getBackupValidationResponse = (error, fallbackMessage) => {
  if (
    BACKUP_VALIDATION_CODES.has(error?.code)
    || String(error?.code || '').startsWith('BACKUP_V2_')
    || ['BACKUP_OPERATION_TIMEOUT', 'BACKUP_RESTORE_FILE_TOO_LARGE'].includes(error?.code)
  ) {
    return { error: error.code, message: error.message };
  }
  return {
    error: 'BACKUP_INVALID_ENVELOPE',
    message: fallbackMessage
  };
};

const getValidationStatus = (error) => {
  if (error?.code === 'BACKUP_OPERATION_TIMEOUT') return 408;
  if (error?.code === 'BACKUP_RESTORE_FILE_TOO_LARGE') return 413;
  return 400;
};

const getRestoreFailureResponse = (error) => {
  const stage = String(error?.restoreStage || 'unknown').replace(/[^a-z_-]/gi, '').slice(0, 40);
  const table = String(error?.restoreTable || '').replace(/[^a-z0-9_]/gi, '').slice(0, 80);
  const sqlCode = String(error?.sqlCode || '').replace(/[^a-z0-9]/gi, '').slice(0, 10);
  const constraint = String(error?.constraint || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, 120);
  const row = Number.isInteger(error?.restoreRow) ? error.restoreRow : null;
  const isConstraintError = sqlCode.startsWith('23');
  const location = [table ? `tabela ${table}` : '', row ? `registro ${row}` : ''].filter(Boolean).join(', ');
  const details = [
    `Falha na etapa ${stage}${location ? ` (${location})` : ''}.`,
    sqlCode ? `Código SQL: ${sqlCode}.` : '',
    constraint ? `Constraint: ${constraint}.` : '',
    'A transação foi revertida e o backup automático de segurança foi preservado.'
  ].filter(Boolean).join(' ');

  return {
    status: isConstraintError ? 409 : 500,
    error: isConstraintError ? 'BACKUP_RESTORE_CONSTRAINT_ERROR' : 'BACKUP_RESTORE_DATABASE_ERROR',
    message: isConstraintError
      ? 'Não foi possível restaurar o backup devido a uma restrição do banco de dados.'
      : 'Não foi possível gravar os dados do backup.',
    details,
    metadata: {
      reason: isConstraintError ? 'constraint_error' : 'database_error',
      stage,
      table: table || null,
      row,
      sql_code: sqlCode || null,
      constraint: constraint || null
    }
  };
};

const deny = async (req, res) => {
  await recordAuditEvent({
    user: req.user,
    action: 'backup_restore_denied',
    status: 'denied',
    req,
    metadata: { reason: 'not_super_admin' }
  });
  return sendRestoreError(
    res,
    403,
    'BACKUP_RESTORE_FORBIDDEN',
    'Você não possui permissão para restaurar backups.',
    'A restauração é permitida apenas para o Super Admin.'
  );
};

const requireUpload = (req, res) => {
  if (!req.file?.path) {
    sendRestoreError(
      res,
      400,
      'BACKUP_RESTORE_INVALID_UPLOAD',
      'Nenhum arquivo de backup foi recebido.',
      'Envie um arquivo .enc.json ou .zip no campo backup.'
    );
    return false;
  }
  return true;
};

const removeUploadedFile = async (file) => {
  if (!file?.path) return;
  const uploadRoot = path.resolve(BACKUP_TEMP_DIR, 'uploads');
  const uploadPath = path.resolve(file.path);
  if (!uploadPath.startsWith(`${uploadRoot}${path.sep}`)) return;
  await fs.rm(uploadPath, { force: true });
};

const readLegacyUpload = async (file) => {
  const stat = await fs.stat(file.path);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BACKUP_BYTES) {
    const error = new Error('O backup v1 está vazio ou excede o limite legado de 50 MB.');
    error.code = 'BACKUP_RESTORE_FILE_TOO_LARGE';
    throw error;
  }
  return fs.readFile(file.path);
};

const getUploadedBackupFormat = (file) => (
  isBackupPackageV2Filename(file?.originalname) ? 'v2' : 'v1'
);

const dryRun = async (req, res) => {
  let v2Inspection;
  try {
    await recordAuditEvent({
      user: req.user,
      action: 'backup_restore_dry_run_attempt',
      status: 'attempt',
      req
    });
    if (!isSuperAdmin(req.user)) return deny(req, res);
    if (!requireUpload(req, res)) return;

    const format = getUploadedBackupFormat(req.file);
    let summary;
    if (format === 'v2') {
      v2Inspection = await inspectBackupPackageV2(req.file.path, req.body?.passphrase);
      summary = v2Inspection.summary;
    } else {
      const parsed = await parseAndDecryptBackup(
        await readLegacyUpload(req.file),
        req.body?.passphrase
      );
      summary = summarizeBackup(parsed);
    }

    await recordAuditEvent({
      user: req.user,
      action: 'backup_restore_dry_run_success',
      status: 'success',
      req,
      metadata: {
        version: summary.version,
        parts: summary.parts || null,
        tables: summary.tables.map(({ table, records }) => ({ table, records }))
      }
    });
    return res.status(200).json(summary);
  } catch (error) {
    const response = getBackupValidationResponse(
      error,
      'O conteúdo do arquivo não corresponde a um backup válido do FullPassword.'
    );
    await recordAuditEvent({
      user: req.user,
      action: 'backup_restore_dry_run_failed',
      status: 'failed',
      req,
      metadata: { reason: 'validation_failed' }
    });
    console.warn('Validação de backup recusada.', {
      stage: 'dry-run',
      code: response.error,
      upload: getUploadMetadata(req.file),
      reason: getSafeErrorDetails(error, response.message)
    });
    return sendRestoreError(
      res,
      getValidationStatus(error),
      response.error,
      response.message
    );
  } finally {
    await cleanupBackupWorkspace(v2Inspection?.workspace).catch(() => {});
    await removeUploadedFile(req.file).catch(() => {});
  }
};

const createPreRestoreBackupV1 = async (req, passphrase) => {
  const payload = await buildBackupPayload(req.user.email);
  const encrypted = await encryptBackupPayload(payload, passphrase);
  await fs.mkdir(BACKUP_ARCHIVE_DIR, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `pre-restore-${timestamp}.fullpassword-backup.enc.json`;
  await fs.writeFile(
    path.join(BACKUP_ARCHIVE_DIR, filename),
    JSON.stringify(encrypted),
    { encoding: 'utf8', mode: 0o600, flag: 'wx' }
  );
  return filename;
};

const createPreRestoreBackupV2 = async (req, passphrase) => {
  let backupPackage;
  try {
    backupPackage = await createBackupPackageV2({
      generatedBy: req.user.email,
      passphrase
    });
    await fs.mkdir(BACKUP_ARCHIVE_DIR, { recursive: true, mode: 0o700 });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `pre-restore-${timestamp}.fullpassword-backup-v2.zip`;
    const destination = path.join(BACKUP_ARCHIVE_DIR, filename);
    await fs.copyFile(backupPackage.packagePath, destination, fsConstants.COPYFILE_EXCL);
    await fs.chmod(destination, 0o600);
    return filename;
  } finally {
    await cleanupBackupWorkspace(backupPackage?.workspace).catch(() => {});
  }
};

const restore = async (req, res) => {
  let parsed;
  let v2Inspection;

  try {
    await recordAuditEvent({
      user: req.user,
      action: 'backup_restore_attempt',
      status: 'attempt',
      req
    });
    if (!isSuperAdmin(req.user)) return deny(req, res);
    if (!requireUpload(req, res)) return;
    if (req.body?.confirmation !== 'RESTAURAR BACKUP') {
      await recordAuditEvent({
        user: req.user,
        action: 'backup_restore_denied',
        status: 'denied',
        req,
        metadata: { reason: 'invalid_confirmation' }
      });
      return sendRestoreError(
        res,
        400,
        'BACKUP_RESTORE_CONFIRMATION_REQUIRED',
        'A confirmação da restauração é inválida.',
        'Digite exatamente RESTAURAR BACKUP para confirmar.'
      );
    }

    const format = getUploadedBackupFormat(req.file);
    let summary;
    try {
      if (format === 'v2') {
        v2Inspection = await inspectBackupPackageV2(req.file.path, req.body?.passphrase);
        summary = v2Inspection.summary;
      } else {
        parsed = await parseAndDecryptBackup(
          await readLegacyUpload(req.file),
          req.body?.passphrase
        );
        summary = summarizeBackup(parsed);
      }
    } catch (error) {
      const response = getBackupValidationResponse(
        error,
        'O conteúdo do arquivo não corresponde a um backup válido do FullPassword.'
      );
      await recordAuditEvent({
        user: req.user,
        action: 'backup_restore_failed',
        status: 'failed',
        req,
        metadata: { reason: 'validation_failed' }
      });
      console.warn('Backup recusado antes da restauração.', {
        stage: 'restore',
        code: response.error,
        upload: getUploadMetadata(req.file),
        reason: getSafeErrorDetails(error, response.message)
      });
      return sendRestoreError(
        res,
        getValidationStatus(error),
        response.error,
        response.message
      );
    }

    let preRestoreFilename;
    try {
      preRestoreFilename = format === 'v2'
        ? await createPreRestoreBackupV2(req, req.body.passphrase)
        : await createPreRestoreBackupV1(req, req.body.passphrase);
      await recordAuditEvent({
        user: req.user,
        action: 'backup_pre_restore_export_success',
        status: 'success',
        req,
        metadata: { archive_created: true, version: summary.version }
      });
    } catch (error) {
      console.error('Falha ao criar backup automático pré-restore:', {
        code: String(error?.code || '').slice(0, 80) || null,
        name: error?.name || 'Error'
      });
      await recordAuditEvent({
        user: req.user,
        action: 'backup_pre_restore_export_failed',
        status: 'failed',
        req
      });
      return sendRestoreError(
        res,
        500,
        'BACKUP_RESTORE_SAFETY_BACKUP_FAILED',
        'A restauração foi cancelada antes de alterar os dados.',
        'Não foi possível criar o backup automático de segurança.'
      );
    }

    try {
      if (format === 'v2') {
        await restoreBackupPackageV2({
          packageContext: v2Inspection.packageContext,
          passphrase: req.body.passphrase
        });
      } else {
        await restoreBackupPayload(parsed.payload);
      }
    } catch (error) {
      const failure = getRestoreFailureResponse(error);
      console.error('Falha transacional ao restaurar backup.', failure.metadata);
      await recordAuditEvent({
        user: req.user,
        action: 'backup_restore_failed',
        status: 'failed',
        req,
        metadata: failure.metadata
      });
      return sendRestoreError(
        res,
        failure.status,
        failure.error,
        failure.message,
        failure.details
      );
    }

    await recordAuditEvent({
      userEmail: req.user.email,
      action: 'backup_restore_attempt',
      status: 'accepted',
      req,
      metadata: { recorded_after_restore: true }
    });
    await recordAuditEvent({
      userEmail: req.user.email,
      action: 'backup_pre_restore_export_success',
      status: 'success',
      req,
      metadata: { archive_created: true, recorded_after_restore: true }
    });
    await recordAuditEvent({
      userEmail: req.user.email,
      action: 'backup_restore_success',
      status: 'success',
      req,
      metadata: {
        version: summary.version,
        parts: summary.parts || null,
        pre_restore_archive_created: Boolean(preRestoreFilename)
      }
    });
    return res.status(200).json({
      message: 'Backup restaurado com sucesso. Faça login novamente.',
      summary,
      session_invalidated: true
    });
  } finally {
    await cleanupBackupWorkspace(v2Inspection?.workspace).catch(() => {});
    await removeUploadedFile(req.file).catch(() => {});
  }
};

module.exports = { dryRun, restore };
