const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test-password';
process.env.DB_NAME ||= 'test';
process.env.APP_ORIGIN ||= 'https://cofre.example.test';
process.env.GOOGLE_DRIVE_CLIENT_ID ||= 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_DRIVE_CLIENT_SECRET ||= 'test-client-secret';
process.env.CONFIG_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.JWT_SECRET ||= crypto.randomBytes(64).toString('base64url');
process.env.ADMIN_BOOTSTRAP_TOKEN ||= crypto.randomBytes(48).toString('base64url');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const {
  DRIVE_SCOPE,
  getSettings,
  getOAuthConfigStatus,
  resolveGoogleDriveOAuthConfig,
  saveOAuthConfig,
  removeOAuthConfig,
  saveConnection,
  sanitizeSettings
} = require('../src/services/googleDriveBackupSettingsService');
const { encryptConfigSecret } = require('../src/services/configSecretCrypto');
const {
  createAuthorizationUrl,
  consumeOAuthState,
  ensureBackupFolder,
  deleteExpiredBackups,
  beginRun,
  sanitizeDriveError
} = require('../src/services/googleDriveBackupService');
const {
  getScheduledSlot,
  getNextExecutionAt
} = require('../src/services/googleDriveBackupScheduler');

const run = async () => {
  const routes = read('src/routes/integrationRoutes.js');
  const controller = read('src/controllers/googleDriveBackupController.js');
  assert.match(routes, /router\.use\(verifyToken\)/);
  assert.match(routes, /google-drive\/oauth-config/);
  assert.match(controller, /isSuperAdmin\(req\.user\)/);

  const databaseOAuthRow = {
    id: 1,
    connected: false,
    google_oauth_client_id: 'database-client.apps.googleusercontent.com',
    encrypted_google_oauth_client_secret: encryptConfigSecret('database-client-secret'),
    google_oauth_redirect_uri: 'https://cofre.example.test/api/integrations/google-drive/oauth/callback',
    google_oauth_configured_at: new Date().toISOString(),
    google_oauth_configured_by: '00000000-0000-0000-0000-000000000001'
  };
  const databaseOAuthConfig = await resolveGoogleDriveOAuthConfig({
    query: async () => ({ rows: [databaseOAuthRow] })
  });
  assert.equal(databaseOAuthConfig.source, 'database');
  assert.equal(databaseOAuthConfig.clientId, databaseOAuthRow.google_oauth_client_id);
  assert.equal(databaseOAuthConfig.clientSecret, 'database-client-secret');

  const databaseStatus = await getOAuthConfigStatus({
    query: async () => ({ rows: [databaseOAuthRow] })
  });
  assert.equal(databaseStatus.configured, true);
  assert.equal(databaseStatus.source, 'database');
  assert.equal('clientSecret' in databaseStatus, false);
  assert.equal('client_secret' in databaseStatus, false);
  const databaseSettingsStatus = await getSettings({
    query: async () => ({ rows: [databaseOAuthRow] })
  });
  assert.equal(databaseSettingsStatus.server_configured, true);
  assert.equal(databaseSettingsStatus.oauth_configured, true);
  assert.equal(databaseSettingsStatus.oauth_config_source, 'database');
  const environmentOAuthConfig = await resolveGoogleDriveOAuthConfig({
    query: async () => ({ rows: [{}] })
  });
  assert.equal(environmentOAuthConfig.configured, true);
  assert.equal(environmentOAuthConfig.source, 'env');
  const environmentSettingsStatus = await getSettings({
    query: async () => ({ rows: [{}] })
  });
  assert.equal(environmentSettingsStatus.oauth_configured, true);
  assert.equal(environmentSettingsStatus.oauth_config_source, 'env');

  const savedOAuthRow = { id: 1, connected: false };
  let encryptedClientSecret;
  const oauthConfigStore = {
    query: async (text, params = []) => {
      if (text.includes('SELECT * FROM google_drive_backup_settings')) {
        return { rows: [{ ...savedOAuthRow }] };
      }
      if (text.includes('SET google_oauth_client_id')) {
        savedOAuthRow.google_oauth_client_id = params[0];
        savedOAuthRow.encrypted_google_oauth_client_secret = params[1];
        savedOAuthRow.google_oauth_redirect_uri = params[2];
        savedOAuthRow.google_oauth_configured_by = params[3];
        savedOAuthRow.google_oauth_configured_at = new Date().toISOString();
        encryptedClientSecret = params[1];
      }
      return { rows: [] };
    }
  };
  const savedOAuth = await saveOAuthConfig({
    client_id: 'saved-client.apps.googleusercontent.com',
    client_secret: 'saved-client-secret',
    redirect_uri: 'https://cofre.example.test/api/integrations/google-drive/oauth/callback'
  }, '00000000-0000-0000-0000-000000000001', oauthConfigStore);
  assert.match(encryptedClientSecret, /^v1:/);
  assert.notEqual(encryptedClientSecret, 'saved-client-secret');
  assert.equal(savedOAuth.status.configured, true);
  assert.equal('client_secret' in savedOAuth.status, false);

  await assert.rejects(
    () => removeOAuthConfig({
      query: async () => ({
        rows: [{ connected: true, encrypted_refresh_token: 'v1:encrypted' }]
      })
    }),
    (error) => error.code === 'GOOGLE_DRIVE_OAUTH_CONFIG_IN_USE'
  );

  const oauthQueries = [];
  const authorizationUrl = await createAuthorizationUrl('00000000-0000-0000-0000-000000000001', {
    query: async (text, params) => {
      oauthQueries.push({ text, params });
      return { rows: [] };
    }
  });
  const parsedUrl = new URL(authorizationUrl);
  assert.equal(parsedUrl.searchParams.get('access_type'), 'offline');
  assert.equal(parsedUrl.searchParams.get('prompt'), 'consent');
  assert.equal(parsedUrl.searchParams.get('scope'), DRIVE_SCOPE);
  assert.ok(parsedUrl.searchParams.get('state').length >= 32);
  assert.ok(oauthQueries.some(({ text }) => text.includes('google_drive_oauth_states')));

  const databaseAuthorizationUrl = await createAuthorizationUrl(
    '00000000-0000-0000-0000-000000000001',
    {
      query: async (text) => ({
        rows: text.includes('SELECT * FROM google_drive_backup_settings')
          ? [databaseOAuthRow]
          : []
      })
    }
  );
  assert.equal(
    new URL(databaseAuthorizationUrl).searchParams.get('client_id'),
    databaseOAuthRow.google_oauth_client_id
  );

  const savedEnvironment = {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET
  };
  delete process.env.GOOGLE_DRIVE_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  await assert.rejects(
    () => createAuthorizationUrl('00000000-0000-0000-0000-000000000001', {
      query: async (text) => ({
        rows: text.includes('SELECT * FROM google_drive_backup_settings') ? [{}] : []
      })
    }),
    (error) => error.code === 'GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED'
  );
  process.env.GOOGLE_DRIVE_CLIENT_ID = savedEnvironment.clientId;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = savedEnvironment.clientSecret;

  await assert.rejects(
    () => consumeOAuthState('state-that-is-long-enough-for-validation-0000', { query: async () => ({ rows: [] }) }),
    (error) => error.code === 'GOOGLE_DRIVE_INVALID_STATE'
  );

  let encryptedToken;
  let connectedSettings = {
    connected: false,
    backup_format: 'v2',
    schedule_days: [0],
    schedule_times: ['02:00'],
    retention_days: 30
  };
  await saveConnection({ refreshToken: 'refresh-token-plain-test', googleEmail: 'admin@example.test' }, 'user-id', {
    query: async (text, params = []) => {
      if (text.includes('SET connected = TRUE')) {
        encryptedToken = params[1];
        connectedSettings = {
          ...connectedSettings,
          connected: true,
          google_email: params[0],
          encrypted_refresh_token: params[1],
          scope: DRIVE_SCOPE
        };
        return { rows: [{ id: 1 }] };
      }
      return { rows: [{ ...connectedSettings }] };
    }
  });
  assert.notEqual(encryptedToken, 'refresh-token-plain-test');
  assert.match(encryptedToken, /^v1:/);
  assert.equal('encrypted_refresh_token' in sanitizeSettings({ encrypted_refresh_token: encryptedToken }), false);

  let savedFolderId;
  const folder = await ensureBackupFolder({
    files: {
      list: async () => ({ data: { files: [] } }),
      create: async ({ requestBody }) => {
        assert.equal(requestBody.mimeType, 'application/vnd.google-apps.folder');
        assert.deepEqual(requestBody.appProperties, { app: 'fullpassword', type: 'backup-folder' });
        return { data: { id: 'folder-1' } };
      }
    }
  }, { drive_folder_name: 'FullPassword Backups' }, {
    query: async (_text, params) => {
      [savedFolderId] = params;
      return { rows: [] };
    }
  });
  assert.equal(folder, 'folder-1');
  assert.equal(savedFolderId, 'folder-1');

  const deleted = [];
  const now = Date.now();
  const removed = await deleteExpiredBackups({
    files: {
      list: async () => ({
        data: {
          files: [
            {
              id: 'old-owned',
              createdTime: new Date(now - 31 * 86400000).toISOString(),
              parents: ['folder-1'],
              appProperties: { app: 'fullpassword', type: 'backup', format: 'v2' }
            },
            {
              id: 'old-foreign',
              createdTime: new Date(now - 31 * 86400000).toISOString(),
              parents: ['folder-1'],
              appProperties: { app: 'other', type: 'backup', format: 'v2' }
            },
            {
              id: 'new-owned',
              createdTime: new Date(now).toISOString(),
              parents: ['folder-1'],
              appProperties: { app: 'fullpassword', type: 'backup', format: 'v2' }
            }
          ]
        }
      }),
      delete: async ({ fileId }) => deleted.push(fileId)
    }
  }, 'folder-1', 30);
  assert.equal(removed, 1);
  assert.deepEqual(deleted, ['old-owned']);

  const duplicateRun = await beginRun({
    triggerType: 'scheduled',
    scheduledSlot: '2026-07-25T02:00@America/Sao_Paulo'
  }, { query: async () => ({ rows: [] }) });
  assert.equal(duplicateRun, null);

  const schedule = {
    enabled: true,
    schedule_enabled: true,
    schedule_days: [6],
    schedule_times: ['02:00']
  };
  const dueDate = new Date('2026-07-25T05:00:00.000Z');
  assert.match(getScheduledSlot(schedule, dueDate), /^2026-07-25T02:00@/);
  assert.ok(getNextExecutionAt(schedule, new Date('2026-07-25T04:58:00.000Z')));

  const sanitized = sanitizeDriveError({ response: { status: 500, data: { error: 'secret details' } } });
  assert.equal(sanitized.message.includes('secret details'), false);

  const database = require('../src/config/database');
  const originalQuery = database.query;
  database.query = async () => ({ rows: [] });
  try {
    const { getOAuthConfig } = require('../src/controllers/googleDriveBackupController');
    const response = {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      }
    };
    await getOAuthConfig({
      user: {
        id: '00000000-0000-0000-0000-000000000002',
        email: 'user@example.test',
        role: 'user',
        is_super_admin: false
      },
      ip: '127.0.0.1',
      get: () => 'test-agent'
    }, response);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.payload, { error: 'Acesso restrito ao Super Admin.' });
  } finally {
    database.query = originalQuery;
  }

  const serviceSource = read('src/services/googleDriveBackupService.js');
  assert.match(serviceSource, /uploadType: 'resumable'/);
  assert.match(serviceSource, /cleanupBackupWorkspace\(workspace\)/);
  assert.doesNotMatch(controller, /refresh_token|access_token|client_secret/i);
  console.log('Google Drive backup tests passed.');
};

run()
  .then(() => require('../src/config/database').pool.end())
  .catch(async (error) => {
    console.error(error);
    await require('../src/config/database').pool.end();
    process.exitCode = 1;
  });
