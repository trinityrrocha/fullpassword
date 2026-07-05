const { exec } = require('child_process');
const db = require('../config/database');

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@admin.com.br';

const isSuperAdmin = (user) => {
  return user && user.role === 'admin' && user.email === SUPER_ADMIN_EMAIL;
};

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
  'vault_items',
  'vault_shares'
];

const escapeCsv = (value) => {
  if (value === null || value === undefined) return '';
  const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const buildBackupPayload = async () => {
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
      generated_by: SUPER_ADMIN_EMAIL,
      warning: 'Este backup contém dados sensíveis do sistema, incluindo hashes, chaves envelopadas e cofres criptografados. As senhas dos cofres não são descriptografadas pelo servidor.'
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

// POST /api/system/update - Dispara a atualização do sistema
const updateSystem = async (req, res) => {
  try {
    // Apenas o Super Admin inicial pode atualizar o sistema
    if (!isSuperAdmin(req.user)) {
      return denyNonSuperAdmin(res);
    }

    // Retorna a resposta imediatamente para o frontend
    res.status(200).json({
      message: 'Atualização iniciada. O sistema será reiniciado em breve.',
      estimatedTime: 30 // Segundos estimados para o frontend aguardar
    });

    // Executa o script de atualização em background (fire and forget)
    setTimeout(() => {
      console.log(`Iniciando WebUpdater pelo Super Admin ${req.user.email}...`);

      const updateCommand = `docker run --rm -d \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v /opt/fullpassword:/opt/fullpassword \
        -w /opt/fullpassword \
        fullpassword-backend \
        sh -c "sleep 3 && git config --global --add safe.directory /opt/fullpassword && git pull origin main && docker compose up -d --build"`;

      exec(updateCommand, (error, stdout, stderr) => {
        if (error) {
          console.error(`Erro na atualização: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`Stderr da atualização: ${stderr}`);
        }
        console.log(`Stdout da atualização: ${stdout}`);
      });
    }, 1000); // Aguarda 1 segundo para enviar a resposta antes de iniciar

  } catch (error) {
    console.error('Erro ao iniciar atualização:', error);
    res.status(500).json({ error: 'Erro interno ao iniciar atualização' });
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
    const payload = await buildBackupPayload();
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
  updateSystem,
  downloadBackup
};