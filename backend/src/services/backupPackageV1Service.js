const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const db = require('../config/database');
const { SUPER_ADMIN_EMAIL } = require('../config/security');
const { BACKUP_TABLES } = require('../config/backupTables');
const { BACKUP_TEMP_DIR } = require('../config/backupConfig');

const scryptAsync = promisify(crypto.scrypt);

const buildBackupPayload = async (generatedBy, queryable = db) => {
  const data = {};
  for (const table of BACKUP_TABLES) {
    const result = await queryable.query(`SELECT * FROM ${table}`);
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

const buildBackupFilenameV1 = (date = new Date()) => {
  const compact = date.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return `fullpassword-backup-v1-${compact}.enc.json`;
};

const createBackupPackageV1 = async ({ generatedBy, passphrase, queryable = db }) => {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    const error = new Error('A frase de criptografia deve ter ao menos 16 caracteres.');
    error.code = 'BACKUP_INVALID_PASSPHRASE';
    throw error;
  }
  await fs.mkdir(BACKUP_TEMP_DIR, { recursive: true, mode: 0o700 });
  const workspace = await fs.mkdtemp(path.join(BACKUP_TEMP_DIR, 'cloud-v1-'));
  await fs.chmod(workspace, 0o700);
  const filename = buildBackupFilenameV1();
  const packagePath = path.join(workspace, filename);
  try {
    const payload = await buildBackupPayload(generatedBy, queryable);
    const envelope = await encryptBackupPayload(payload, passphrase);
    await fs.writeFile(packagePath, JSON.stringify(envelope), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    return {
      workspace,
      packagePath,
      filename,
      contentType: 'application/json',
      backupFormat: 'v1'
    };
  } catch (error) {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
};

module.exports = {
  buildBackupPayload,
  encryptBackupPayload,
  buildBackupFilenameV1,
  createBackupPackageV1
};
