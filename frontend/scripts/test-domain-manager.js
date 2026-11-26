import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dm from '../src/utils/domainManager.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

assert.deepEqual(dm.parseDomainList('A.com, b.com;\nb.com  C.COM\n\n'), ['a.com', 'b.com', 'c.com']);
assert.deepEqual(dm.parseDomainList(''), []);
assert.deepEqual(dm.parseDomainList(null), []);

const expiry = (days) => dm.expiryInfo({ expires_on: '2027-03-05', days_left: days });
assert.deepEqual(expiry(120), { text: '05/03/27', note: 'em 120 dias', tone: 'ok' });
assert.equal(expiry(30).tone, 'warning');
assert.equal(expiry(1).note, 'em 1 dia');
assert.deepEqual([expiry(0).note, expiry(0).tone], ['vence hoje', 'danger']);
assert.deepEqual([expiry(-3).note, expiry(-3).tone], ['venceu há 3 dias', 'danger']);
assert.deepEqual(dm.expiryInfo(null), { text: '—', note: '', tone: 'muted' });
assert.equal(dm.expiryInfo({ expires_on: null }).note, 'sem data');

assert.equal(dm.lookupLabel(null), 'Aguardando consulta');
assert.equal(dm.lookupLabel({ lookup_status: 'not_found' }), 'Não registrado');
assert.equal(dm.errorLabel('RATE_LIMITED').includes('limitou'), true);
assert.equal(dm.errorLabel(''), '');
assert.equal(dm.sslLabel('none'), 'Sem HTTPS');
assert.equal(dm.sslLabel(undefined), '—');
assert.equal(dm.changeValue('expires_on', '2027-05-01'), '01/05/27');
assert.equal(dm.changeValue('dnssec', 'true'), 'ativo');
assert.equal(dm.changeValue('nameservers', null), '—');
assert.equal(dm.dnssecLabel(null), '—');

assert.equal(dm.alertsLabel({ enabled: false, emails: 3, notify_admins: true }), '');
assert.equal(dm.alertsLabel({ enabled: true, emails: 1, notify_admins: false }), 'Alertas ativos (1 e-mail)');
assert.equal(dm.alertsLabel({ enabled: true, emails: 2, notify_admins: true }), 'Alertas ativos (2 e-mails + administradores)');
assert.equal(dm.alertsLabel({ enabled: true, emails: 0, notify_admins: true }), 'Alertas ativos (administradores)');
assert.equal(dm.alertsLabel(null), '');
assert.deepEqual(['a@b.co', ' a@b.co ', 'a@b', 'a b@c.com', '', null].map(dm.isValidEmail), [true, true, false, false, false, false]);
assert.equal(dm.canSaveAlerts({ enabled: false, notify_admins: false, emails: [] }), true);
assert.equal(dm.canSaveAlerts({ enabled: true, notify_admins: false, emails: [] }), false);
assert.equal(dm.canSaveAlerts({ enabled: true, notify_admins: true, emails: [] }), true);
assert.equal(dm.canSaveAlerts({ enabled: true, notify_admins: false, emails: ['a@b.co'] }), true);

// Wiring: route, menu entry (module-gated) and the module card link exist.
assert.match(read('src/App.jsx'), /path="\/domains" element=\{<DomainManager \/>\}/);
assert.match(read('src/layouts/DashboardLayout.jsx'), /modules\.domain_manager === true/);
assert.match(read('src/components/ModulesCard.jsx'), /domain_manager: \{ href: '\/domains'/);
assert.match(read('src/pages/DomainManager.jsx'), /SearchAlert/);
assert.match(read('src/pages/DomainManager.jsx'), /<Settings className="h-5 w-5"/, 'the per-domain gear is the lucide Settings icon');
console.log('domain manager frontend tests passed');
