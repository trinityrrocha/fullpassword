import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const menu = read('src/components/SecurityNotificationsMenu.jsx');
const layout = read('src/layouts/DashboardLayout.jsx');
const settings = read('src/pages/Settings.jsx');

assert.match(layout, /api\.get\('\/system\/security-notifications'\)/);
assert.match(layout, /<SecurityNotificationsMenu/);
assert.match(menu, /items\.slice\(0, MAX_NOTIFICATIONS\)/);
assert.match(menu, /const MAX_NOTIFICATIONS = 10/);
assert.match(menu, /Nenhuma notificação recente\./);
assert.match(menu, /Auditoria do sistema para mais informações/);
assert.match(menu, /onNavigate\('\/settings\?section=audit'\)/);
assert.match(menu, /document\.addEventListener\('mousedown', handleOutsideClick\)/);
assert.match(menu, /event\.key !== 'Escape'/);
assert.match(menu, /aria-expanded=\{isOpen\}/);
assert.match(menu, /notifications\?\.unread_count > 0/);
assert.doesNotMatch(menu, /item\.(?:metadata|payload|password|token|recovery_code|hash|private_key|wrapped_key)/);
assert.match(settings, /searchParams\.get\('section'\) === 'audit'/);
assert.match(settings, /initialOpenAccordion=\{requestedAccordion\}/);

console.log('Security notifications frontend tests passed.');
