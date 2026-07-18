const crypto = require('crypto');
const { promisify } = require('util');
const db = require('../config/database');
const { backupTables } = require('../controllers/systemController');

const scryptAsync = promisify(crypto.scrypt);
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const REQUIRED_CORE_TABLES = ['users', 'groups', 'user_groups', 'clients', 'vault_items'];
const restoreOrder = [...backupTables];

const assertPlainObject = (value, message) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
};

const parseAndDecryptBackup = async (fileBuffer, passphrase) => {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0 || fileBuffer.length > MAX_BACKUP_BYTES) throw new Error('Arquivo de backup vazio ou maior que 50 MB');
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw new Error('Frase de descriptografia inválida');

  let envelope;
  try {
    envelope = JSON.parse(fileBuffer.toString('utf8'));
  } catch {
    throw new Error('Arquivo de backup não contém JSON válido');
  }
  assertPlainObject(envelope, 'Envelope de backup inválido');
  if (envelope.format !== 'fullpassword-encrypted-backup' || envelope.version !== 1) throw new Error('Formato ou versão de backup incompatível');
  if (envelope.kdf?.name !== 'scrypt' || envelope.cipher?.name !== 'aes-256-gcm') throw new Error('Algoritmos do backup não são compatíveis');
  const params = envelope.kdf?.params;
  if (!params || params.N !== 32768 || params.r !== 8 || params.p !== 1 || params.keyLength !== 32) throw new Error('Parâmetros de derivação incompatíveis');

  try {
    const salt = Buffer.from(String(envelope.kdf.salt || ''), 'base64');
    const iv = Buffer.from(String(envelope.cipher.iv || ''), 'base64');
    const tag = Buffer.from(String(envelope.cipher.tag || ''), 'base64');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0 || ciphertext.length > MAX_BACKUP_BYTES) throw new Error('Campos criptográficos inválidos');
    const key = await scryptAsync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = JSON.parse(plaintext.toString('utf8'));
    assertPlainObject(payload, 'Conteúdo descriptografado inválido');
    assertPlainObject(payload.metadata, 'Metadata do backup ausente');
    assertPlainObject(payload.data, 'Dados do backup ausentes');
    if (payload.metadata.project !== 'FullPassword' || payload.metadata.type !== 'full-encrypted-backup') throw new Error('Metadata incompatível com FullPassword');
    if (payload.metadata.version !== undefined && payload.metadata.version !== 1) throw new Error('Versão da metadata incompatível');
    for (const table of REQUIRED_CORE_TABLES) if (!Array.isArray(payload.data[table])) throw new Error(`Tabela obrigatória ausente: ${table}`);
    for (const [table, rows] of Object.entries(payload.data)) {
      if (!restoreOrder.includes(table)) throw new Error(`Tabela não suportada no backup: ${table}`);
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`Dados inválidos na tabela: ${table}`);
    }
    return { envelope, payload };
  } catch (error) {
    if (/incompat|inválid|ausente|suportada/.test(error.message)) throw error;
    throw new Error('Não foi possível descriptografar o backup. Verifique a frase e a integridade do arquivo.');
  }
};

const summarizeBackup = ({ envelope, payload }) => ({
  generated_at: payload.metadata.generated_at || envelope.generated_at || null,
  generated_by: payload.metadata.generated_by || null,
  version: envelope.version,
  tables: restoreOrder.filter((table) => Array.isArray(payload.data[table])).map((table) => ({ table, records: payload.data[table].length })),
  warnings: ['Sessões ativas não são restauradas; todos os usuários deverão autenticar novamente.', 'Anexos atuais já estão incluídos nos campos criptografados do banco.']
});

const getInsertableColumns = async (client, table) => {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    [table]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const restoreBackupPayload = async (payload) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    for (const table of [...restoreOrder].reverse()) await client.query(`DELETE FROM ${table}`);

    for (const table of restoreOrder) {
      const rows = payload.data[table];
      if (!Array.isArray(rows)) continue;
      const allowedColumns = await getInsertableColumns(client, table);
      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => allowedColumns.has(column));
        if (columns.length === 0) continue;
        const values = columns.map((column) => row[column]);
        const placeholders = columns.map((_, index) => `$${index + 1}`);
        await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
      }
      const sequence = await client.query('SELECT pg_get_serial_sequence($1, $2) AS name', [table, 'id']);
      if (sequence.rows[0]?.name) {
        await client.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}))`, [sequence.rows[0].name]);
      }
    }
    await client.query('INSERT INTO password_policy_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query('INSERT INTO login_security_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { MAX_BACKUP_BYTES, parseAndDecryptBackup, summarizeBackup, restoreBackupPayload };
