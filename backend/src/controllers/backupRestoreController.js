const fs = require('fs/promises');
const path = require('path');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const { buildBackupPayload, encryptBackupPayload } = require('./systemController');
const { parseAndDecryptBackup, summarizeBackup, restoreBackupPayload } = require('../services/backupRestoreService');

const BACKUP_ARCHIVE_DIR = process.env.BACKUP_ARCHIVE_DIR || '/var/lib/fullpassword-backups';

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
      'BACKUP_RESTORE_INVALID_FILE',
      'O arquivo de backup não pôde ser processado.',
      'Selecione um arquivo .enc.json válido.'
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
    const details = getSafeErrorDetails(error, 'Arquivo de backup inválido ou incompatível.');
    await recordAuditEvent({ user: req.user, action: 'backup_restore_dry_run_failed', status: 'failed', req, metadata: { reason: 'validation_failed' } });
    console.warn('Validação de backup recusada.', { errorName: error?.name || 'Error', reason: details });
    return sendRestoreError(
      res,
      400,
      'BACKUP_RESTORE_INVALID_FILE',
      'O arquivo de backup não pôde ser validado.',
      details
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
    const details = getSafeErrorDetails(error, 'Arquivo de backup inválido ou incompatível.');
    await recordAuditEvent({ user: req.user, action: 'backup_restore_failed', status: 'failed', req, metadata: { reason: 'validation_failed' } });
    console.warn('Backup recusado antes da restauração.', { errorName: error?.name || 'Error', reason: details });
    return sendRestoreError(
      res,
      400,
      'BACKUP_RESTORE_INVALID_FILE',
      'O arquivo de backup não pôde ser restaurado.',
      details
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
    console.error('Falha transacional ao restaurar backup:', error.message);
    await recordAuditEvent({ user: req.user, action: 'backup_restore_failed', status: 'failed', req, metadata: { reason: 'transaction_failed' } });
    return sendRestoreError(
      res,
      500,
      'BACKUP_RESTORE_TRANSACTION_FAILED',
      'Não foi possível restaurar o backup.',
      'A transação foi revertida e o backup automático de segurança foi preservado.'
    );
  }
};

module.exports = { dryRun, restore };
