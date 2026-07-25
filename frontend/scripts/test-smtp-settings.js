import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const card = read('src/components/SmtpSettingsCard.jsx');
const settingsPage = read('src/pages/Settings.jsx');

assert.match(card, /api\.get\('\/system\/smtp'\)/);
assert.match(card, /api\.put\('\/system\/smtp'/);
assert.match(card, /api\.post\('\/system\/smtp\/test'/);
assert.match(card, /Preencha apenas para alterar a senha SMTP/);
assert.match(card, /new FormData\(form\)\.get\('password'\)/);
assert.match(card, /passwordInput\.value = ''/);
assert.match(card, /Uma senha SMTP já está salva e não será exibida/);
assert.match(card, /Ela não permite recuperar cofres sem a senha mestre em uma arquitetura Zero-Knowledge/);
assert.match(card, /if \(!isSuperAdmin\) return null/);
assert.doesNotMatch(card, /value=\{settings\.password\}/);
assert.doesNotMatch(card, /encrypted_password/);
assert.doesNotMatch(card, /(?:localStorage|sessionStorage|indexedDB)/);
assert.doesNotMatch(card, /console\.(?:log|warn|error)/);
assert.match(settingsPage, /<SmtpSettingsCard isSuperAdmin=\{canManageSystem\} \/>/);

console.log('SMTP settings frontend tests passed.');
