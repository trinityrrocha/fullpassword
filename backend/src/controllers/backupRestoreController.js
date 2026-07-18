const fs = require('fs/promises');
const path = require('path');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const { buildBackupPayload, encryptBackupPayload } = require('./systemController');
const { parseAndDecryptBackup, summarizeBackup, restoreBackupPayload } = require('../services/backupRestoreService');

const BACKUP_ARCHIVE_DIR = process.env.BACKUP_ARCHIVE_DIR || '/var/lib/fullpassword-backups';

const deny = async (req, res) => {
  await recordAuditEvent({ user: req.user, action: 'backup_restore_denied', status: 'denied', req, metadata: { reason: 'not_super_admin' } });
  return res.status(403).json({ error: 'Apenas o Super Admin pode restaurar backups' });
};

const requireUpload = (req, res) => {
  if (!req.file?.buffer) {
    res.status(400).json({ error: 'Selecione um arquivo .enc.json válido' });
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
    await recordAuditEvent({ user: req.user, action: 'backup_restore_dry_run_failed', status: 'failed', req, metadata: { reason: 'validation_failed' } });
    return res.status(400).json({ error: error.message });
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
    return res.status(400).json({ error: 'Digite exatamente RESTAURAR BACKUP para confirmar' });
  }

  let parsed;
  try {
    parsed = await parseAndDecryptBackup(req.file.buffer, req.body?.passphrase);
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'backup_restore_failed', status: 'failed', req, metadata: { reason: 'validation_failed' } });
    return res.status(400).json({ error: error.message });
  }

  let preRestoreFilename;
  try {
    preRestoreFilename = await createPreRestoreBackup(req, req.body.passphrase);
    await recordAuditEvent({ user: req.user, action: 'backup_pre_restore_export_success', status: 'success', req, metadata: { archive_created: true } });
  } catch (error) {
    console.error('Falha ao criar backup automático pré-restore:', error.message);
    await recordAuditEvent({ user: req.user, action: 'backup_pre_restore_export_failed', status: 'failed', req });
    return res.status(500).json({ error: 'Não foi possível criar o backup automático de segurança. A restauração foi cancelada.' });
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
    return res.status(500).json({ error: 'A restauração falhou e a transação foi revertida. O backup automático foi preservado.' });
  }
};

module.exports = { dryRun, restore };
