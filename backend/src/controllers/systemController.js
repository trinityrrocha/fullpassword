const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const db = require('../config/database');
const { SUPER_ADMIN_EMAIL, normalizeRole, isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');

const UPDATER_REQUEST_DIR = process.env.UPDATER_REQUEST_DIR || '/var/lib/fullpassword-updater/requests';

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

const escapeCsv = (value) => {
  if (value === null || value === undefined) return '';
  const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

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

const renderBackupAsJson = (payload) => JSON.stringify(payload, null, 2);

const renderBackupAsTxt = (payload) => {
  const lines = [];
  lines.push('FULLPASSWORD - BACKUP COMPLETO');
  lines.push('================================');
  lines.push(`Gerado em: ${payload.metadata.generated_at}`);
  lines.push(`Gerado por: ${payload.metadata.generated_by}`);
  lines.push(`Super Admin: ${payload.metadata.super_admin_email}`);
  lines.push(`Tipo: ${payload.metadata.type}`);
  lines.push(`Aviso: ${payload.metadata.warning}`);
  lines.push('');

  for (const table of backupTables) {
    lines.push(`Tabela: ${table}`);
    lines.push('-'.repeat(80));
    lines.push(JSON.stringify(payload.data[table], null, 2));
    lines.push('');
  }

  return lines.join('\n');
};

const renderBackupAsCsv = (payload) => {
  const lines = ['table,row_index,payload_json'];

  for (const table of backupTables) {
    payload.data[table].forEach((row, index) => {
      lines.push([
        escapeCsv(table),
        escapeCsv(index + 1),
        escapeCsv(row)
      ].join(','));
    });
  }

  return lines.join('\n');
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

// GET /api/system/backup?format=json|txt|csv - Exporta backup completo criptografado
const downloadBackup = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return denyNonSuperAdmin(res);
    }

    const requestedFormat = String(req.query.format || 'json').toLowerCase();
    const allowedFormats = ['json', 'txt', 'csv'];
    const format = allowedFormats.includes(requestedFormat) ? requestedFormat : 'json';
    const payload = await buildBackupPayload(req.user?.email);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    let content;
    let contentType;

    if (format === 'txt') {
      content = renderBackupAsTxt(payload);
      contentType = 'text/plain; charset=utf-8';
    } else if (format === 'csv') {
      content = renderBackupAsCsv(payload);
      contentType = 'text/csv; charset=utf-8';
    } else {
      content = renderBackupAsJson(payload);
      contentType = 'application/json; charset=utf-8';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="fullpassword-backup-${timestamp}.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(content);

  } catch (error) {
    console.error('Erro ao gerar backup:', error);
    return res.status(500).json({ error: 'Erro interno ao gerar backup completo' });
  }
};

module.exports = {
  getSystemPermissions,
  updateSystem,
  downloadBackup
};
