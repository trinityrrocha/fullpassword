import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
assert.doesNotMatch(card, /refresh_token|access_token|client_secret/i);
assert.match(card, /if \(!isSuperAdmin\) return null/);
assert.match(settings, /isSuperAdmin=\{canManageSystem\}/);
assert.match(settings, /GoogleDriveBackupCard/);

console.log('Google Drive backup frontend tests passed.');
