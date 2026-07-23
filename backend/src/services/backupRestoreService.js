const crypto = require('crypto');
const { promisify } = require('util');
const db = require('../config/database');
const { BACKUP_TABLES } = require('../config/backupTables');

const scryptAsync = promisify(crypto.scrypt);
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const REQUIRED_CORE_TABLES = ['users', 'groups', 'user_groups', 'clients', 'vault_items'];
const restoreOrder = [...BACKUP_TABLES];
const isEncryptedBackupFilename = (filename) => (
  typeof filename === 'string' && filename.toLowerCase().endsWith('.enc.json')
);

class BackupValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupValidationError';
    this.code = code;
  }
}

const failValidation = (code, message) => {
  throw new BackupValidationError(code, message);
};

const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const decodeBase64Field = (value, field, expectedLength, maxLength) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    failValidation('BACKUP_INVALID_ENVELOPE', `Campo ${field} inválido no envelope do backup.`);
  }

  const decoded = Buffer.from(value, 'base64');
  if (
    (expectedLength !== undefined && decoded.length !== expectedLength)
    || (maxLength !== undefined && decoded.length > maxLength)
  ) {
    failValidation('BACKUP_INVALID_ENVELOPE', `Campo ${field} inválido no envelope do backup.`);
  }
  return decoded;
};

const parseEncryptedBackupUpload = (fileBuffer) => {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0 || fileBuffer.length > MAX_BACKUP_BYTES) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'O arquivo de backup está vazio ou excede o limite de 50 MB.');
  }
  let envelope;
  try {
    envelope = JSON.parse(fileBuffer.toString('utf8'));
  } catch {
    failValidation('BACKUP_INVALID_JSON', 'O arquivo selecionado não é um JSON válido.');
  }

  return validateEncryptedBackupEnvelope(envelope);
};

const validateEncryptedBackupEnvelope = (envelope) => {
  if (!isPlainObject(envelope)) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'O conteúdo do arquivo não corresponde a um backup válido do FullPassword.');
  }
  if (envelope.format !== 'fullpassword-encrypted-backup' || envelope.version !== 1) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'O formato ou a versão do backup não é compatível com o FullPassword.');
  }
  if (typeof envelope.generated_at !== 'string' || Number.isNaN(Date.parse(envelope.generated_at))) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'A data de geração está ausente ou inválida no envelope do backup.');
  }
  if (!isPlainObject(envelope.kdf) || envelope.kdf.name !== 'scrypt') {
    failValidation('BACKUP_INVALID_ENVELOPE', 'A configuração de derivação de chave do backup é inválida.');
  }
  const params = envelope.kdf?.params;
  if (!isPlainObject(params) || params.N !== 32768 || params.r !== 8 || params.p !== 1 || params.keyLength !== 32) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'Os parâmetros de derivação de chave do backup são incompatíveis.');
  }
  if (!isPlainObject(envelope.cipher) || envelope.cipher.name !== 'aes-256-gcm') {
    failValidation('BACKUP_INVALID_ENVELOPE', 'A configuração de criptografia do backup é inválida.');
  }
  decodeBase64Field(envelope.kdf.salt, 'kdf.salt', 32);
  decodeBase64Field(envelope.cipher.iv, 'cipher.iv', 12);
  decodeBase64Field(envelope.cipher.tag, 'cipher.tag', 16);
  const ciphertext = decodeBase64Field(envelope.ciphertext, 'ciphertext', undefined, MAX_BACKUP_BYTES);
  if (ciphertext.length === 0) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'O envelope do backup não contém dados criptografados.');
  }
  return envelope;
};

const decryptBackupEnvelope = async (envelope, passphrase) => {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    failValidation('BACKUP_INVALID_PASSPHRASE', 'A frase de descriptografia deve ter ao menos 16 caracteres.');
  }

  const salt = Buffer.from(envelope.kdf.salt, 'base64');
  const iv = Buffer.from(envelope.cipher.iv, 'base64');
  const tag = Buffer.from(envelope.cipher.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  let plaintext;
  try {
    const key = await scryptAsync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    failValidation('BACKUP_INVALID_PASSPHRASE', 'Não foi possível descriptografar o backup. Verifique a frase informada.');
  }

  let payload;
  try {
    payload = JSON.parse(plaintext.toString('utf8'));
  } catch {
    failValidation('BACKUP_INVALID_ENVELOPE', 'O conteúdo descriptografado do backup não é um JSON válido.');
  }
  if (!isPlainObject(payload) || !isPlainObject(payload.metadata) || !isPlainObject(payload.data)) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'O conteúdo descriptografado não corresponde a um backup válido do FullPassword.');
  }
  if (payload.metadata.project !== 'FullPassword' || payload.metadata.type !== 'full-encrypted-backup') {
    failValidation('BACKUP_INVALID_ENVELOPE', 'A identificação interna do backup é incompatível com o FullPassword.');
  }
  if (payload.metadata.version !== undefined && payload.metadata.version !== 1) {
    failValidation('BACKUP_INVALID_ENVELOPE', 'A versão interna do backup é incompatível com o FullPassword.');
  }
  for (const table of REQUIRED_CORE_TABLES) {
    if (!Array.isArray(payload.data[table])) {
      failValidation('BACKUP_INVALID_ENVELOPE', `Tabela obrigatória ausente no backup: ${table}.`);
    }
  }
  for (const [table, rows] of Object.entries(payload.data)) {
    if (!restoreOrder.includes(table)) {
      failValidation('BACKUP_INVALID_ENVELOPE', `Tabela não suportada no backup: ${table}.`);
    }
    if (!Array.isArray(rows) || rows.some((row) => !isPlainObject(row))) {
      failValidation('BACKUP_INVALID_ENVELOPE', `Dados inválidos na tabela do backup: ${table}.`);
    }
  }
  return payload;
};

const parseAndDecryptBackup = async (fileBuffer, passphrase) => {
  const envelope = parseEncryptedBackupUpload(fileBuffer);
  const payload = await decryptBackupEnvelope(envelope, passphrase);
  return { envelope, payload };
};

const summarizeBackup = ({ envelope, payload }) => ({
  generated_at: payload.metadata.generated_at || envelope.generated_at || null,
  generated_by: payload.metadata.generated_by || null,
  version: envelope.version,
  tables: restoreOrder.filter((table) => Array.isArray(payload.data[table])).map((table) => ({ table, records: payload.data[table].length })),
  warnings: [
    'Sessões ativas não são restauradas; todos os usuários deverão autenticar novamente.',
    'Registros existentes nas tabelas incluídas serão substituídos pelos dados deste backup.',
    'Anexos atuais já estão incluídos nos campos criptografados do banco.'
  ]
});

const getInsertableColumns = async (client, table) => {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    [table]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const resetTableSequence = async (client, table, columns) => {
  if (!columns.has('id')) return;

  const sequence = await client.query('SELECT pg_get_serial_sequence($1, $2) AS name', [table, 'id']);
  if (!sequence.rows[0]?.name) return;

  await client.query(
    `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}))`,
    [sequence.rows[0].name]
  );
};

const createRestoreDatabaseError = (error, context) => {
  const restoreError = new Error('Falha ao gravar os dados do backup.', { cause: error });
  restoreError.name = 'BackupRestoreDatabaseError';
  restoreError.code = 'BACKUP_RESTORE_DATABASE_ERROR';
  restoreError.sqlCode = String(error?.code || '').slice(0, 10) || null;
  restoreError.constraint = String(error?.constraint || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120) || null;
  restoreError.restoreStage = context.stage;
  restoreError.restoreTable = context.table || null;
  restoreError.restoreRow = Number.isInteger(context.row) ? context.row : null;
  return restoreError;
};

const restoreBackupRecords = async (records, expectedCounts = null) => {
  let client;
  try {
    client = await db.pool.connect();
  } catch (error) {
    throw createRestoreDatabaseError(error, { stage: 'connect' });
  }

  const context = { stage: 'begin', table: null, row: null };
  const columnsByTable = new Map();
  const restoredCounts = Object.fromEntries(restoreOrder.map((table) => [table, 0]));
  let previousTableIndex = 0;
  try {
    await client.query('BEGIN');
    context.stage = 'constraints';
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    context.stage = 'delete';
    for (const table of [...restoreOrder].reverse()) {
      context.table = table;
      await client.query(`DELETE FROM ${table}`);
    }

    for await (const record of records) {
      const tableIndex = restoreOrder.indexOf(record?.table);
      if (
        tableIndex < 0
        || tableIndex < previousTableIndex
        || !record?.row
        || typeof record.row !== 'object'
        || Array.isArray(record.row)
      ) {
        const invalidRecordError = new Error('Registro ou ordem de restauração inválida.');
        invalidRecordError.code = 'BACKUP_INVALID_RESTORE_RECORD';
        throw invalidRecordError;
      }
      previousTableIndex = tableIndex;
      const table = record.table;
      context.table = table;
      restoredCounts[table] += 1;
      context.row = restoredCounts[table];
      let allowedColumns = columnsByTable.get(table);
      if (!allowedColumns) {
        context.stage = 'schema';
        allowedColumns = await getInsertableColumns(client, table);
        columnsByTable.set(table, allowedColumns);
      }
      context.stage = 'insert';
      const columns = Object.keys(record.row).filter((column) => allowedColumns.has(column));
      if (columns.length === 0) continue;
      const values = columns.map((column) => record.row[column]);
      const placeholders = columns.map((_, placeholderIndex) => `$${placeholderIndex + 1}`);
      await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
    }

    context.row = null;
    context.stage = 'verify';
    if (expectedCounts) {
      for (const table of restoreOrder) {
        if (
          Number.isSafeInteger(expectedCounts[table])
          && restoredCounts[table] !== expectedCounts[table]
        ) {
          context.table = table;
          const countError = new Error(`Contagem restaurada divergente para a tabela ${table}.`);
          countError.code = 'BACKUP_RESTORE_COUNT_MISMATCH';
          throw countError;
        }
      }
    }

    for (const table of restoreOrder) {
      context.table = table;
      context.stage = 'sequence';
      let allowedColumns = columnsByTable.get(table);
      if (!allowedColumns) {
        allowedColumns = await getInsertableColumns(client, table);
        columnsByTable.set(table, allowedColumns);
      }
      await resetTableSequence(client, table, allowedColumns);
    }
    context.table = 'password_policy_settings';
    context.stage = 'defaults';
    await client.query('INSERT INTO password_policy_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    context.table = 'login_security_policy';
    await client.query('INSERT INTO login_security_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    context.table = null;
    context.stage = 'commit';
    await client.query('COMMIT');
    return restoredCounts;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw createRestoreDatabaseError(error, context);
  } finally {
    client.release();
  }
};

const restoreBackupPayload = async (payload) => {
  async function* payloadRecords() {
    for (const table of restoreOrder) {
      const rows = payload.data[table];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) yield { table, row };
    }
  }

  const expectedCounts = Object.fromEntries(
    restoreOrder.map((table) => [table, Array.isArray(payload.data[table]) ? payload.data[table].length : 0])
  );
  return restoreBackupRecords(payloadRecords(), expectedCounts);
};

module.exports = {
  MAX_BACKUP_BYTES,
  isEncryptedBackupFilename,
  parseEncryptedBackupUpload,
  validateEncryptedBackupEnvelope,
  decryptBackupEnvelope,
  parseAndDecryptBackup,
  summarizeBackup,
  restoreBackupRecords,
  restoreBackupPayload
};
