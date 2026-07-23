const assert = require('assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { Readable } = require('stream');

process.env.DB_HOST = 'test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'TEST_DB_PASSWORD_1234567890';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'TEST_JWT_SECRET_1234567890_TEST_JWT_SECRET_1234567890_TEST_JWT_SECRET_1234567890';
process.env.ADMIN_BOOTSTRAP_TOKEN = 'TEST_BOOTSTRAP_TOKEN_1234567890_TEST_BOOTSTRAP_TOKEN_1234567890';
process.env.SUPER_ADMIN_EMAIL = 'admin@example.com';
process.env.APP_ORIGIN = 'https://example.com';
process.env.BACKUP_CHUNK_SIZE_MB = '1';
process.env.BACKUP_MAX_UPLOAD_MB = '64';
process.env.BACKUP_RESTORE_TIMEOUT_MS = '300000';
process.env.BACKUP_TEMP_DIR = path.join(os.tmpdir(), `fullpassword-backup-v2-test-${process.pid}`);

const db = require('../src/config/database');
const { BACKUP_TABLES } = require('../src/config/backupTables');
const {
  createBackupPackageV2,
  inspectBackupPackageV2,
  restoreBackupPackageV2,
  cleanupBackupWorkspace
} = require('../src/services/backupPackageV2Service');
const {
  parseAndDecryptBackup,
  restoreBackupPayload
} = require('../src/services/backupRestoreService');
const { encryptBackupPayload } = require('../src/controllers/systemController');

const passphrase = 'TEST_BACKUP_PASSPHRASE_1234567890';
const makeEmptyTables = () => Object.fromEntries(BACKUP_TABLES.map((table) => [table, []]));
let tables = makeEmptyTables();
tables.users.push({ id: 1, email: 'admin@example.com', password_hash: 'argon2-test-hash' });
tables.groups.push({ id: 1, name: 'Test group' });
tables.user_groups.push({ id: 1, user_id: 1, group_id: 1 });
tables.clients.push({ id: 1, name: 'Large attachment client', encrypted_data: 'client-ciphertext' });
for (let index = 1; index <= 60; index += 1) {
  tables.vault_items.push({
    id: index,
    client_id: 1,
    type: 'credential',
    encrypted_data: `${String(index).padStart(2, '0')}:${'A'.repeat(32 * 1024)}`,
    encrypted_attachment: `${'B'.repeat(20 * 1024)}:${index}`
  });
}
const schemaColumns = Object.fromEntries(BACKUP_TABLES.map((table) => {
  const columns = new Set(['id']);
  tables[table].forEach((row) => Object.keys(row).forEach((column) => columns.add(column)));
  return [table, [...columns]];
}));

let failInsertTable = null;
const cloneTables = (value) => JSON.parse(JSON.stringify(value));

const makeClient = () => {
  let transactionSnapshot = null;
  return {
    query(query, params = []) {
      if (typeof query === 'object' && typeof query.cursor?.text === 'string') {
        const match = /^SELECT \* FROM ([a-z0-9_]+)$/i.exec(query.cursor.text.trim());
        assert(match, `Unexpected stream query: ${query.cursor.text}`);
        return Readable.from(tables[match[1]].map((row) => cloneTables(row)));
      }

      const sql = String(query).trim();
      if (sql.startsWith('BEGIN')) {
        transactionSnapshot = cloneTables(tables);
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        if (transactionSnapshot) tables = transactionSnapshot;
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (sql === 'SET CONSTRAINTS ALL DEFERRED') return { rows: [] };

      const selectColumns = /FROM information_schema\.columns/.test(sql);
      if (selectColumns) {
        const table = params[0];
        return { rows: schemaColumns[table].map((column_name) => ({ column_name })) };
      }
      if (sql.startsWith('SELECT pg_get_serial_sequence')) return { rows: [{ name: null }] };

      const deleteMatch = /^DELETE FROM ([a-z0-9_]+)$/i.exec(sql);
      if (deleteMatch) {
        tables[deleteMatch[1]] = [];
        return { rows: [] };
      }

      const insertMatch = /^INSERT INTO ([a-z0-9_]+) \(([^)]+)\) VALUES/i.exec(sql);
      if (insertMatch) {
        const table = insertMatch[1];
        if (failInsertTable === table) {
          const error = new Error(`Forced insert failure for ${table}`);
          error.code = '23503';
          error.constraint = `${table}_test_constraint`;
          throw error;
        }
        if (/ON CONFLICT/i.test(sql)) {
          if (!tables[table].some((row) => row.id === 1)) tables[table].push({ id: 1 });
          return { rows: [] };
        }
        const columns = insertMatch[2].split(',').map((column) => column.trim());
        tables[table].push(Object.fromEntries(columns.map((column, index) => [column, params[index]])));
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
};

db.pool.connect = async () => makeClient();

const writeZip = async (destination, entries) => {
  const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const archive = archiver('zip', { forceZip64: true, store: true });
  const complete = new Promise((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
  });
  archive.pipe(output);
  entries.forEach(({ source, name }) => archive.file(source, { name, store: true }));
  await archive.finalize();
  await complete;
};

const expectCode = async (promiseFactory, expectedCode) => {
  await assert.rejects(
    promiseFactory,
    (error) => error?.code === expectedCode,
    `Expected ${expectedCode}`
  );
};

const run = async () => {
  const testDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'fullpassword-v2-artifacts-'));
  let exported;
  let restoreInspection;
  try {
    const originalTables = cloneTables(tables);
    exported = await createBackupPackageV2({ generatedBy: 'admin@example.com', passphrase });
    assert(exported.manifest.parts.length >= 2, 'The export must be split into multiple encrypted parts');
    assert.equal(exported.manifest.summary.attachments, 60);
    assert.equal(exported.manifest.storage.attachments, 'embedded-encrypted-vault-items');

    const dryRunInspection = await inspectBackupPackageV2(exported.packagePath, passphrase);
    assert.equal(dryRunInspection.summary.version, 2);
    assert.equal(dryRunInspection.summary.parts, exported.manifest.parts.length);
    assert.equal(dryRunInspection.summary.tables.find(({ table }) => table === 'vault_items').records, 60);
    await cleanupBackupWorkspace(dryRunInspection.workspace);

    await expectCode(
      () => inspectBackupPackageV2(exported.packagePath, 'WRONG_PASSPHRASE_1234567890'),
      'BACKUP_INVALID_PASSPHRASE'
    );

    const part = exported.manifest.parts[0];
    const sourcePartPath = path.join(exported.workspace, ...part.name.split('/'));
    const originalPart = await fsp.readFile(sourcePartPath);
    const tamperedPart = Buffer.from(originalPart);
    tamperedPart[0] ^= 0xff;
    await fsp.writeFile(sourcePartPath, tamperedPart);
    const packageEntries = [
      { source: path.join(exported.workspace, 'manifest.json'), name: 'manifest.json' },
      { source: path.join(exported.workspace, 'checksums', 'checksums.sha256'), name: 'checksums/checksums.sha256' },
      ...exported.manifest.parts.map((entry) => ({
        source: path.join(exported.workspace, ...entry.name.split('/')),
        name: entry.name
      }))
    ];
    const tamperedPackage = path.join(testDirectory, 'tampered.zip');
    await writeZip(tamperedPackage, packageEntries);
    await expectCode(
      () => inspectBackupPackageV2(tamperedPackage, passphrase),
      'BACKUP_V2_CHECKSUM_MISMATCH'
    );
    await fsp.writeFile(sourcePartPath, originalPart);

    const missingPartPackage = path.join(testDirectory, 'missing-part.zip');
    await writeZip(
      missingPartPackage,
      packageEntries.filter(({ name }) => name !== exported.manifest.parts.at(-1).name)
    );
    await expectCode(
      () => inspectBackupPackageV2(missingPartPackage, passphrase),
      'BACKUP_V2_EXTRA_OR_MISSING_PART'
    );

    const unexpectedFile = path.join(testDirectory, 'unexpected.txt');
    await fsp.writeFile(unexpectedFile, 'not allowed', { mode: 0o600 });
    const extraEntryPackage = path.join(testDirectory, 'extra-entry.zip');
    await writeZip(extraEntryPackage, [
      ...packageEntries,
      { source: unexpectedFile, name: 'unexpected.txt' }
    ]);
    await expectCode(
      () => inspectBackupPackageV2(extraEntryPackage, passphrase),
      'BACKUP_V2_UNSAFE_ENTRY'
    );

    restoreInspection = await inspectBackupPackageV2(exported.packagePath, passphrase);
    tables = makeEmptyTables();
    await restoreBackupPackageV2({
      packageContext: restoreInspection.packageContext,
      passphrase
    });
    assert.equal(tables.users.length, originalTables.users.length);
    assert.equal(tables.vault_items.length, 60);
    assert.equal(tables.vault_items[10].encrypted_attachment, originalTables.vault_items[10].encrypted_attachment);
    await cleanupBackupWorkspace(restoreInspection.workspace);
    restoreInspection = null;

    const v1Payload = {
      metadata: {
        project: 'FullPassword',
        type: 'full-encrypted-backup',
        version: 1,
        generated_at: new Date().toISOString(),
        generated_by: 'admin@example.com'
      },
      data: cloneTables(originalTables)
    };
    const v1Envelope = await encryptBackupPayload(v1Payload, passphrase);
    const parsedV1 = await parseAndDecryptBackup(Buffer.from(JSON.stringify(v1Envelope)), passphrase);
    tables = makeEmptyTables();
    await restoreBackupPayload(parsedV1.payload);
    assert.equal(tables.users.length, originalTables.users.length);
    assert.equal(tables.vault_items.length, 60);

    const beforeRollback = cloneTables(tables);
    failInsertTable = 'groups';
    await assert.rejects(() => restoreBackupPayload(parsedV1.payload));
    failInsertTable = null;
    assert.deepEqual(tables, beforeRollback, 'A failed restore must roll back every table');

    console.log(JSON.stringify({
      ok: true,
      v2_parts: exported.manifest.parts.length,
      v2_attachments: exported.manifest.summary.attachments,
      v2_restore: 'passed',
      v1_restore: 'passed',
      wrong_passphrase: 'rejected',
      tampered_part: 'rejected',
      missing_part: 'rejected',
      extra_entry: 'rejected',
      rollback: 'passed'
    }, null, 2));
  } finally {
    failInsertTable = null;
    await cleanupBackupWorkspace(restoreInspection?.workspace).catch(() => {});
    await cleanupBackupWorkspace(exported?.workspace).catch(() => {});
    await fsp.rm(testDirectory, { recursive: true, force: true });
    await fsp.rm(process.env.BACKUP_TEMP_DIR, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
