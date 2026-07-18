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
  'vault_access_audit',
  'user_mfa_settings',
  'user_mfa_recovery_codes',
  'password_policy_settings',
  'login_security_policy',
  'ip_security_rules',
  'system_audit_events'
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
      version: 1,
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

const parseAuditDate = (value, endOfDay = false) => {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getAuditEvents = async (req, res) => {
  if (!isSuperAdmin(req.user)) {
    await recordAuditEvent({
      user: req.user,
      action: 'audit_events_access',
      status: 'denied',
      req
    });
    return denyNonSuperAdmin(res);
  }

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const filters = {
    action: String(req.query.action || '').trim().slice(0, 100),
    status: String(req.query.status || '').trim().slice(0, 40),
    user_email: String(req.query.user_email || '').trim().slice(0, 320),
    date_from: String(req.query.date_from || '').trim(),
    date_to: String(req.query.date_to || '').trim()
  };
  const dateFrom = parseAuditDate(filters.date_from);
  const dateTo = parseAuditDate(filters.date_to, true);

  if ((filters.date_from && !dateFrom) || (filters.date_to && !dateTo)) {
    return res.status(400).json({ error: 'Filtro de data inválido.' });
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return res.status(400).json({ error: 'A data inicial não pode ser posterior à data final.' });
  }

  try {
    const conditions = [];
    const values = [];
    const addCondition = (sql, value) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };

    if (filters.action) addCondition('action = ?', filters.action);
    if (filters.status) addCondition('status = ?', filters.status);
    if (filters.user_email) addCondition('user_email ILIKE ?', `%${filters.user_email}%`);
    if (dateFrom) addCondition('created_at >= ?', dateFrom.toISOString());
    if (dateTo) addCondition('created_at <= ?', dateTo.toISOString());

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(
      `SELECT COUNT(*)::integer AS total FROM system_audit_events ${whereClause}`,
      values
    );
    const total = countResult.rows[0]?.total || 0;
    const offset = (page - 1) * limit;
    const eventsResult = await db.query(
      `SELECT id, user_id, user_email, action, status, ip_address, user_agent,
              CASE
                WHEN octet_length(metadata::text) > 16384 THEN jsonb_build_object('_truncated', TRUE)
                ELSE metadata
              END AS metadata,
              created_at
       FROM system_audit_events
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    await recordAuditEvent({
      user: req.user,
      action: 'audit_events_access',
      status: 'success',
      req,
      metadata: { filters, page, limit, result_count: eventsResult.rows.length }
    });

    return res.status(200).json({
      events: eventsResult.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Erro ao consultar eventos de auditoria:', error);
    await recordAuditEvent({ user: req.user, action: 'audit_events_access', status: 'failed', req });
    return res.status(500).json({ error: 'Erro interno ao consultar auditoria.' });
  }
};

module.exports = {
  getSystemPermissions,
  updateSystem,
  downloadBackup,
  rejectLegacyBackupDownload,
  getAuditEvents,
  backupTables,
  buildBackupPayload,
  encryptBackupPayload
};
