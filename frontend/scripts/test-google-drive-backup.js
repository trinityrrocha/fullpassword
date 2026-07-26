import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE,
  GOOGLE_DRIVE_OAUTH_SETUP_MESSAGE,
  getGoogleDriveActionError,
  normalizeGoogleDriveStatus,
  validateGoogleDriveSettingsSave
} from '../src/utils/googleDriveBackupUiState.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const card = fs.readFileSync(path.join(root, 'src/components/GoogleDriveBackupCard.jsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/pages/Settings.jsx'), 'utf8');

assert.match(card, /Conectar Google Drive/);
assert.match(card, /settings\.google_email/);
assert.match(card, /schedule_days/);
assert.match(card, /schedule_times/);
assert.match(card, /\[7, 15, 30, 60\]/);
assert.match(card, /\/integrations\/google-drive\/test/);
assert.match(card, /\/integrations\/google-drive\/backup-now/);
assert.match(card, /window\.confirm\('Desconectar/);
assert.doesNotMatch(card, /refresh_token|access_token/);
assert.match(card, /if \(!isSuperAdmin\) return null/);
assert.match(card, /Configuração OAuth Google Drive/);
assert.match(card, /\/integrations\/google-drive\/oauth-config/);
assert.match(card, /api\.put\('\/integrations\/google-drive\/oauth-config'/);
assert.match(card, /clientSecret: ''/);
assert.doesNotMatch(card, /localStorage|sessionStorage/);
assert.match(card, /disabled=\{!settings\.oauth_configured \|\| Boolean\(action\)\}/);
assert.match(card, /disabled=\{!canConfigure\}/);
assert.match(card, /validateGoogleDriveSettingsSave\(settings\)/);
assert.match(settings, /isSuperAdmin=\{canManageSystem\}/);
assert.match(settings, /GoogleDriveBackupCard/);

const serverMissing = normalizeGoogleDriveStatus({
  server_configured: false,
  oauth_configured: false,
  connected: false,
  enabled: true,
  schedule_enabled: true
});
assert.equal(serverMissing.enabled, false);
assert.equal(serverMissing.schedule_enabled, false);
assert.equal(validateGoogleDriveSettingsSave(serverMissing), GOOGLE_DRIVE_OAUTH_SETUP_MESSAGE);

const disconnected = normalizeGoogleDriveStatus({
  server_configured: true,
  oauth_configured: true,
  connected: false,
  enabled: true,
  schedule_enabled: true
});
assert.equal(disconnected.enabled, false);
assert.equal(disconnected.schedule_enabled, false);
assert.equal(validateGoogleDriveSettingsSave(disconnected), GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE);

const connected = normalizeGoogleDriveStatus({
  server_configured: true,
  oauth_configured: true,
  connected: true,
  enabled: true,
  schedule_enabled: true
});
assert.equal(connected.enabled, true);
assert.equal(connected.schedule_enabled, true);
assert.equal(validateGoogleDriveSettingsSave(connected), '');

assert.deepEqual(
  getGoogleDriveActionError({ response: { data: { code: 'GOOGLE_DRIVE_NOT_CONNECTED' } } }, 'fallback'),
  { expected: true, message: GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE }
);
assert.equal(
  getGoogleDriveActionError({ response: { data: { code: 'GOOGLE_DRIVE_PASSPHRASE_REQUIRED' } } }, 'fallback').message,
  'Defina a frase de criptografia do Backup V2 antes de ativar a rotina.'
);

console.log('Google Drive backup frontend tests passed.');
