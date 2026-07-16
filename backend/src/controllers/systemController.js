const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const db = require('../config/database');
const { SUPER_ADMIN_EMAIL, normalizeRole, isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');

const UPDATER_REQUEST_DIR = process.env.UPDATER_REQUEST_DIR || '/var/lib/fullpassword-updater/requests';
const scryptAsync = promisify(crypto.scrypt);

const denyNonSuperAdmin = (res) => {
  return res.status(403).json({
    error: 'Acesso negado. Esta ação é permitida apenas para o Super Admin inicial.'
  });
};

const backupTables = [
  'users',
  'groups',
  'user_groups',
  'clients',
  'client_group_access',
  'client_key_shares',
  'vault_items',
  'vault_shares',
  'vault_access_audit'
];

const buildBackupPayload = async (generatedBy) => {
  const data = {};

  for (const table of backupTables) {
    const result = await db.query(`SELECT * FROM ${table}`);
    data[table] = result.rows;
  }

  return {
    metadata: {
      project: 'FullPassword',
      type: 'full-encrypted-backup',
      generated_at: new Date().toISOString(),
      generated_by: generatedBy || SUPER_ADMIN_EMAIL,
      super_admin_email: SUPER_ADMIN_EMAIL,
      warning: 'Este backup contém dados sensíveis do sistema, incluindo hashes, chaves envelopadas, chaves privadas criptografadas e cofres criptografados. As senhas dos cofres não são descriptografadas pelo servidor.'
    },
    data
  };
};

const encryptBackupPayload = async (payload, passphrase) => {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const params = { N: 32768, r: 8, p: 1, keyLength: 32 };
  const key = await scryptAsync(passphrase, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 64 * 1024 * 1024
  });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    format: 'fullpassword-encrypted-backup',
    version: 1,
    generated_at: payload.metadata.generated_at,
    kdf: {
      name: 'scrypt',
      salt: salt.toString('base64'),
      params
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64')
    },
    ciphertext: ciphertext.toString('base64')
  };
};

// GET /api/system/permissions - Informa permissões especiais do usuário autenticado
const getSystemPermissions = async (req, res) => {
  const isAdmin = normalizeRole(req.user?.role) === 'admin';
  const isSuper = isSuperAdmin(req.user);

  return res.status(200).json({
    can_manage_system: isSuper,
    is_admin: isAdmin,
    is_super_admin: isSuper,
    super_admin_email: SUPER_ADMIN_EMAIL,
    role: req.user?.role || null,
    email: req.user?.email || null
  });
};

// POST /api/system/update - Dispara a atualização do sistema pelo painel
const updateSystem = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      await recordAuditEvent({ user: req.user, action: 'system_update_request', status: 'denied', req });
      return denyNonSuperAdmin(res);
    }

    const requestId = crypto.randomUUID();
    const request = {
      request_id: requestId,
      requested_by_user_id: req.user.id,
      requested_by_email: req.user.email,
      requested_at: new Date().toISOString(),
      ip: req.ip || null,
      user_agent: String(req.get('user-agent') || '').slice(0, 1000) || null
    };

    await fs.mkdir(UPDATER_REQUEST_DIR, { recursive: true });
    const finalPath = path.join(UPDATER_REQUEST_DIR, `${requestId}.json`);
    const temporaryPath = `${finalPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(request), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporaryPath, finalPath);

    await recordAuditEvent({
      user: req.user,
      action: 'system_update_request',
      status: 'accepted',
      req,
      metadata: { request_id: requestId }
    });

    return res.status(202).json({
      message: 'Solicitação de atualização registrada. O sistema será atualizado em breve.',
      request_id: requestId,
      estimatedTime: 60
    });

  } catch (error) {
    console.error('Erro ao iniciar atualização:', error);
    await recordAuditEvent({ user: req.user, action: 'system_update_request', status: 'failed', req });
    return res.status(500).json({ error: 'Erro interno ao registrar solicitação de atualização' });
  }
};

// POST /api/system/backup - Exporta backup completo em envelope criptografado
const downloadBackup = async (req, res) => {
  await recordAuditEvent({ user: req.user, action: 'backup_export_attempt', status: 'attempt', req });

  try {
    if (!isSuperAdmin(req.user)) {
      await recordAuditEvent({ user: req.user, action: 'backup_export_denied', status: 'denied', req, metadata: { reason: 'not_super_admin' } });
      return denyNonSuperAdmin(res);
    }

    const { confirmation, passphrase } = req.body || {};
    if (confirmation !== 'EXPORTAR BACKUP') {
      await recordAuditEvent({ user: req.user, action: 'backup_export_denied', status: 'denied', req, metadata: { reason: 'invalid_confirmation' } });
      return res.status(400).json({ error: 'Digite exatamente EXPORTAR BACKUP para confirmar.' });
    }
    if (typeof passphrase !== 'string' || passphrase.length < 16) {
      await recordAuditEvent({ user: req.user, action: 'backup_export_denied', status: 'denied', req, metadata: { reason: 'invalid_passphrase_length' } });
      return res.status(400).json({ error: 'A frase de criptografia deve ter ao menos 16 caracteres.' });
    }

    const payload = await buildBackupPayload(req.user?.email);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const encryptedBackup = await encryptBackupPayload(payload, passphrase);
    const content = JSON.stringify(encryptedBackup, null, 2);

    await recordAuditEvent({
      user: req.user,
      action: 'backup_export_success',
      status: 'success',
      req,
      metadata: { format: 'fullpassword-encrypted-backup', version: 1 }
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fullpassword-${timestamp}.fullpassword-backup.enc.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(content);

  } catch (error) {
    console.error('Erro ao gerar backup:', error);
    await recordAuditEvent({ user: req.user, action: 'backup_export_failed', status: 'failed', req });
    return res.status(500).json({ error: 'Erro interno ao gerar backup criptografado' });
  }
};

const rejectLegacyBackupDownload = async (req, res) => {
  await recordAuditEvent({
    user: req.user,
    action: 'backup_export_denied',
    status: 'denied',
    req,
    metadata: { reason: 'legacy_get_method' }
  });
  return res.status(405).json({ error: 'Use POST /api/system/backup com confirmação e frase de criptografia.' });
};

module.exports = {
  getSystemPermissions,
  updateSystem,
  downloadBackup,
  rejectLegacyBackupDownload
};
