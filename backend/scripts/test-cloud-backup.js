const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test-password';
process.env.DB_NAME ||= 'test';
process.env.APP_ORIGIN ||= 'https://cofre.example.test';
process.env.CONFIG_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.JWT_SECRET ||= crypto.randomBytes(64).toString('base64url');
process.env.ADMIN_BOOTSTRAP_TOKEN ||= crypto.randomBytes(48).toString('base64url');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const {
  validateS3Config,
  validateFtpConfig,
  saveProviderConfiguration,
  getResolvedProviderConfig,
  selectProvider,
  getStatus,
  updateSettings,
  normalizeFailureEmailRecipients,
  normalizeBackupFormat,
  deleteExpiredRuns,
  listRuns
} = require('../src/services/cloudBackupSettingsService');
const { encryptConfigSecret, decryptConfigSecret } = require('../src/services/configSecretCrypto');
const {
  ADAPTERS,
  beginRun,
  runCloudBackup,
  sanitizeCloudError,
  assertActiveProvider
} = require('../src/services/cloudBackupService');
const { getNextExecutionAt } = require('../src/services/cloudBackupScheduler');
const s3Adapter = require('../src/services/remoteStorage/s3StorageProvider');
const ftpAdapter = require('../src/services/remoteStorage/ftpStorageProvider');

const createStore = () => {
  const settings = {
    id: 1,
    active_provider: 'none',
    enabled: true,
    schedule_enabled: true,
    schedule_days: [0],
    schedule_times: ['02:00'],
    retention_days: 30,
    backup_format: 'v2'
  };
  const providers = Object.fromEntries(
    ['google_drive', 'backblaze_b2', 'mega_s3', 'ftp'].map((provider) => [
      provider,
      {
        provider,
        enabled: false,
        configured: false,
        public_config: {},
        encrypted_credentials: null,
        last_test_at: '2026-07-26T12:00:00.000Z',
        last_test_status: 'success'
      }
    ])
  );
  const google = {
    id: 1,
    connected: true,
    encrypted_refresh_token: 'v1:preserved-google-refresh-token',
    schedule_days: [0],
    schedule_times: ['02:00'],
    retention_days: 30
  };
  return {
    settings,
    providers,
    google,
    query: async (text, params = []) => {
      if (text.includes('SELECT * FROM cloud_backup_settings')) return { rows: [{ ...settings }] };
      if (text.includes('SELECT * FROM cloud_backup_providers WHERE provider')) {
        return { rows: [{ ...providers[params[0]] }] };
      }
      if (text.includes('SELECT * FROM cloud_backup_providers ORDER BY provider')) {
        return { rows: Object.values(providers).map((row) => ({ ...row })) };
      }
      if (text.includes('SELECT * FROM google_drive_backup_settings')) return { rows: [{ ...google }] };
      if (text.includes('UPDATE google_drive_backup_settings')) {
        google.enabled = false;
        google.schedule_enabled = false;
        return { rows: [] };
      }
      if (text.includes('SET configured = TRUE')) {
        const row = providers[params[0]];
        row.configured = true;
        row.public_config = JSON.parse(params[1]);
        row.encrypted_credentials = params[2];
        row.last_test_at = null;
        row.last_test_status = null;
        row.updated_by = params[3];
        return { rows: [] };
      }
      if (text.includes('SET active_provider = $1')) {
        settings.active_provider = params[0];
        if (!params[1]) {
          settings.enabled = false;
          settings.schedule_enabled = false;
        }
        return { rows: [] };
      }
      if (text.includes("SET active_provider = 'none'")) {
        settings.active_provider = 'none';
        settings.enabled = false;
        settings.schedule_enabled = false;
        return { rows: [] };
      }
      if (text.includes('SET enabled = (provider = $1)')) {
        Object.values(providers).forEach((row) => {
          row.enabled = row.provider === params[0];
        });
        return { rows: [] };
      }
      if (text.includes('SET enabled = FALSE') && text.includes('cloud_backup_providers')) {
        Object.values(providers).forEach((row) => {
          row.enabled = false;
        });
        return { rows: [] };
      }
      if (text.includes('SET enabled = $1') && text.includes('failure_email_enabled')) {
        settings.enabled = params[0];
        settings.schedule_enabled = params[1];
        settings.schedule_days = JSON.parse(params[2]);
        settings.schedule_times = JSON.parse(params[3]);
        settings.retention_days = params[4];
        settings.backup_format = params[5];
        settings.encrypted_backup_passphrase = params[6];
        settings.failure_email_enabled = params[7];
        settings.failure_email_recipients = JSON.parse(params[8]);
        settings.failure_email_on_recovery = params[9];
        return { rows: [] };
      }
      if (text.includes('DELETE FROM cloud_backup_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('COUNT(*)') && text.includes('cloud_backup_runs')) {
        return { rows: [{ total: 25 }] };
      }
      if (text.includes('FROM cloud_backup_runs')) {
        return {
          rows: Array.from({ length: params[0] }, (_, index) => ({
            id: params[1] + index + 1,
            provider: 'mega_s3',
            status: 'success',
            backup_format: index % 2 ? 'v1' : 'v2'
          }))
        };
      }
      throw new Error(`Query não simulada: ${text}`);
    }
  };
};

const run = async () => {
  assert.equal(normalizeBackupFormat(), 'v2');
  assert.equal(normalizeBackupFormat('v1'), 'v1');
  assert.equal(normalizeBackupFormat('v2'), 'v2');
  assert.throws(
    () => normalizeBackupFormat('v3'),
    (error) => error.code === 'CLOUD_BACKUP_INVALID_FORMAT'
      && error.message === 'Formato de backup inválido.'
  );
  assert.throws(
    () => assertActiveProvider({ active_provider: 'none' }),
    (error) => error.code === 'CLOUD_BACKUP_PROVIDER_REQUIRED'
  );
  assert.equal(getNextExecutionAt({
    active_provider: 'none',
    enabled: true,
    schedule_enabled: true,
    schedule_days: [0, 1, 2, 3, 4, 5, 6],
    schedule_times: ['02:00']
  }), null);
  assert.throws(
    () => validateS3Config('backblaze_b2', {
      endpoint: 'http://s3.example.test',
      region: 'us-test-1',
      bucket: 'private-bucket',
      access_key: 'key',
      secret_key: 'secret'
    }),
    (error) => error.code === 'CLOUD_BACKUP_INVALID_ENDPOINT'
  );
  assert.equal(
    validateS3Config('mega_s3', {
      endpoint: 'https://s3.example.test',
      region: 'eu-test-1',
      bucket: 'private-bucket',
      access_key: 'access-key',
      secret_key: 'secret-key'
    }).publicConfig.force_path_style,
    true
  );
  assert.throws(
    () => validateFtpConfig({ host: 'ftp://example.test', username: 'user', password: 'secret' }),
    (error) => error.code === 'CLOUD_BACKUP_INVALID_FTP_HOST'
  );
  assert.equal(
    validateFtpConfig({
      host: 'ftp.example.test',
      port: 21,
      username: 'user',
      password: 'secret',
      remote_path: '/fullpassword/backups',
      secure: true
    }).publicConfig.secure,
    true
  );

  const store = createStore();
  await saveProviderConfiguration('backblaze_b2', {
    endpoint: 'https://s3.us-test-1.example.test',
    region: 'us-test-1',
    bucket: 'private-bucket',
    access_key: 'plain-access-key',
    secret_key: 'plain-secret-key',
    prefix: 'fullpassword/backups/'
  }, '00000000-0000-0000-0000-000000000001', store);
  const encrypted = store.providers.backblaze_b2.encrypted_credentials;
  assert.match(encrypted, /^v1:/);
  assert.doesNotMatch(encrypted, /plain-access-key|plain-secret-key/);
  assert.equal(store.providers.backblaze_b2.last_test_at, null);
  assert.equal(store.providers.backblaze_b2.last_test_status, null);
  assert.deepEqual(JSON.parse(decryptConfigSecret(encrypted)), {
    accessKeyId: 'plain-access-key',
    secretAccessKey: 'plain-secret-key'
  });
  const resolved = await getResolvedProviderConfig('backblaze_b2', store);
  assert.equal(resolved.secretAccessKey, 'plain-secret-key');
  await saveProviderConfiguration('ftp', {
    host: 'ftp.example.test',
    port: 21,
    username: 'ftp-user',
    password: 'plain-ftp-password',
    remote_path: '/fullpassword/backups',
    secure: true
  }, '00000000-0000-0000-0000-000000000001', store);
  assert.match(store.providers.ftp.encrypted_credentials, /^v1:/);
  assert.doesNotMatch(store.providers.ftp.encrypted_credentials, /plain-ftp-password/);
  assert.equal((await getResolvedProviderConfig('ftp', store)).password, 'plain-ftp-password');

  let status = await selectProvider('backblaze_b2', 'user-id', store);
  assert.equal(status.active_provider, 'backblaze_b2');
  assert.equal(Object.values(store.providers).filter((row) => row.enabled).length, 1);
  assert.equal(status.providers.backblaze_b2.configured, true);
  assert.equal('secretAccessKey' in status.providers.backblaze_b2, false);

  status = await selectProvider('mega_s3', 'user-id', store);
  assert.equal(status.active_provider, 'mega_s3');
  assert.equal(store.settings.enabled, false);
  assert.ok(store.providers.backblaze_b2.encrypted_credentials);
  assert.equal(Object.values(store.providers).filter((row) => row.enabled).length, 1);

  status = await selectProvider('none', 'user-id', store);
  assert.equal(status.active_provider, 'none');
  assert.equal(status.enabled, false);
  assert.equal(status.schedule_enabled, false);
  assert.equal(Object.values(store.providers).filter((row) => row.enabled).length, 0);
  assert.ok(store.providers.backblaze_b2.encrypted_credentials);
  assert.match(store.providers.ftp.encrypted_credentials, /^v1:/);

  status = await selectProvider('google_drive', 'user-id', store);
  assert.equal(status.active_provider, 'google_drive');
  status = await updateSettings({
    active_provider: 'none',
    enabled: false,
    schedule_enabled: false,
    schedule_days: [0],
    schedule_times: ['02:00'],
    retention_days: 30,
    backup_format: 'v1'
  }, 'user-id', store);
  assert.equal(status.active_provider, 'none');
  assert.equal(status.enabled, false);
  assert.equal(status.schedule_enabled, false);
  assert.equal(status.backup_format, 'v1');
  status = await selectProvider('google_drive', 'user-id', store);
  status = await selectProvider('mega_s3', 'user-id', store);
  assert.equal(status.active_provider, 'mega_s3');
  assert.equal(store.google.encrypted_refresh_token, 'v1:preserved-google-refresh-token');
  status = await selectProvider('none', 'user-id', store);
  assert.equal(status.active_provider, 'none');

  await assert.rejects(
    () => updateSettings({
      enabled: true,
      schedule_enabled: false,
      schedule_days: [0],
      schedule_times: ['02:00'],
      retention_days: 30
    }, 'user-id', store),
    (error) => error.code === 'CLOUD_BACKUP_PROVIDER_REQUIRED'
      && /Selecione um provedor/.test(error.message)
  );
  assert.deepEqual(
    normalizeFailureEmailRecipients('Admin@Example.test, support@example.test, admin@example.test'),
    ['admin@example.test', 'support@example.test']
  );
  assert.throws(
    () => normalizeFailureEmailRecipients('not-an-email'),
    (error) => error.code === 'CLOUD_BACKUP_INVALID_EMAIL_RECIPIENTS'
  );
  status = await updateSettings({
    enabled: false,
    schedule_enabled: false,
    schedule_days: [0],
    schedule_times: ['02:00'],
    retention_days: 30,
    backup_format: 'v2',
    failure_email_enabled: true,
    failure_email_recipients: ['admin@example.test'],
    failure_email_on_recovery: true
  }, 'user-id', store);
  assert.equal(status.active_provider, 'none');
  assert.equal(status.failure_email_enabled, true);
  assert.deepEqual(status.failure_email_recipients, ['admin@example.test']);
  assert.equal(status.failure_email_on_recovery, true);
  assert.equal(status.backup_format, 'v2');

  await assert.rejects(
    () => updateSettings({
      enabled: false,
      schedule_enabled: false,
      schedule_days: [0],
      schedule_times: ['02:00'],
      retention_days: 30,
      backup_format: 'invalid'
    }, 'user-id', store),
    (error) => error.code === 'CLOUD_BACKUP_INVALID_FORMAT'
  );

  let cleanupRetention;
  const removedRuns = await deleteExpiredRuns(15, {
    query: async (text, params) => {
      assert.match(text, /DELETE FROM cloud_backup_runs/);
      assert.doesNotMatch(text, /audit/);
      cleanupRetention = params[0];
      return { rowCount: 3 };
    }
  });
  assert.equal(cleanupRetention, 15);
  assert.equal(removedRuns, 3);

  const paginatedRuns = await listRuns({ page: 2, pageSize: 50 }, store);
  assert.equal(paginatedRuns.items.length, 10);
  assert.equal(paginatedRuns.items[0].id, 11);
  assert.deepEqual(paginatedRuns.pagination, {
    page: 2,
    page_size: 10,
    total: 25,
    total_pages: 3
  });

  const sanitizedStatus = await getStatus(store);
  assert.equal('encrypted_credentials' in sanitizedStatus.providers.backblaze_b2, false);
  assert.equal('password' in sanitizedStatus.providers.ftp, false);

  assert.equal(ADAPTERS.backblaze_b2, s3Adapter);
  assert.equal(ADAPTERS.mega_s3, s3Adapter);
  assert.equal(ADAPTERS.ftp, ftpAdapter);
  let runParams;
  const runId = await beginRun({
    provider: 'mega_s3',
    triggerType: 'manual',
    userId: 'user-id'
  }, {
    query: async (_text, params) => {
      runParams = params;
      return { rows: [{ id: 42 }] };
    }
  });
  assert.equal(runId, 42);
  assert.equal(runParams[0], 'mega_s3');
  assert.equal(runParams[2], 'v2');

  const executedFormats = [];
  const uploadedFormats = [];
  let selectedFormat = 'v1';
  let nextRunId = 100;
  const executionSettings = {
    active_provider: 'mega_s3',
    backup_format: selectedFormat,
    retention_days: 7,
    encrypted_backup_passphrase: encryptConfigSecret('test-backup-passphrase-1234'),
    last_error_at: null
  };
  const executionProvider = {
    provider: 'mega_s3',
    configured: true,
    encrypted_credentials: encryptConfigSecret(JSON.stringify({
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key'
    })),
    public_config: {
      endpoint: 'https://s3.example.test',
      region: 'eu-test-1',
      bucket: 'test-bucket',
      prefix: 'fullpassword/backups/'
    }
  };
  const executionStore = {
    query: async (text, params = []) => {
      if (text.includes('SELECT * FROM cloud_backup_settings')) {
        return { rows: [{ ...executionSettings, backup_format: selectedFormat }] };
      }
      if (text.includes('SELECT * FROM cloud_backup_providers WHERE provider')) {
        return { rows: [{ ...executionProvider }] };
      }
      if (text.includes('INSERT INTO cloud_backup_runs')) {
        executedFormats.push({ trigger: params[1], format: params[2] });
        nextRunId += 1;
        return { rows: [{ id: nextRunId }] };
      }
      if (text.includes('UPDATE cloud_backup_runs')) return { rows: [] };
      if (text.includes('UPDATE cloud_backup_settings')) return { rows: [] };
      if (text.includes('DELETE FROM cloud_backup_runs')) return { rows: [], rowCount: 0 };
      throw new Error(`Query de execução não simulada: ${text}`);
    }
  };
  const executionAdapter = {
    upload: async ({ remoteName, backupFormat }) => {
      uploadedFormats.push({ remoteName, backupFormat });
      return { remoteId: 'remote-id', remotePath: `fullpassword/backups/${remoteName}` };
    },
    applyRetention: async () => 0
  };
  const artifactBuilders = {
    v1: async () => {
      const workspace = await fs.promises.mkdtemp(path.join(require('os').tmpdir(), 'fullpassword-v1-test-'));
      const packagePath = path.join(workspace, 'artifact.enc.json');
      await fs.promises.writeFile(packagePath, '{}');
      return { workspace, packagePath };
    },
    v2: async () => {
      const workspace = await fs.promises.mkdtemp(path.join(require('os').tmpdir(), 'fullpassword-v2-test-'));
      const packagePath = path.join(workspace, 'artifact.zip');
      await fs.promises.writeFile(packagePath, 'zip');
      return { workspace, packagePath };
    }
  };
  const testAdapters = { ...ADAPTERS, mega_s3: executionAdapter };
  const manualRun = await runCloudBackup(
    { triggerType: 'manual', userId: 'user-id' },
    executionStore,
    testAdapters,
    artifactBuilders
  );
  selectedFormat = 'v2';
  const scheduledRun = await runCloudBackup(
    { triggerType: 'scheduled', userId: 'user-id', scheduledSlot: '2026-07-26T12:00@test' },
    executionStore,
    testAdapters,
    artifactBuilders
  );
  assert.equal(manualRun.backup_format, 'v1');
  assert.match(manualRun.file_name, /^fullpassword-backup-v1-.*\.enc\.json$/);
  assert.equal(scheduledRun.backup_format, 'v2');
  assert.match(scheduledRun.file_name, /^fullpassword-backup-v2-.*\.zip$/);
  assert.deepEqual(executedFormats, [
    { trigger: 'manual', format: 'v1' },
    { trigger: 'scheduled', format: 'v2' }
  ]);
  assert.deepEqual(uploadedFormats.map((item) => item.backupFormat), ['v1', 'v2']);
  assert.throws(
    () => s3Adapter.joinRemoteKey('fullpassword/backups/', '../not-a-backup.txt'),
    /inválido/
  );
  assert.match(
    s3Adapter.joinRemoteKey('fullpassword/backups/', 'fullpassword-backup-v1-20260726-120000.enc.json'),
    /fullpassword-backup-v1-/
  );
  assert.match(
    s3Adapter.joinRemoteKey('fullpassword/backups/', 'fullpassword-backup-v2-20260726-120000.zip'),
    /fullpassword-backup-v2-/
  );
  assert.throws(() => ftpAdapter.safeRemoteName('../../outside.txt'), /inválido/);
  assert.match(
    ftpAdapter.safeRemoteName('fullpassword-backup-v1-20260726-120000.enc.json'),
    /fullpassword-backup-v1-/
  );
  assert.equal(sanitizeCloudError(new Error('plain-secret-key')).message.includes('plain-secret-key'), false);

  const serverSource = read('src/server.js');
  const cloudSchedulerSource = read('src/services/cloudBackupScheduler.js');
  const legacySchedulerSource = read('src/services/googleDriveBackupScheduler.js');
  const cloudServiceSource = read('src/services/cloudBackupService.js');
  const controllerSource = read('src/controllers/cloudBackupController.js');
  const cloudRoutesSource = read('src/routes/cloudBackupRoutes.js');
  const limiterSource = read('src/middleware/writeRateLimiters.js');
  assert.match(serverSource, /startCloudBackupScheduler\(\)/);
  assert.doesNotMatch(serverSource, /startGoogleDriveBackupScheduler\(\)/);
  assert.match(cloudSchedulerSource, /let schedulerStop = null/);
  assert.match(cloudSchedulerSource, /settings\.active_provider === 'none'/);
  assert.match(cloudSchedulerSource, /runCloudBackup/);
  assert.doesNotMatch(legacySchedulerSource, /setInterval/);
  assert.match(legacySchedulerSource, /startCloudBackupScheduler/);
  assert.match(cloudServiceSource, /provider === 'google_drive'/);
  assert.match(controllerSource, /isSuperAdmin\(req\.user\)/);
  assert.doesNotMatch(controllerSource, /secret_key|password|refresh_token|access_token|client_secret/);
  assert.match(serverSource, /app\.use\('\/api\/system\/update', systemUpdateLimiter\)/);
  assert.doesNotMatch(serverSource, /app\.use\('\/api\/cloud-backup', sensitiveOperationLimiter\)/);
  assert.match(cloudRoutesSource, /router\.put\('\/provider', cloudBackupConfigLimiter/);
  assert.match(cloudRoutesSource, /router\.post\('\/test', cloudBackupOperationLimiter/);
  assert.match(cloudRoutesSource, /router\.post\('\/run', cloudBackupOperationLimiter/);
  assert.match(limiterSource, /keyPrefix: 'cloud-backup-config'/);
  assert.match(limiterSource, /keyPrefix: 'system-update'/);

  const database = require('../src/config/database');
  const originalQuery = database.query;
  database.query = async () => ({ rows: [] });
  try {
    const { status: statusController } = require('../src/controllers/cloudBackupController');
    const response = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; }
    };
    await statusController({
      user: { role: 'user', is_super_admin: false },
      get: () => 'test-agent',
      ip: '127.0.0.1'
    }, response);
    assert.equal(response.statusCode, 403);
  } finally {
    database.query = originalQuery;
  }

  console.log('Cloud Backup backend tests passed.');
};

run()
  .then(() => require('../src/config/database').pool.end())
  .catch(async (error) => {
    console.error(error);
    await require('../src/config/database').pool.end();
    process.exitCode = 1;
  });
