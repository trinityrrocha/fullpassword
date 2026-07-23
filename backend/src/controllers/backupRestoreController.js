const fs = require('fs/promises');
const path = require('path');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const { buildBackupPayload, encryptBackupPayload } = require('./systemController');
const { parseAndDecryptBackup, summarizeBackup, restoreBackupPayload } = require('../services/backupRestoreService');

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
  originalname: String(file?.originalname || '').slice(0, 255),
  mimetype: String(file?.mimetype || '').slice(0, 100),
  size: Number(file?.size || 0),
  hasBuffer: Buffer.isBuffer(file?.buffer)
});

const getBackupValidationResponse = (error, fallbackMessage) => {
  if (BACKUP_VALIDATION_CODES.has(error?.code)) {
    return { error: error.code, message: error.message };
  }
  return {
    error: 'BACKUP_INVALID_ENVELOPE',
    message: fallbackMessage
  };
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
  await recordAuditEvent({ user: req.user, action: 'backup_restore_denied', status: 'denied', req, metadata: { reason: 'not_super_admin' } });
  return sendRestoreError(
    res,
    403,
    'BACKUP_RESTORE_FORBIDDEN',
    'Você não possui permissão para restaurar backups.',
    'A restauração é permitida apenas para o Super Admin.'
  );
};

const requireUpload = (req, res) => {
  if (!req.file?.buffer) {
    sendRestoreError(
      res,
      400,
      'BACKUP_RESTORE_INVALID_UPLOAD',
      'Nenhum arquivo de backup foi recebido.',
      'Envie um arquivo .enc.json no campo backup.'
    );
    return false;
  }
  return true;
};

const dryRun = async (req, res) => {
  await recordAuditEvent({ user: req.user, action: 'backup_restore_dry_run_attempt', status: 'attempt', req });
  if (!isSuperAdmin(req.user)) return deny(req, res);
  if (!requireUpload(req, res)) return;
  try {
    const parsed = await parseAndDecryptBackup(req.file.buffer, req.body?.passphrase);
    const summary = summarizeBackup(parsed);
    await recordAuditEvent({
      user: req.user, action: 'backup_restore_dry_run_success', status: 'success', req,
      metadata: { version: summary.version, tables: summary.tables.map(({ table, records }) => ({ table, records })) }
    });
    return res.status(200).json(summary);
  } catch (error) {
    const response = getBackupValidationResponse(
      error,
      'O conteúdo do arquivo não corresponde a um backup válido do FullPassword.'
    );
    await recordAuditEvent({ user: req.user, action: 'backup_restore_dry_run_failed', status: 'failed', req, metadata: { reason: 'validation_failed' } });
    console.warn('Validação de backup recusada.', {
      stage: 'dry-run',
      code: response.error,
      upload: getUploadMetadata(req.file),
      reason: getSafeErrorDetails(error, response.message)
    });
    return sendRestoreError(
      res,
      400,
      response.error,
      response.message
    );
  }
};

const createPreRestoreBackup = async (req, passphrase) => {
  const payload = await buildBackupPayload(req.user.email);
  const encrypted = await encryptBackupPayload(payload, passphrase);
  await fs.mkdir(BACKUP_ARCHIVE_DIR, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `pre-restore-${timestamp}.fullpassword-backup.enc.json`;
  await fs.writeFile(path.join(BACKUP_ARCHIVE_DIR, filename), JSON.stringify(encrypted), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return filename;
};

const restore = async (req, res) => {
  await recordAuditEvent({ user: req.user, action: 'backup_restore_attempt', status: 'attempt', req });
  if (!isSuperAdmin(req.user)) return deny(req, res);
  if (!requireUpload(req, res)) return;
  if (req.body?.confirmation !== 'RESTAURAR BACKUP') {
    await recordAuditEvent({ user: req.user, action: 'backup_restore_denied', status: 'denied', req, metadata: { reason: 'invalid_confirmation' } });
    return sendRestoreError(
      res,
      400,
      'BACKUP_RESTORE_CONFIRMATION_REQUIRED',
      'A confirmação da restauração é inválida.',
      'Digite exatamente RESTAURAR BACKUP para confirmar.'
    );
  }

  let parsed;
  try {
    parsed = await parseAndDecryptBackup(req.file.buffer, req.body?.passphrase);
  } catch (error) {
    const response = getBackupValidationResponse(
      error,
      'O conteúdo do arquivo não corresponde a um backup válido do FullPassword.'
    );
    await recordAuditEvent({ user: req.user, action: 'backup_restore_failed', status: 'failed', req, metadata: { reason: 'validation_failed' } });
    console.warn('Backup recusado antes da restauração.', {
      stage: 'restore',
      code: response.error,
      upload: getUploadMetadata(req.file),
      reason: getSafeErrorDetails(error, response.message)
    });
    return sendRestoreError(
      res,
      400,
      response.error,
      response.message
    );
  }

  let preRestoreFilename;
  try {
    preRestoreFilename = await createPreRestoreBackup(req, req.body.passphrase);
    await recordAuditEvent({ user: req.user, action: 'backup_pre_restore_export_success', status: 'success', req, metadata: { archive_created: true } });
  } catch (error) {
    console.error('Falha ao criar backup automático pré-restore:', error.message);
    await recordAuditEvent({ user: req.user, action: 'backup_pre_restore_export_failed', status: 'failed', req });
    return sendRestoreError(
      res,
      500,
      'BACKUP_RESTORE_SAFETY_BACKUP_FAILED',
      'A restauração foi cancelada antes de alterar os dados.',
      'Não foi possível criar o backup automático de segurança.'
    );
  }

  try {
    const summary = summarizeBackup(parsed);
    await restoreBackupPayload(parsed.payload);
    await recordAuditEvent({
      userEmail: req.user.email, action: 'backup_restore_attempt', status: 'accepted', req,
      metadata: { recorded_after_restore: true }
    });
    await recordAuditEvent({
      userEmail: req.user.email, action: 'backup_pre_restore_export_success', status: 'success', req,
      metadata: { archive_created: true, recorded_after_restore: true }
    });
    await recordAuditEvent({
      userEmail: req.user.email, action: 'backup_restore_success', status: 'success', req,
      metadata: { version: summary.version, pre_restore_archive_created: Boolean(preRestoreFilename) }
    });
    return res.status(200).json({ message: 'Backup restaurado com sucesso. Faça login novamente.', summary, session_invalidated: true });
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
};

module.exports = { dryRun, restore };
