import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as spfbl from '../src/utils/spfbl.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readRepo = (file) => fs.readFileSync(path.join(root, '..', file), 'utf8');

// ---- Filtering and pagination (the catalogue can hold thousands of domains) ----
const domains = [
  { id: '1', name: 'alpha.example.com', source: 'whm', cpanel_user: 'alice', active: true, suspended: false },
  { id: '2', name: 'beta.example.com', source: 'whm', cpanel_user: 'bob', active: false, suspended: true },
  { id: '3', name: 'gamma.example.org', source: 'manual', cpanel_user: null, active: true, suspended: false },
  { id: '4', name: 'delta.example.net', source: 'whm', cpanel_user: 'alice', active: false, suspended: false }
];
assert.equal(spfbl.filterDomains(domains).length, 4);
assert.deepEqual(spfbl.filterDomains(domains, { query: 'ALICE' }).map((d) => d.id), ['1', '4'], 'matches the cPanel account, case-insensitively');
assert.deepEqual(spfbl.filterDomains(domains, { query: '  example.org ' }).map((d) => d.id), ['3']);
assert.deepEqual(spfbl.filterDomains(domains, { status: 'active' }).map((d) => d.id), ['1', '3']);
assert.deepEqual(spfbl.filterDomains(domains, { status: 'inactive' }).map((d) => d.id), ['2', '4']);
assert.deepEqual(spfbl.filterDomains(domains, { status: 'manual' }).map((d) => d.id), ['3']);
assert.deepEqual(spfbl.filterDomains(domains, { status: 'whm', query: 'a' }).map((d) => d.id), ['1', '2', '4']);
for (const bad of [null, undefined, 'x', {}, 5]) assert.deepEqual(spfbl.filterDomains(bad), []);
assert.deepEqual(spfbl.filterDomains([{ id: 'x' }], { query: 'a' }), [], 'rows without names never throw');

const many = Array.from({ length: 5000 }, (_, i) => i);
let view = spfbl.paginate(many, 1);
assert.deepEqual([view.items.length, view.pages, view.total, view.page], [20, 250, 5000, 1]);
assert.equal(spfbl.paginate(many, 250).items.length, 20); assert.equal(spfbl.paginate(many, 250).items[0], 4980); assert.equal(spfbl.paginate(many, 1, 100).items.length, 100);
for (const page of [0, -3, 'abc', null, undefined, NaN]) assert.equal(spfbl.paginate(many, page).page, 1, String(page));
assert.equal(spfbl.paginate(many, 9999).page, 250, 'clamped to the last page');
view = spfbl.paginate([], 3);
assert.deepEqual([view.items, view.pages, view.page, view.total], [[], 1, 1, 0]);
assert.equal(spfbl.paginate(null, 1).total, 0);

// ---- Labels: state is always text ----
assert.deepEqual(spfbl.domainState(domains[0]), { label: 'Ativo', tone: 'green' });
assert.equal(spfbl.domainState(domains[1]).label, 'Conta suspensa');
assert.equal(spfbl.domainState(domains[3]).label, 'Fora do servidor');
assert.equal(spfbl.domainState({ source: 'manual', active: false }).label, 'Inativo');
assert.equal(spfbl.describeSync(null, null), 'Nunca sincronizado.');
assert.match(spfbl.describeSync('2026-11-21T12:00:00Z', 'ok'), /^Última sincronização bem-sucedida em /);
assert.match(spfbl.describeSync('2026-11-21T12:00:00Z', 'failed:WHM_TIMEOUT'), /falhou \(WHM_TIMEOUT\)/);
assert.match(spfbl.describeSync(null, 'failed:WHM_DNS'), /falhou/);
assert.equal(spfbl.formatDateTime('not a date'), ''); assert.equal(spfbl.formatDateTime(null), '');
assert.match(spfbl.syncSummary({ domains: 4, active: 3, suspended: 1, added: 2, updated: 1, deactivated: 0, skipped: 2 }), /4 domínios \(3 ativos, 1 de contas suspensas\); 2 novos, 1 atualizados, 0 desativados; 2 registros ignorados/);
assert.doesNotMatch(spfbl.syncSummary({ domains: 1, active: 1, suspended: 0, skipped: 0 }), /novos|ignorados/);

// ---- Error messages: guidance for codes, the server's own text otherwise, never an object dump ----
const failure = (status, data) => ({ response: { status, data } });
assert.match(spfbl.describeError(failure(400, { code: 'SPFBL_SECRET_REENTRY_REQUIRED', error: 'x' }), 'f'), /digite novamente a senha ou o token/);
assert.equal(spfbl.describeError(failure(429, { code: 'SPFBL_WHM_COOLDOWN', retry_after_seconds: 17 }), 'f'), 'Aguarde 17 segundos antes de tentar de novo.');
assert.equal(spfbl.describeError(failure(429, { code: 'SPFBL_TEST_COOLDOWN' }), 'f'), 'Aguarde alguns segundos antes de tentar de novo.');
assert.equal(spfbl.describeError(failure(429, { error: 'Muitas requisições. Tente novamente em 12 segundos.' }), 'f'), 'Muitas requisições. Tente novamente em 12 segundos.');
assert.equal(spfbl.describeError(failure(429, {}), 'f'), 'Muitas tentativas. Aguarde um pouco e tente novamente.');
assert.match(spfbl.describeError(failure(404, { code: 'MODULE_DISABLED' }), 'f'), /Configurações → Módulos/);
assert.match(spfbl.describeError(failure(503, { code: 'CONFIG_ENCRYPTION_KEY_MISSING' }), 'f'), /CONFIG_ENCRYPTION_KEY/);
assert.equal(spfbl.describeError(failure(422, { error: 'Servidor inválido.' }), 'f'), 'Servidor inválido.');
for (const noisy of [new Error('boom'), null, undefined, {}, failure(500, null), failure(500, {})]) assert.equal(spfbl.describeError(noisy, 'fallback'), 'fallback');

// ---- Payloads: each form sends only its own fields; empty secrets are never sent ----
const form = { name: ' Servidor 1 ', host: ' SRV.example.com ', user: ' root ', token: '', matrixUser: ' ops@example.com ', matrixPassword: '' };
assert.deepEqual(spfbl.buildServerPayload(form), { name: 'Servidor 1', host: 'SRV.example.com', whm_user: 'root', matrix_user: 'ops@example.com' }, 'empty secrets are not sent');
assert.deepEqual(spfbl.buildServerPayload({ ...form, token: '  TOKEN0123456789ABCDEF ', matrixPassword: ' keep spaces ' }), { name: 'Servidor 1', host: 'SRV.example.com', whm_user: 'root', token: 'TOKEN0123456789ABCDEF', matrix_user: 'ops@example.com', matrix_password: ' keep spaces ' }, 'a token is trimmed, a password is sent exactly as typed');
assert.deepEqual(Object.keys(spfbl.buildServerPayload({ ...form, token: 'T0123456789ABCDEF', matrixPassword: 'p' }, { section: 'matrix' })).sort(), ['matrix_password', 'matrix_user'], 'the Matrix form never touches the WHM fields');
assert.deepEqual(Object.keys(spfbl.buildServerPayload({ ...form, token: 'T0123456789ABCDEF', matrixPassword: 'p' }, { section: 'whm' })).sort(), ['host', 'name', 'token', 'whm_user'], 'the WHM form never touches the Matrix fields');
assert.equal(spfbl.removalSummary({ domains_total: 0 }), 'Este servidor não tem domínios vinculados.'); assert.equal(spfbl.removalSummary({ domains_total: 1 }), 'Este servidor tem 1 domínio vinculado.'); assert.equal(spfbl.removalSummary({ domains_total: 7 }), 'Este servidor tem 7 domínios vinculados.');
assert.deepEqual(spfbl.serverSummary([{ matrix_configured: true }, { matrix_configured: false }]), { total: 2, withMatrix: 1 }); assert.deepEqual(spfbl.serverSummary(undefined), { total: 0, withMatrix: 0 });
assert.deepEqual(spfbl.filterDomains([{ id: 'a', name: 'a.com', no_server: true }, { id: 'b', name: 'b.com', no_server: false }], { status: 'no_server' }).map((d) => d.id), ['a'], 'domains without a server can be listed on their own');
assert.equal(spfbl.domainState({ active: false, source: 'whm', no_server: true }).label, 'Sem servidor de consulta');

// ---- Access editor rules mirror the server (1-100 domains, review|direct, active non-Super-Admin accounts) ----
assert.deepEqual(spfbl.toggleId(['a'], 'b'), ['a', 'b']); assert.deepEqual(spfbl.toggleId(['a', 'b'], 'a'), ['b']);
assert.equal(spfbl.selectionSummary(1), '1 domínio selecionado'); assert.equal(spfbl.selectionSummary(0), '0 domínios selecionados');
const ids = (n) => Array.from({ length: n }, (_, i) => `d${i}`);
assert.equal(spfbl.canSaveAccess('u1', 'review', ids(1)), true); assert.equal(spfbl.canSaveAccess('u1', 'direct', ids(100)), true);
assert.equal(spfbl.canSaveAccess('u1', 'review', ids(0)), false); assert.equal(spfbl.canSaveAccess('u1', 'review', ids(101)), false);
assert.equal(spfbl.canSaveAccess('', 'review', ids(1)), false); assert.equal(spfbl.canSaveAccess('u1', 'admin', ids(1)), false);
assert.equal(spfbl.MAX_DOMAINS_PER_USER, 100);
const users = [
  { id: 'a', name: 'Zed', is_active: true, is_super_admin: false }, { id: 'b', name: 'Ana', is_active: true, is_super_admin: false },
  { id: 'c', name: 'Inactive', is_active: false, is_super_admin: false }, { id: 'd', name: 'Null', is_active: null, is_super_admin: false },
  { id: 'e', name: 'Root', is_active: true, is_super_admin: true }, { id: 'f', name: 'Granted', is_active: true, is_super_admin: false }
];
assert.deepEqual(spfbl.grantableUsers(users, [{ user_id: 'f' }]).map((u) => u.id), ['b', 'a'], 'sorted, no inactive, no Super Admin, no existing grant');
assert.deepEqual(spfbl.grantableUsers(users, [{ user_id: 'f' }], 'f').map((u) => u.id), ['b', 'f', 'a'], 'the account being edited stays selectable');
assert.deepEqual(spfbl.grantableUsers(null, null), []);

// ---- Contract: every endpoint the UI calls exists in the backend routes, with the same method ----
const routes = readRepo('backend/src/routes/spfblRoutes.js');
const systemRoutes = readRepo('backend/src/routes/systemRoutes.js');
const backend = new Set([
  ...[...routes.matchAll(/^router\.(get|put|post|delete)\('([^']+)'/gm)].map((m) => `${m[1].toUpperCase()} /spfbl${m[2].replace(/:[A-Za-z]+/g, ':p')}`),
  ...[...systemRoutes.matchAll(/^router\.(get|put|post|delete)\('(\/modules[^']*)'/gm)].map((m) => `${m[1].toUpperCase()} /system${m[2].replace(/:[A-Za-z]+/g, ':p')}`),
  'GET /users'
]);
const service = read('src/services/spfblService.js');
const calls = [...service.matchAll(/api\.(get|put|post|delete)\(\s*[`']([^`']+)[`']/g)].map((m) => `${m[1].toUpperCase()} ${m[2].replace(/\$\{[^}]+\}/g, ':p')}`);
assert.ok(calls.length >= 15, `found ${calls.length} calls`);
for (const call of calls) assert.ok(backend.has(call), `the UI calls ${call}, which the backend does not serve`);

// ---- Static safety of the UI ----
const files = ['src/components/ModulesCard.jsx', 'src/pages/Spfbl.jsx', 'src/hooks/useModulesMenu.js', 'src/services/spfblService.js', 'src/utils/spfbl.js',
  ...fs.readdirSync(path.join(root, 'src/components/spfbl')).map((name) => `src/components/spfbl/${name}`)];
for (const file of files) {
  const source = read(file);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/, `${file} must not persist anything`);
  assert.doesNotMatch(source, /\b(alert|confirm|prompt)\(/, `${file}: no native dialogs (UX contract)`);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML/, `${file}: provider and user text is rendered as text`);
}
// Secret inputs (WHM token, Matrix password) live in the server dialog: uncontrolled, never prefilled, never in React state.
const serverDialog = read('src/components/spfbl/SpfblServerDialog.jsx');
assert.equal((serverDialog.match(/type="password"/g) || []).length, 2, 'WHM token and Matrix password');
for (const match of serverDialog.matchAll(/<input[^>]*type="password"[^>]*>/g)) {
  assert.match(match[0], /ref=\{/, 'secret inputs are uncontrolled'); assert.doesNotMatch(match[0], /\bvalue=/, 'a secret is never put back into a field');
}
assert.doesNotMatch(serverDialog, /useState\([^)]*(password|token)/i, 'secrets never enter React state');
assert.match(serverDialog, /tokenRef\.current\.value = ''/); assert.match(serverDialog, /passwordRef\.current\.value = ''/, 'secret fields are cleared after saving');
// Removing a server asks first and has no default answer.
const removeDialog = read('src/components/spfbl/SpfblRemoveServerDialog.jsx');
assert.match(removeDialog, /useState\(''\)/, 'no default choice'); assert.match(removeDialog, /disabled=\{busy \|\| !choice\}/, 'nothing happens until a choice is made');
const layout = read('src/layouts/DashboardLayout.jsx');
assert.match(layout, /modules\.spfbl === true \? \[\{ name: 'SPFBL', href: '\/spfbl', icon: Bug \}\]/);
assert.match(read('src/App.jsx'), /<Route path="\/spfbl" element=\{<Spfbl \/>\} \/>/);
assert.ok(read('src/App.jsx').indexOf('path="/spfbl"') < read('src/App.jsx').indexOf('requiredRole="admin"'), 'the page sits in the ProtectedRoute for any signed-in account; the server decides');
assert.match(read('src/pages/Settings.jsx'), /\{canManageSystem && <ModulesCard \/>\}/);
const card = read('src/components/ModulesCard.jsx');
assert.match(card, /role="switch"/); assert.match(card, /aria-checked=\{module\.enabled\}/); assert.match(card, /aria-labelledby=/);
assert.match(card, /setModules\(\(current\) => current\.map/, 'the switch moves only with the server answer');
assert.match(card, /MODULES_CHANGED_EVENT/, 'the menu is refreshed after a toggle');
const hook = read('src/hooks/useModulesMenu.js');
assert.match(hook, /catch \{ setModules\(\{\}\); \}/); assert.match(hook, /addEventListener\(MODULES_CHANGED_EVENT/);
assert.equal(spfbl.MODULES_CHANGED_EVENT, 'fullpassword:modules-changed');

console.log('PASS spfbl module (frontend): filter/paginate/labels/errors/payloads/access rules, UI-to-backend route contract, no persisted or prefilled secrets, no native dialogs, menu gated by the server.');
