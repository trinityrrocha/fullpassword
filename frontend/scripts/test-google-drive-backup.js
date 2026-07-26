import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const card = read('src/components/CloudBackupCard.jsx');
const googlePanel = read('src/components/GoogleDriveProviderPanel.jsx');
const settings = read('src/pages/Settings.jsx');

assert.match(card, /title="Backup Nuvem"/);
assert.match(card, /\['google_drive', 'Google Drive'\]/);
assert.match(card, /\['backblaze_b2', 'Backblaze B2'\]/);
assert.match(card, /\['mega_s3', 'Mega S3'\]/);
assert.match(card, /\['ftp', 'FTP'\]/);
assert.match(card, /role="switch"/);
assert.match(card, /aria-checked=\{active\}/);
assert.match(card, /status\.active_provider === provider/);
assert.match(card, /window\.confirm\('Ao ativar este provedor/);
assert.match(card, /api\.put\('\/cloud-backup\/provider'/);
assert.match(card, /status\.active_provider === 'google_drive'/);
assert.match(card, /Endpoint S3/);
assert.match(card, /Application Key \/ Secret Key/);
assert.match(card, /Mega Object Storage \/ S4/);
assert.match(card, /FTP \/ FTPS/);
assert.match(card, /Usar FTPS/);
assert.match(card, /Backup Nuvem ativo/);
assert.match(card, /Agendamento ativo/);
assert.match(card, /Backup V2/);
assert.match(card, /Frase de criptografia/);
assert.match(card, /Últimas execuções/);
assert.match(card, /provider: status\.active_provider/);
assert.match(card, /access_key: ''/);
assert.match(card, /secret_key: ''/);
assert.match(card, /username: ''/);
assert.match(card, /password: ''/);
assert.doesNotMatch(card, /localStorage|sessionStorage/);

assert.match(googlePanel, /Configuração OAuth/);
assert.match(googlePanel, /\/integrations\/google-drive\/oauth-config/);
assert.match(googlePanel, /\/integrations\/google-drive\/oauth\/start|\/integrations\/google-drive\/oauth\/start/);
assert.match(googlePanel, /Conectar Google Drive/);
assert.match(googlePanel, /clientSecret: ''/);
assert.doesNotMatch(googlePanel, /localStorage|sessionStorage|refresh_token|access_token/);

assert.match(settings, /import CloudBackupCard/);
assert.match(settings, /<CloudBackupCard isSuperAdmin=\{canManageSystem\}/);
assert.doesNotMatch(settings, /<GoogleDriveBackupCard/);

console.log('Cloud Backup frontend tests passed.');
