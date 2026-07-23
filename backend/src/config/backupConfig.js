const os = require('os');
const path = require('path');

const readInteger = (name, fallback, minimum, maximum) => {
  const rawValue = String(process.env[name] || '').trim();
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
};

const BACKUP_CHUNK_SIZE_MB = readInteger('BACKUP_CHUNK_SIZE_MB', 50, 1, 512);
const BACKUP_MAX_UPLOAD_MB = readInteger('BACKUP_MAX_UPLOAD_MB', 2048, 1, 10240);
const BACKUP_RESTORE_TIMEOUT_MS = readInteger('BACKUP_RESTORE_TIMEOUT_MS', 1800000, 60000, 14400000);
const BACKUP_TEMP_DIR = path.resolve(
  process.env.BACKUP_TEMP_DIR || path.join(os.tmpdir(), 'fullpassword-backups')
);

module.exports = {
  BACKUP_CHUNK_SIZE_MB,
  BACKUP_CHUNK_SIZE_BYTES: BACKUP_CHUNK_SIZE_MB * 1024 * 1024,
  BACKUP_MAX_UPLOAD_MB,
  BACKUP_MAX_UPLOAD_BYTES: BACKUP_MAX_UPLOAD_MB * 1024 * 1024,
  BACKUP_RESTORE_TIMEOUT_MS,
  BACKUP_TEMP_DIR,
  BACKUP_MANIFEST_MAX_BYTES: 2 * 1024 * 1024,
  BACKUP_CHECKSUMS_MAX_BYTES: 8 * 1024 * 1024,
  BACKUP_MAX_PACKAGE_ENTRIES: Math.ceil(
    (BACKUP_MAX_UPLOAD_MB * 1024 * 1024) / (1024 * 1024)
  ) + 2
};
