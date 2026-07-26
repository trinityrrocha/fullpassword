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

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const {
  DRIVE_SCOPE,
  saveConnection,
  sanitizeSettings
} = require('../src/services/googleDriveBackupSettingsService');
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
  assert.match(controller, /isSuperAdmin\(req\.user\)/);

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

  await assert.rejects(
    () => consumeOAuthState('state-that-is-long-enough-for-validation-0000', { query: async () => ({ rows: [] }) }),
    (error) => error.code === 'GOOGLE_DRIVE_INVALID_STATE'
  );

  let encryptedToken;
  await saveConnection({ refreshToken: 'refresh-token-plain-test', googleEmail: 'admin@example.test' }, 'user-id', {
    query: async (_text, params) => {
      encryptedToken = params[1];
      return {
        rows: [{
          connected: true,
          google_email: params[0],
          encrypted_refresh_token: params[1],
          scope: DRIVE_SCOPE,
          backup_format: 'v2',
          schedule_days: [0],
          schedule_times: ['02:00'],
          retention_days: 30
        }]
      };
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
