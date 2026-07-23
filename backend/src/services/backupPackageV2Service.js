const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { once } = require('events');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const archiver = require('archiver');
const yauzl = require('yauzl');
const QueryStream = require('pg-query-stream');
const db = require('../config/database');
const { BACKUP_TABLES } = require('../config/backupTables');
const {
  BACKUP_CHUNK_SIZE_BYTES,
  BACKUP_CHUNK_SIZE_MB,
  BACKUP_MAX_UPLOAD_BYTES,
  BACKUP_RESTORE_TIMEOUT_MS,
  BACKUP_TEMP_DIR,
  BACKUP_MANIFEST_MAX_BYTES,
  BACKUP_CHECKSUMS_MAX_BYTES,
  BACKUP_MAX_PACKAGE_ENTRIES
} = require('../config/backupConfig');
const { restoreBackupRecords } = require('./backupRestoreService');

const scryptAsync = promisify(crypto.scrypt);
const openZipAsync = promisify(yauzl.open);
const KDF_PARAMS = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32 });
const MANIFEST_FORMAT = 'fullpassword-backup-package';
const MANIFEST_VERSION = 2;
const MANIFEST_AUTH_INFO = Buffer.from('fullpassword-backup-v2-manifest', 'utf8');
const DATABASE_PART_PATTERN = /^database\/database-(\d{5})\.enc$/;
const ATTACHMENT_PART_PATTERN = /^attachments\/attachments-(\d{5})\.enc$/;
const METADATA_ENTRIES = new Set(['manifest.json', 'checksums/checksums.sha256']);

class BackupPackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupPackageError';
    this.code = code;
  }
}

const failPackage = (code, message) => {
  throw new BackupPackageError(code, message);
};

const ensureDeadline = (deadline) => {
  if (Date.now() > deadline) {
    failPackage('BACKUP_OPERATION_TIMEOUT', 'A operação de backup excedeu o tempo máximo configurado.');
  }
};

const writeWithBackpressure = async (stream, buffer) => {
  if (!buffer?.length) return;
  if (!stream.write(buffer)) await once(stream, 'drain');
};

const deriveKey = async (passphrase, salt) => {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    failPackage('BACKUP_INVALID_PASSPHRASE', 'A frase de criptografia deve ter ao menos 16 caracteres.');
  }
  return scryptAsync(passphrase, salt, KDF_PARAMS.keyLength, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
    maxmem: 64 * 1024 * 1024
  });
};

const getManifestAuthKey = (key, salt) => Buffer.from(
  crypto.hkdfSync('sha256', key, salt, MANIFEST_AUTH_INFO, 32)
);

const createWorkspace = async (prefix) => {
  await fsp.mkdir(BACKUP_TEMP_DIR, { recursive: true, mode: 0o700 });
  await fsp.chmod(BACKUP_TEMP_DIR, 0o700).catch(() => {});
  const workspace = await fsp.mkdtemp(path.join(BACKUP_TEMP_DIR, `${prefix}-`));
  await fsp.chmod(workspace, 0o700);
  return workspace;
};

const cleanupBackupWorkspace = async (workspace) => {
  if (!workspace) return;
  const resolvedRoot = path.resolve(BACKUP_TEMP_DIR);
  const resolvedWorkspace = path.resolve(workspace);
  if (!resolvedWorkspace.startsWith(`${resolvedRoot}${path.sep}`)) return;
  await fsp.rm(resolvedWorkspace, { recursive: true, force: true });
};

class EncryptedPartWriter {
  constructor({ workspace, key, deadline }) {
    this.workspace = workspace;
    this.key = key;
    this.deadline = deadline;
    this.parts = [];
    this.current = null;
    this.nextIndex = 1;
  }

  async openPart() {
    ensureDeadline(this.deadline);
    const index = this.nextIndex;
    this.nextIndex += 1;
    const name = `database/database-${String(index).padStart(5, '0')}.enc`;
    const filePath = path.join(this.workspace, ...name.split('/'));
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(name, 'utf8'));
    this.current = {
      index,
      name,
      filePath,
      iv,
      cipher,
      hash: crypto.createHash('sha256'),
      stream: fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
      plaintextBytes: 0,
      encryptedBytes: 0
    };
  }

  async writeEncrypted(buffer) {
    if (!buffer?.length) return;
    this.current.hash.update(buffer);
    this.current.encryptedBytes += buffer.length;
    await writeWithBackpressure(this.current.stream, buffer);
  }

  async write(buffer) {
    let offset = 0;
    while (offset < buffer.length) {
      ensureDeadline(this.deadline);
      if (!this.current) await this.openPart();
      const remaining = BACKUP_CHUNK_SIZE_BYTES - this.current.plaintextBytes;
      const length = Math.min(remaining, buffer.length - offset);
      const plaintext = buffer.subarray(offset, offset + length);
      this.current.plaintextBytes += plaintext.length;
      await this.writeEncrypted(this.current.cipher.update(plaintext));
      offset += length;
      if (this.current.plaintextBytes >= BACKUP_CHUNK_SIZE_BYTES) await this.closePart();
    }
  }

  async closePart() {
    if (!this.current) return;
    const part = this.current;
    await this.writeEncrypted(part.cipher.final());
    const tag = part.cipher.getAuthTag();
    part.stream.end();
    await once(part.stream, 'finish');
    this.parts.push({
      name: part.name,
      type: 'database',
      index: part.index,
      size: part.encryptedBytes,
      plaintext_size: part.plaintextBytes,
      sha256: part.hash.digest('hex'),
      iv: part.iv.toString('base64'),
      tag: tag.toString('base64')
    });
    this.current = null;
  }

  async finalize() {
    if (!this.current && this.parts.length === 0) await this.openPart();
    await this.closePart();
    return this.parts;
  }

  async abort() {
    if (!this.current?.stream) return;
    const stream = this.current.stream;
    this.current = null;
    stream.destroy();
    if (!stream.closed) await once(stream, 'close').catch(() => {});
  }
}

const createZipPackage = async (workspace, parts) => {
  const packagePath = path.join(workspace, 'fullpassword-backup-v2.zip');
  const output = fs.createWriteStream(packagePath, { flags: 'wx', mode: 0o600 });
  const archive = archiver('zip', { forceZip64: true, store: true, zlib: { level: 0 } });
  const completed = new Promise((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
    archive.once('warning', reject);
  });

  archive.pipe(output);
  archive.file(path.join(workspace, 'manifest.json'), { name: 'manifest.json', store: true });
  archive.file(path.join(workspace, 'checksums', 'checksums.sha256'), {
    name: 'checksums/checksums.sha256',
    store: true
  });
  parts.forEach((part) => archive.file(part.filePath || path.join(workspace, ...part.name.split('/')), {
    name: part.name,
    store: true
  }));
  await archive.finalize();
  await completed;
  return packagePath;
};

const createBackupPackageV2 = async ({ generatedBy, passphrase }) => {
  const workspace = await createWorkspace('export-v2');
  const deadline = Date.now() + BACKUP_RESTORE_TIMEOUT_MS;
  const salt = crypto.randomBytes(32);
  let key;
  let client;

  try {
    key = await deriveKey(passphrase, salt);
    client = await db.pool.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const writer = new EncryptedPartWriter({ workspace, key, deadline });
    const summary = {};
    let attachmentCount = 0;
    let totalAttachmentBytes = 0;

    try {
      for (const table of BACKUP_TABLES) {
        ensureDeadline(deadline);
        let count = 0;
        const queryStream = new QueryStream(`SELECT * FROM ${table}`, [], { batchSize: 100, highWaterMark: 100 });
        const rows = client.query(queryStream);
        for await (const row of rows) {
          ensureDeadline(deadline);
          count += 1;
          if (table === 'vault_items' && row.encrypted_attachment) {
            attachmentCount += 1;
            totalAttachmentBytes += Buffer.byteLength(String(row.encrypted_attachment), 'utf8');
          }
          await writer.write(Buffer.from(`${JSON.stringify({ table, row })}\n`, 'utf8'));
        }
        summary[table] = count;
      }
      await client.query('COMMIT');
    } catch (error) {
      await writer.abort();
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
      client = null;
    }

    const parts = await writer.finalize();
    const generatedAt = new Date().toISOString();
    const manifestCore = {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      generated_at: generatedAt,
      generated_by: String(generatedBy || '').slice(0, 255) || null,
      app: 'FullPassword',
      kdf: {
        name: 'scrypt',
        salt: salt.toString('base64'),
        params: { ...KDF_PARAMS }
      },
      cipher: {
        name: 'aes-256-gcm',
        aad: 'part-name'
      },
      storage: {
        attachments: 'embedded-encrypted-vault-items',
        database_encoding: 'ndjson',
        chunk_size_bytes: BACKUP_CHUNK_SIZE_BYTES
      },
      parts,
      summary: {
        ...summary,
        attachments: attachmentCount,
        total_attachment_bytes: totalAttachmentBytes,
        parts: parts.length,
        total_bytes: parts.reduce((total, part) => total + part.size, 0)
      }
    };
    const authKey = getManifestAuthKey(key, salt);
    const manifest = {
      ...manifestCore,
      auth: {
        name: 'hmac-sha256',
        value: crypto.createHmac('sha256', authKey).update(JSON.stringify(manifestCore)).digest('hex')
      }
    };
    authKey.fill(0);

    await fsp.writeFile(
      path.join(workspace, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    );
    const checksumDirectory = path.join(workspace, 'checksums');
    await fsp.mkdir(checksumDirectory, { recursive: true, mode: 0o700 });
    await fsp.writeFile(
      path.join(checksumDirectory, 'checksums.sha256'),
      `${parts.map((part) => `${part.sha256}  ${part.name}`).join('\n')}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    );
    const packagePath = await createZipPackage(workspace, parts);
    const timestamp = generatedAt.replace(/[:.]/g, '-');
    return {
      workspace,
      packagePath,
      filename: `fullpassword-${timestamp}.fullpassword-backup-v2.zip`,
      manifest
    };
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await cleanupBackupWorkspace(workspace);
    throw error;
  } finally {
    if (key) key.fill(0);
  }
};

const isSafeEntryName = (name) => {
  if (
    typeof name !== 'string'
    || !name
    || name.includes('\\')
    || name.includes('\0')
    || name.startsWith('/')
    || path.posix.normalize(name) !== name
    || name.split('/').includes('..')
  ) return false;
  return true;
};

const isAllowedEntryName = (name) => (
  METADATA_ENTRIES.has(name)
  || DATABASE_PART_PATTERN.test(name)
  || ATTACHMENT_PART_PATTERN.test(name)
  || ['database/', 'attachments/', 'checksums/'].includes(name)
);

const extractPackage = async (packagePath, workspace) => {
  const extractDirectory = path.join(workspace, 'extracted');
  await fsp.mkdir(extractDirectory, { recursive: true, mode: 0o700 });
  const zip = await openZipAsync(packagePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true });
  const extractedEntries = new Set();
  let entryCount = 0;
  let extractedBytes = 0;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      zip.close();
      if (error) reject(error);
      else resolve();
    };

    zip.once('error', finish);
    zip.once('end', () => finish());
    zip.on('entry', (entry) => {
      (async () => {
        entryCount += 1;
        if (entryCount > BACKUP_MAX_PACKAGE_ENTRIES) {
          failPackage('BACKUP_V2_TOO_MANY_ENTRIES', 'O pacote contém arquivos internos demais.');
        }
        const name = entry.fileName;
        if (!isSafeEntryName(name) || !isAllowedEntryName(name)) {
          failPackage('BACKUP_V2_UNSAFE_ENTRY', 'O pacote contém um caminho interno inválido ou não permitido.');
        }
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) {
          failPackage('BACKUP_V2_UNSAFE_ENTRY', 'Links simbólicos não são permitidos no pacote de backup.');
        }
        if (name.endsWith('/')) {
          zip.readEntry();
          return;
        }
        if (
          !Number.isSafeInteger(entry.uncompressedSize)
          || entry.uncompressedSize < 0
          || entry.compressionMethod !== 0
        ) {
          failPackage('BACKUP_V2_UNSAFE_ENTRY', 'O pacote contém uma entrada comprimida ou com tamanho inválido.');
        }
        if (extractedEntries.has(name)) {
          failPackage('BACKUP_V2_DUPLICATE_ENTRY', `Entrada duplicada no pacote: ${name}.`);
        }
        extractedEntries.add(name);
        if (name === 'manifest.json' && entry.uncompressedSize > BACKUP_MANIFEST_MAX_BYTES) {
          failPackage('BACKUP_V2_INVALID_MANIFEST', 'O manifesto excede o tamanho máximo permitido.');
        }
        if (name === 'checksums/checksums.sha256' && entry.uncompressedSize > BACKUP_CHECKSUMS_MAX_BYTES) {
          failPackage('BACKUP_V2_INVALID_CHECKSUMS', 'A lista de checksums excede o tamanho máximo permitido.');
        }
        extractedBytes += entry.uncompressedSize;
        if (extractedBytes > BACKUP_MAX_UPLOAD_BYTES) {
          failPackage('BACKUP_RESTORE_FILE_TOO_LARGE', 'O conteúdo extraído excede o limite configurado.');
        }

        const destination = path.resolve(extractDirectory, ...name.split('/'));
        if (!destination.startsWith(`${path.resolve(extractDirectory)}${path.sep}`)) {
          failPackage('BACKUP_V2_UNSAFE_ENTRY', 'O pacote tentou gravar fora do diretório temporário.');
        }
        await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const readStream = await new Promise((resolveStream, rejectStream) => {
          zip.openReadStream(entry, (error, stream) => error ? rejectStream(error) : resolveStream(stream));
        });
        let actualBytes = 0;
        const limiter = new Transform({
          transform(chunk, _encoding, callback) {
            actualBytes += chunk.length;
            if (actualBytes > entry.uncompressedSize || extractedBytes - entry.uncompressedSize + actualBytes > BACKUP_MAX_UPLOAD_BYTES) {
              callback(new BackupPackageError('BACKUP_RESTORE_FILE_TOO_LARGE', 'O conteúdo extraído excede o limite configurado.'));
              return;
            }
            callback(null, chunk);
          }
        });
        await pipeline(readStream, limiter, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
        zip.readEntry();
      })().catch(finish);
    });
    zip.readEntry();
  });

  return { extractDirectory, extractedEntries };
};

const readLimitedTextFile = async (filePath, maximumBytes, code, message) => {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > maximumBytes) failPackage(code, message);
  return fsp.readFile(filePath, 'utf8');
};

const decodeBase64 = (value, expectedBytes, code, message) => {
  if (
    typeof value !== 'string'
    || !value
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) failPackage(code, message);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedBytes) failPackage(code, message);
  return decoded;
};

const hashFile = async (filePath) => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const validatePartOrdering = (parts, type, pattern) => {
  const selected = parts.filter((part) => part.type === type).sort((left, right) => left.index - right.index);
  selected.forEach((part, index) => {
    const match = pattern.exec(part.name);
    if (!match || part.index !== index + 1 || Number(match[1]) !== part.index) {
      failPackage('BACKUP_V2_INVALID_MANIFEST', `A sequência de partes ${type} é inválida.`);
    }
  });
  return selected;
};

const validateManifest = async ({ extractDirectory, extractedEntries }, passphrase, deadline) => {
  ensureDeadline(deadline);
  const manifestText = await readLimitedTextFile(
    path.join(extractDirectory, 'manifest.json'),
    BACKUP_MANIFEST_MAX_BYTES,
    'BACKUP_V2_INVALID_MANIFEST',
    'O pacote não contém um manifesto válido.'
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    failPackage('BACKUP_V2_INVALID_MANIFEST', 'O manifest.json não contém JSON válido.');
  }
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || manifest.format !== MANIFEST_FORMAT
    || manifest.version !== MANIFEST_VERSION
    || manifest.app !== 'FullPassword'
    || typeof manifest.generated_at !== 'string'
    || Number.isNaN(Date.parse(manifest.generated_at))
  ) failPackage('BACKUP_V2_INVALID_MANIFEST', 'O manifesto não corresponde a um backup v2 válido do FullPassword.');
  if (
    manifest.kdf?.name !== 'scrypt'
    || manifest.kdf?.params?.N !== KDF_PARAMS.N
    || manifest.kdf?.params?.r !== KDF_PARAMS.r
    || manifest.kdf?.params?.p !== KDF_PARAMS.p
    || manifest.kdf?.params?.keyLength !== KDF_PARAMS.keyLength
    || manifest.cipher?.name !== 'aes-256-gcm'
    || manifest.cipher?.aad !== 'part-name'
    || manifest.storage?.attachments !== 'embedded-encrypted-vault-items'
    || manifest.storage?.database_encoding !== 'ndjson'
    || !Number.isSafeInteger(manifest.storage?.chunk_size_bytes)
    || manifest.storage.chunk_size_bytes < 1024 * 1024
    || manifest.storage.chunk_size_bytes > 512 * 1024 * 1024
    || manifest.auth?.name !== 'hmac-sha256'
    || !/^[0-9a-f]{64}$/i.test(String(manifest.auth?.value || ''))
  ) failPackage('BACKUP_V2_INVALID_MANIFEST', 'Os algoritmos ou parâmetros do manifesto são incompatíveis.');
  const salt = decodeBase64(
    manifest.kdf.salt,
    32,
    'BACKUP_V2_INVALID_MANIFEST',
    'O salt do manifesto é inválido.'
  );
  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0 || manifest.parts.length > BACKUP_MAX_PACKAGE_ENTRIES - 2) {
    failPackage('BACKUP_V2_INVALID_MANIFEST', 'A lista de partes do manifesto é inválida.');
  }
  const partNames = new Set();
  const partIvs = new Set();
  for (const part of manifest.parts) {
    if (
      !part
      || typeof part !== 'object'
      || Array.isArray(part)
      || !['database', 'attachments'].includes(part.type)
      || !isSafeEntryName(part.name)
      || !Number.isSafeInteger(part.index)
      || part.index < 1
      || !Number.isSafeInteger(part.size)
      || part.size < 0
      || !Number.isSafeInteger(part.plaintext_size)
      || part.plaintext_size < 0
      || part.plaintext_size > manifest.storage.chunk_size_bytes
      || !/^[0-9a-f]{64}$/i.test(String(part.sha256 || ''))
    ) failPackage('BACKUP_V2_INVALID_MANIFEST', 'O manifesto contém uma parte inválida.');
    decodeBase64(part.iv, 12, 'BACKUP_V2_INVALID_MANIFEST', `IV inválido na parte ${part.name}.`);
    decodeBase64(part.tag, 16, 'BACKUP_V2_INVALID_MANIFEST', `Tag inválida na parte ${part.name}.`);
    if (partNames.has(part.name)) failPackage('BACKUP_V2_INVALID_MANIFEST', 'O manifesto contém nomes de partes duplicados.');
    if (partIvs.has(part.iv)) failPackage('BACKUP_V2_INVALID_MANIFEST', 'O manifesto contém IVs de partes duplicados.');
    partNames.add(part.name);
    partIvs.add(part.iv);
  }
  const databaseParts = validatePartOrdering(manifest.parts, 'database', DATABASE_PART_PATTERN);
  const attachmentParts = validatePartOrdering(manifest.parts, 'attachments', ATTACHMENT_PART_PATTERN);
  if (databaseParts.length === 0) failPackage('BACKUP_V2_INVALID_MANIFEST', 'O pacote não contém partes de banco de dados.');
  if (attachmentParts.length > 0) {
    failPackage('BACKUP_V2_UNSUPPORTED_ATTACHMENTS', 'Este pacote usa partes de anexos separadas ainda não suportadas por este schema.');
  }
  if (!manifest.summary || typeof manifest.summary !== 'object' || Array.isArray(manifest.summary)) {
    failPackage('BACKUP_V2_INVALID_MANIFEST', 'O resumo do manifesto é inválido.');
  }
  for (const table of BACKUP_TABLES) {
    if (!Number.isSafeInteger(manifest.summary[table]) || manifest.summary[table] < 0) {
      failPackage('BACKUP_V2_INVALID_MANIFEST', `Contagem inválida para a tabela ${table}.`);
    }
  }
  for (const field of ['attachments', 'total_attachment_bytes', 'parts', 'total_bytes']) {
    if (!Number.isSafeInteger(manifest.summary[field]) || manifest.summary[field] < 0) {
      failPackage('BACKUP_V2_INVALID_MANIFEST', `Campo de resumo inválido: ${field}.`);
    }
  }
  if (manifest.summary.parts !== manifest.parts.length) {
    failPackage('BACKUP_V2_INVALID_MANIFEST', 'A quantidade de partes do resumo não corresponde ao manifesto.');
  }

  const expectedEntries = new Set([...METADATA_ENTRIES, ...partNames]);
  if (
    expectedEntries.size !== extractedEntries.size
    || [...extractedEntries].some((entry) => !expectedEntries.has(entry))
  ) failPackage('BACKUP_V2_EXTRA_OR_MISSING_PART', 'O pacote contém partes ausentes ou arquivos extras não declarados.');

  const checksumText = await readLimitedTextFile(
    path.join(extractDirectory, 'checksums', 'checksums.sha256'),
    BACKUP_CHECKSUMS_MAX_BYTES,
    'BACKUP_V2_INVALID_CHECKSUMS',
    'O pacote não contém uma lista de checksums válida.'
  );
  const checksumEntries = new Map();
  for (const line of checksumText.split(/\r?\n/).filter(Boolean)) {
    const match = /^([0-9a-f]{64})  ([a-zA-Z0-9/_\-.]+)$/.exec(line);
    if (!match || checksumEntries.has(match[2])) {
      failPackage('BACKUP_V2_INVALID_CHECKSUMS', 'O arquivo checksums.sha256 possui uma linha inválida.');
    }
    checksumEntries.set(match[2], match[1].toLowerCase());
  }
  if (checksumEntries.size !== manifest.parts.length) {
    failPackage('BACKUP_V2_INVALID_CHECKSUMS', 'A quantidade de checksums não corresponde ao manifesto.');
  }

  let totalBytes = 0;
  for (const part of manifest.parts) {
    ensureDeadline(deadline);
    const partPath = path.join(extractDirectory, ...part.name.split('/'));
    const stat = await fsp.stat(partPath).catch(() => null);
    if (!stat?.isFile() || stat.size !== part.size) {
      failPackage('BACKUP_V2_PART_SIZE_MISMATCH', `O tamanho da parte ${part.name} não corresponde ao manifesto.`);
    }
    totalBytes += stat.size;
    if (totalBytes > BACKUP_MAX_UPLOAD_BYTES) {
      failPackage('BACKUP_RESTORE_FILE_TOO_LARGE', 'As partes do pacote excedem o limite configurado.');
    }
    const checksum = await hashFile(partPath);
    if (
      checksum !== String(part.sha256).toLowerCase()
      || checksumEntries.get(part.name) !== checksum
    ) failPackage('BACKUP_V2_CHECKSUM_MISMATCH', `O checksum da parte ${part.name} não confere.`);
  }
  if (manifest.summary.total_bytes !== totalBytes) {
    failPackage('BACKUP_V2_INVALID_MANIFEST', 'O tamanho total do resumo não corresponde às partes.');
  }

  const key = await deriveKey(passphrase, salt);
  const authKey = getManifestAuthKey(key, salt);
  const { auth, ...manifestCore } = manifest;
  const expectedAuth = crypto.createHmac('sha256', authKey).update(JSON.stringify(manifestCore)).digest();
  const receivedAuth = Buffer.from(auth.value, 'hex');
  authKey.fill(0);
  if (receivedAuth.length !== expectedAuth.length || !crypto.timingSafeEqual(receivedAuth, expectedAuth)) {
    key.fill(0);
    failPackage('BACKUP_INVALID_PASSPHRASE', 'Não foi possível autenticar o manifesto. Verifique a frase informada.');
  }
  key.fill(0);
  return { manifest, databaseParts, extractDirectory };
};

async function* iterateDecryptedBytes(packageContext, passphrase, deadline) {
  const salt = Buffer.from(packageContext.manifest.kdf.salt, 'base64');
  const key = await deriveKey(passphrase, salt);
  try {
    for (const part of packageContext.databaseParts) {
      ensureDeadline(deadline);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(part.iv, 'base64'));
      decipher.setAAD(Buffer.from(part.name, 'utf8'));
      decipher.setAuthTag(Buffer.from(part.tag, 'base64'));
      try {
        for await (const encryptedChunk of fs.createReadStream(path.join(packageContext.extractDirectory, ...part.name.split('/')))) {
          ensureDeadline(deadline);
          const plaintext = decipher.update(encryptedChunk);
          if (plaintext.length) yield plaintext;
        }
        const final = decipher.final();
        if (final.length) yield final;
      } catch {
        failPackage('BACKUP_INVALID_PASSPHRASE', `Não foi possível descriptografar ou autenticar a parte ${part.name}.`);
      }
    }
  } finally {
    key.fill(0);
  }
}

async function* iterateDatabaseRecords(packageContext, passphrase, deadline) {
  let pending = Buffer.alloc(0);
  for await (const chunk of iterateDecryptedBytes(packageContext, passphrase, deadline)) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let newlineIndex = pending.indexOf(0x0a);
    while (newlineIndex >= 0) {
      const line = pending.subarray(0, newlineIndex);
      pending = pending.subarray(newlineIndex + 1);
      if (line.length) {
        let record;
        try {
          record = JSON.parse(line.toString('utf8'));
        } catch {
          failPackage('BACKUP_V2_INVALID_DATABASE_PART', 'Uma parte do banco contém NDJSON inválido.');
        }
        yield record;
      }
      newlineIndex = pending.indexOf(0x0a);
    }
    if (pending.length > BACKUP_MAX_UPLOAD_BYTES) {
      failPackage('BACKUP_V2_INVALID_DATABASE_PART', 'Um registro do backup excede o limite configurado.');
    }
  }
  if (pending.length) failPackage('BACKUP_V2_INVALID_DATABASE_PART', 'A última linha NDJSON do backup está incompleta.');
}

const scanDatabaseRecords = async (packageContext, passphrase, deadline) => {
  const counts = Object.fromEntries(BACKUP_TABLES.map((table) => [table, 0]));
  let previousTableIndex = 0;
  for await (const record of iterateDatabaseRecords(packageContext, passphrase, deadline)) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.table !== 'string') {
      failPackage('BACKUP_V2_INVALID_DATABASE_PART', 'Uma parte contém um registro inválido.');
    }
    const tableIndex = BACKUP_TABLES.indexOf(record.table);
    if (
      tableIndex < 0
      || tableIndex < previousTableIndex
      || !record.row
      || typeof record.row !== 'object'
      || Array.isArray(record.row)
    ) failPackage('BACKUP_V2_INVALID_DATABASE_PART', 'A ordem ou estrutura dos registros do banco é inválida.');
    previousTableIndex = tableIndex;
    counts[record.table] += 1;
  }
  for (const table of BACKUP_TABLES) {
    if (counts[table] !== packageContext.manifest.summary[table]) {
      failPackage('BACKUP_V2_SUMMARY_MISMATCH', `A contagem da tabela ${table} não corresponde ao manifesto.`);
    }
  }
  return counts;
};

const formatV2Summary = (manifest) => ({
  format: manifest.format,
  version: manifest.version,
  message: 'Backup v2 validado com sucesso.',
  generated_at: manifest.generated_at,
  generated_by: manifest.generated_by,
  tables: BACKUP_TABLES.map((table) => ({ table, records: manifest.summary[table] })),
  parts: manifest.parts.length,
  total_bytes: manifest.summary.total_bytes,
  attachments: manifest.summary.attachments,
  total_attachment_bytes: manifest.summary.total_attachment_bytes,
  attachment_storage: manifest.storage.attachments,
  warnings: [
    'Sessões ativas não são restauradas; todos os usuários deverão autenticar novamente.',
    'Registros existentes nas tabelas incluídas serão substituídos pelos dados deste backup.',
    'Os anexos permanecem criptografados dentro dos registros de vault_items.'
  ]
});

const inspectBackupPackageV2 = async (packagePath, passphrase) => {
  const workspace = await createWorkspace('restore-v2');
  const deadline = Date.now() + BACKUP_RESTORE_TIMEOUT_MS;
  try {
    const extracted = await extractPackage(packagePath, workspace);
    const packageContext = await validateManifest(extracted, passphrase, deadline);
    await scanDatabaseRecords(packageContext, passphrase, deadline);
    return {
      workspace,
      packageContext,
      summary: formatV2Summary(packageContext.manifest)
    };
  } catch (error) {
    await cleanupBackupWorkspace(workspace);
    if (error instanceof BackupPackageError) throw error;
    throw new BackupPackageError(
      'BACKUP_V2_INVALID_PACKAGE',
      'O arquivo ZIP não corresponde a um pacote de backup v2 válido.'
    );
  }
};

const restoreBackupPackageV2 = async ({ packageContext, passphrase }) => {
  const deadline = Date.now() + BACKUP_RESTORE_TIMEOUT_MS;
  const records = iterateDatabaseRecords(packageContext, passphrase, deadline);
  return restoreBackupRecords(records, packageContext.manifest.summary);
};

const isBackupPackageV2Filename = (filename) => (
  typeof filename === 'string' && filename.toLowerCase().endsWith('.zip')
);

module.exports = {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  createBackupPackageV2,
  inspectBackupPackageV2,
  restoreBackupPackageV2,
  cleanupBackupWorkspace,
  isBackupPackageV2Filename,
  formatV2Summary
};
