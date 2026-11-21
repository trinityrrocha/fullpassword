/* global process */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = process.env.SPFBL_UI_EVIDENCE_DIR;
if (evidence) fs.mkdirSync(evidence, { recursive: true });

// The real Modules card, SPFBL page and menu hook run against the real api client (CSRF + reauthentication
// retry); only the network is simulated. Nothing here can reach a real installation or any external service.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import ModulesCard from '/src/components/ModulesCard.jsx';
import Spfbl from '/src/pages/Spfbl.jsx';
import useModulesMenu from '/src/hooks/useModulesMenu.js';
import api from '/src/services/api.js';
import '/src/index.css';
api.defaults.baseURL='/api';
window.__reauth=[];
window.addEventListener('fullpassword:reauth',event=>{window.__reauth.push({purpose:event.detail.purpose,action:event.detail.action});event.detail.resolve(window.__refuseReauth?null:'SYNTHETIC_GRANT');});
function MenuProbe(){const {modules}=useModulesMenu('user-1');return <nav aria-label="Menu de teste">{modules.spfbl===true&&<a href="/spfbl" data-menu-spfbl>SPFBL</a>}</nav>;}
const view=new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')).render(<MemoryRouter><main className="mx-auto max-w-5xl p-4">{view==='settings'?<><MenuProbe/><ModulesCard/></>:<Spfbl/>}</main></MemoryRouter>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'spfbl-isolated-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:spfbl-fixture') return '\0spfbl-fixture.jsx'; },
  load(id) { if (id === '\0spfbl-fixture.jsx') return fixture; },
  transform(code, id) { if (id === '\0spfbl-fixture.jsx') return transformWithOxc(code, 'spfbl-fixture.jsx'); },
  configureServer(server) {
    server.middlewares.use('/__spfbl_fixture', async (_req, res, next) => {
      try {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__spfbl_fixture', '<html lang="pt-BR"><head><title>SPFBL — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:spfbl-fixture";</script></body></html>'));
      } catch (error) { next(error); }
    });
  }
}] });

const SECRETS = ['MATRIX_PASSWORD_SENTINEL_x1', 'WHMTOKENSENTINEL0123456789ABCDEF'];
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const newState = () => ({
  enabled: false, role: 'super_admin', failToggle: false, calls: [], whmCooldown: false,
  settings: { matrix_user: 'ops@example.com', has_matrix_password: true, whm_host: 'srv.example.com', whm_user: 'root', has_whm_token: true, domain_sync_at: null, domain_sync_status: null, updated_at: '2026-11-21T00:00:00Z' },
  domains: [
    ...Array.from({ length: 120 }, (_, i) => ({ id: uid(100 + i), name: `site${String(i).padStart(3, '0')}.example.com`, source: 'whm', cpanel_user: `acct${i % 7}`, suspended: i % 10 === 0, active: i % 10 !== 0, last_seen_at: null, created_at: '2026-11-20T00:00:00Z' })),
    { id: uid(900), name: 'manual.example.org', source: 'manual', cpanel_user: null, suspended: false, active: true, last_seen_at: null, created_at: '2026-11-20T00:00:00Z' }
  ],
  users: [
    { id: uid(1), name: 'Root Admin', email: 'root@example.com', is_active: true, is_super_admin: true, role: 'admin' },
    { id: uid(2), name: 'Ana Souza', email: 'ana@example.com', is_active: true, is_super_admin: false, role: 'user' },
    { id: uid(3), name: 'Bruno Lima', email: 'bruno@example.com', is_active: true, is_super_admin: false, role: 'user' },
    { id: uid(4), name: 'Carla Inativa', email: 'carla@example.com', is_active: false, is_super_admin: false, role: 'user' },
    { id: uid(5), name: 'Davi Granted', email: 'davi@example.com', is_active: true, is_super_admin: false, role: 'user' }
  ],
  grants: [{ user_id: uid(5), name: 'Davi Granted', email: 'davi@example.com', role: 'user', user_active: true, unlock_mode: 'direct', created_at: '', updated_at: '', domains: [{ id: uid(900), name: 'manual.example.org', active: true }] }],
  ownScope: { role: 'user', unlock_mode: 'review', domains: [{ id: uid(900), name: 'manual.example.org', active: true }] }
});
let state = newState();

let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await context.addCookies([{ name: 'fp_csrf', value: 'SYNTHETIC_CSRF', url: origin }]);
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  const consoleErrors = []; page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const overview = () => (state.role === 'user' ? state.ownScope : {
    role: 'super_admin', matrix_configured: state.settings.has_matrix_password && Boolean(state.settings.matrix_user), whm_configured: state.settings.has_whm_token && Boolean(state.settings.whm_host),
    domain_sync_at: state.settings.domain_sync_at, domain_sync_status: state.settings.domain_sync_status,
    domains: { total: state.domains.length, active: state.domains.filter((d) => d.active).length }, users_with_access: state.grants.length
  });
  const reauthGate = (route, body, purpose) => {
    if (body._reauth_token === undefined) { route.fulfill({ status: 403, json: { error: 'Confirme sua identidade para esta alteração.', code: 'REAUTH_REQUIRED', purpose } }); return false; }
    assert.equal(body._reauth_token, 'SYNTHETIC_GRANT', 'the retry carries the grant the dialog returned');
    return true;
  };

  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    assert.equal(url.origin, origin, 'the fixture must never reach a real installation or external service');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = request.method(); const api = url.pathname.slice(4);
    const body = request.postData() ? request.postDataJSON() : {};
    state.calls.push({ method, api, body });
    if (method !== 'GET') assert.equal(request.headers()['x-csrf-token'], 'SYNTHETIC_CSRF', `${method} ${api} carries the CSRF token`);
    const json = (data, status = 200) => route.fulfill({ status, json: data });

    if (api === '/system/modules/menu') return json({ modules: { spfbl: state.enabled } });
    if (api === '/system/modules' && method === 'GET') return json({ modules: [{ key: 'spfbl', name: 'SPFBL', description: 'Consulta e gestão de bloqueios de e-mail do Matrix SPFBL.', enabled: state.enabled }] });
    if (api === '/system/modules/spfbl' && method === 'PUT') {
      if (!reauthGate(route, body, 'modules_settings:spfbl')) return;
      if (state.failToggle) return json({ error: 'Não foi possível alterar o módulo.' }, 500);
      state.enabled = body.enabled; return json({ module: { key: 'spfbl', name: 'SPFBL', description: 'x', enabled: state.enabled, updated_at: '' } });
    }
    if (api === '/spfbl/overview') return state.enabled ? json(overview()) : json({ error: 'Módulo não está ativo.', code: 'MODULE_DISABLED' }, 404);
    if (api === '/spfbl/settings' && method === 'GET') return json(state.settings);
    if (api === '/spfbl/settings' && method === 'PUT') {
      if (!reauthGate(route, body, 'spfbl_settings')) return;
      const reentry = (body.matrix_user !== undefined && body.matrix_user !== state.settings.matrix_user && state.settings.has_matrix_password && !body.matrix_password && !body.remove_matrix_credentials)
        || ((body.whm_host !== undefined && body.whm_host !== state.settings.whm_host) && state.settings.has_whm_token && !body.whm_token && !body.remove_whm_token);
      if (reentry) return json({ code: 'SPFBL_SECRET_REENTRY_REQUIRED', error: 'Informe novamente a senha.' }, 400);
      if (body.matrix_user !== undefined) state.settings.matrix_user = body.matrix_user;
      if (body.matrix_password) state.settings.has_matrix_password = true;
      if (body.remove_matrix_credentials) { state.settings.has_matrix_password = false; state.settings.matrix_user = ''; }
      if (body.whm_host !== undefined) { state.settings.whm_host = body.whm_host; state.settings.whm_user = body.whm_user; }
      if (body.whm_token) state.settings.has_whm_token = true;
      if (body.remove_whm_token) state.settings.has_whm_token = false;
      return json(state.settings);
    }
    if (api === '/spfbl/matrix/test') return json({ ok: true, message: 'Conexão com o Matrix confirmada.' });
    if (api === '/spfbl/whm/test') return json({ accounts: 7, domains: 121, active: 109, suspended: 12, skipped: 0 });
    if (api === '/spfbl/domains/sync') {
      if (state.whmCooldown) return json({ code: 'SPFBL_WHM_COOLDOWN', error: 'Aguarde 30 segundos entre consultas ao WHM.', retry_after_seconds: 21 }, 429);
      state.whmCooldown = true; state.settings.domain_sync_at = '2026-11-21T12:00:00Z'; state.settings.domain_sync_status = 'ok';
      return json({ accounts: 7, domains: 121, active: 109, suspended: 12, skipped: 1, added: 0, updated: 121, deactivated: 0 });
    }
    if (api === '/spfbl/domains' && method === 'GET') return json({ domains: state.domains });
    if (api === '/spfbl/domains' && method === 'POST') {
      if (state.domains.some((d) => d.name === body.name.toLowerCase())) return json({ code: 'SPFBL_DOMAIN_EXISTS', error: 'Este domínio já está cadastrado.' }, 409);
      const domain = { id: uid(950 + state.domains.length), name: body.name.toLowerCase(), source: 'manual', cpanel_user: null, suspended: false, active: true };
      state.domains.push(domain); return json({ domain }, 201);
    }
    const removal = /^\/spfbl\/domains\/([0-9a-f-]+)$/.exec(api);
    if (removal && method === 'DELETE') { state.domains = state.domains.filter((d) => d.id !== removal[1]); return json({ removed: true }); }
    if (api === '/spfbl/access' && method === 'GET') return json({ access: state.grants });
    if (api === '/users') return json(state.users);
    const access = /^\/spfbl\/access\/([0-9a-f-]+)$/.exec(api);
    if (access && method === 'PUT') {
      if (!reauthGate(route, body, `spfbl_access:${access[1]}`)) return;
      const target = state.users.find((u) => u.id === access[1]);
      const domains = body.domain_ids.map((id) => state.domains.find((d) => d.id === id)).filter(Boolean).map((d) => ({ id: d.id, name: d.name, active: d.active }));
      state.grants = [...state.grants.filter((g) => g.user_id !== access[1]), { user_id: target.id, name: target.name, email: target.email, role: 'user', user_active: true, unlock_mode: body.unlock_mode, domains }];
      return json({ access: state.grants.find((g) => g.user_id === access[1]) });
    }
    if (access && method === 'DELETE') {
      if (!reauthGate(route, body, `spfbl_access:${access[1]}`)) return;
      state.grants = state.grants.filter((g) => g.user_id !== access[1]); return json({ revoked: true });
    }
    return json({ error: `Unexpected ${method} ${api}` }, 500);
  });

  const open = async (view) => { await page.goto(`${origin}/__spfbl_fixture?view=${view}`); };
  const reauthSeen = () => page.evaluate(() => window.__reauth);
  const noOverflow = async (label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal scroll`);
  const shot = async (name) => { if (evidence) await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true }); };

  // ================= 1. Settings > Módulos: keyboard toggle, reauthentication, pessimistic update, menu refresh =================
  await open('settings');
  assert.equal(await page.locator('[data-menu-spfbl]').count(), 0, 'module off: no icon in the menu');
  await page.getByRole('button', { name: /Módulos/ }).click();
  const toggle = page.getByRole('switch', { name: 'SPFBL' });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.match(await toggle.getAttribute('aria-describedby'), /description/);
  state.failToggle = true;
  await toggle.focus(); await page.keyboard.press('Space');
  await page.getByRole('alert').filter({ hasText: 'Não foi possível alterar o módulo' }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'a refused change never moves the switch');
  assert.equal(await page.locator('[data-menu-spfbl]').count(), 0);
  state.failToggle = false; state.calls.length = 0;
  await toggle.press('Space');
  await page.getByRole('status').filter({ hasText: 'SPFBL ativado' }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  const reauth = await reauthSeen();
  assert.deepEqual(reauth.at(-1), { purpose: 'modules_settings:spfbl', action: { enabled: true } }, 'the grant is requested for exactly this action and module');
  assert.deepEqual(state.calls.filter((c) => c.method === 'PUT').map((c) => [c.body.enabled, c.body._reauth_token]), [[true, undefined], [true, 'SYNTHETIC_GRANT']], 'first attempt is refused with REAUTH_REQUIRED, the retry carries the grant');
  await page.locator('[data-menu-spfbl]').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Abrir o SPFBL' }).getAttribute('href'), '/spfbl');
  await shot('modules-card-light');
  await page.evaluate(() => { window.__refuseReauth = true; });
  await toggle.press('Space');
  await page.getByRole('alert').filter({ hasText: /Confirme sua identidade/ }).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'cancelling the reauthentication changes nothing');
  await page.evaluate(() => { window.__refuseReauth = false; });
  await toggle.press('Space');
  await page.getByRole('status').filter({ hasText: 'SPFBL desativado' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-menu-spfbl]'));

  // ================= 2. Module off: the page explains instead of failing silently =================
  state.enabled = false;
  await open('page');
  await page.getByRole('alert').filter({ hasText: 'Configurações → Módulos' }).waitFor();
  assert.equal(await page.getByText('Conexão Matrix SPFBL').count(), 0);

  // ================= 3. Super Admin page =================
  state = newState(); state.enabled = true;
  await open('page');
  await page.getByRole('heading', { level: 1, name: 'SPFBL' }).waitFor();
  await page.getByRole('heading', { name: 'Conexão Matrix SPFBL' }).waitFor();
  const summary = await page.locator('dl').innerText();
  assert.match(summary, /Matrix\s+Configurado/); assert.match(summary, /Domínios ativos\s+109 de 121/); assert.match(summary, /Usuários com acesso\s+1/);
  // Secrets: never prefilled, kept when blank, cleared after saving, absent from DOM and storage.
  const matrixPassword = page.getByLabel('Senha Matrix'); const whmToken = page.getByLabel('Token WHM');
  assert.equal(await matrixPassword.inputValue(), ''); assert.equal(await whmToken.inputValue(), '');
  assert.equal(await matrixPassword.getAttribute('type'), 'password'); assert.equal(await whmToken.getAttribute('type'), 'password');
  assert.match(await page.getByText('Há uma senha salva. Deixe em branco para mantê-la.').innerText(), /mantê-la/);
  // Changing the user without re-entering the password: the server refuses and the UI explains why.
  await page.getByLabel('Usuário Matrix').fill('other@example.com');
  await page.getByRole('button', { name: 'Salvar' }).first().click();
  await page.getByRole('alert').filter({ hasText: 'digite novamente a senha ou o token' }).waitFor();
  assert.equal(state.settings.matrix_user, 'ops@example.com');
  state.calls.length = 0;
  await matrixPassword.fill(SECRETS[0]);
  await page.getByRole('button', { name: 'Salvar' }).first().click();
  await page.getByRole('status').filter({ hasText: 'Configuração do Matrix salva.' }).waitFor();
  const save = state.calls.filter((c) => c.method === 'PUT' && c.api === '/spfbl/settings').at(-1);
  assert.deepEqual(Object.keys(save.body).sort(), ['_reauth_token', 'matrix_password', 'matrix_user'], 'the Matrix form sends only its own fields');
  assert.equal(await matrixPassword.inputValue(), '', 'the secret field is cleared after saving');
  assert.equal((await reauthSeen()).at(-1).purpose, 'spfbl_settings');
  await page.getByRole('button', { name: 'Testar conexão salva' }).click();
  await page.getByRole('status').filter({ hasText: 'Conexão com o Matrix confirmada' }).waitFor();
  // WHM: save with a token, test (writes nothing), sync, cool-down.
  await whmToken.fill(SECRETS[1]);
  await page.getByRole('button', { name: 'Salvar' }).nth(1).click();
  await page.getByRole('status').filter({ hasText: 'Configuração do WHM salva.' }).waitFor();
  assert.equal(await whmToken.inputValue(), '');
  const whmSave = state.calls.filter((c) => c.method === 'PUT' && c.api === '/spfbl/settings').at(-1);
  assert.equal('matrix_user' in whmSave.body, false, 'the WHM form never touches the Matrix fields'); assert.equal(whmSave.body.whm_token, SECRETS[1]);
  await page.getByRole('button', { name: 'Testar conexão', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Conexão confirmada: 7 contas e 121 domínios (109 ativos). Nada foi gravado.' }).waitFor();
  await page.getByRole('button', { name: 'Sincronizar domínios' }).click();
  await page.getByRole('status').filter({ hasText: /Sincronizado: 121 domínios \(109 ativos, 12 de contas suspensas\); 0 novos, 121 atualizados, 0 desativados; 1 registros ignorados/ }).waitFor();
  await page.getByText(/Última sincronização bem-sucedida em/).waitFor();
  await page.getByRole('button', { name: 'Sincronizar domínios' }).click();
  await page.getByRole('alert').filter({ hasText: 'Aguarde 21 segundos antes de tentar de novo.' }).waitFor();
  // Changing the server asks for the token again, before any request.
  await page.getByLabel('Servidor (hostname)').fill('outro.example.com');
  await page.getByText('digite o token novamente para salvar').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sincronizar domínios' }).isDisabled(), true);
  await page.getByLabel('Servidor (hostname)').fill('srv.example.com');
  // Nothing secret anywhere in the page or in browser storage.
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  for (const secret of SECRETS) assert.equal(html.includes(secret), false, 'a secret must not appear in the DOM');
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);

  // ================= 4. Domains: 121 rows, filtered and paginated =================
  const list = page.getByRole('list', { name: 'Domínios do catálogo' });
  assert.equal(await list.getByRole('listitem').count(), 25, 'at most one page is rendered');
  await page.getByText(/121 de 121 domínios · página 1 de 5/).waitFor();
  await page.getByRole('navigation', { name: 'Paginação de domínios' }).getByRole('button', { name: 'Próxima' }).click();
  await page.getByText(/página 2 de 5/).waitFor();
  assert.equal(await list.getByRole('listitem').first().getByText('site025.example.com').count(), 1);
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('acct3');
  await page.getByText(/página 1 de 1|de 121 domínios\./).first().waitFor();
  const filtered = await list.getByRole('listitem').count();
  assert.ok(filtered > 0 && filtered < 25, `filter result ${filtered}`);
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('');
  await page.getByLabel('Situação').selectOption('inactive');
  await page.getByText(/12 de 121 domínios/).waitFor();
  assert.ok((await list.innerText()).includes('Conta suspensa'), 'the state is written out, not only coloured');
  await page.getByLabel('Situação').selectOption('all');
  await page.getByLabel('Cadastrar domínio à mão').fill('Novo.Example.com');
  await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'novo.example.com cadastrado.' }).waitFor();
  await page.getByLabel('Cadastrar domínio à mão').fill('novo.example.com');
  await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Este domínio já está cadastrado.' }).waitFor();
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('novo.example');
  await page.getByRole('button', { name: 'Remover novo.example.com' }).click();
  await page.getByText('Remover novo.example.com?').waitFor();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('status').filter({ hasText: 'novo.example.com removido.' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Remover site001.example.com' }).count(), 0, 'imported domains are not removable by hand');

  // ================= 5. Access: dialog, keyboard, scoped candidates, reauthentication per target =================
  await page.getByLabel('Buscar por domínio ou conta cPanel').fill('');
  const give = page.getByRole('button', { name: 'Dar acesso' });
  await give.click();
  const dialog = page.getByRole('dialog', { name: 'Dar acesso ao SPFBL' });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true, 'focus moves into the dialog');
  const options = await dialog.getByLabel('Usuário').locator('option').allInnerTexts();
  assert.deepEqual(options, ['Selecione um usuário', 'Ana Souza (ana@example.com)', 'Bruno Lima (bruno@example.com)'], 'no Super Admin, no inactive account, no account that already has access');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Dar acesso', 'focus returns to the trigger');
  await give.click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Salvar acesso' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Escolha o usuário, o modo e de 1 a 100 domínios.' }).waitFor();
  await dialog.getByLabel('Usuário').selectOption(uid(2));
  await dialog.getByRole('radio', { name: 'Desbloqueio direto' }).check();
  await dialog.getByPlaceholder('Filtrar domínios').fill('site00');
  await dialog.getByText(/0 domínios selecionados/).waitFor();
  const checkboxes = dialog.getByRole('checkbox');
  assert.equal(await checkboxes.count(), 10);
  await checkboxes.nth(1).check(); await checkboxes.nth(2).check();
  await dialog.getByText(/2 domínios selecionados/).waitFor();
  assert.equal(await dialog.getByText('(inativo)').count(), 1, 'the first row (suspended account) is flagged inactive');
  state.calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar acesso' }).click();
  await page.getByRole('status').filter({ hasText: 'Acesso de Ana Souza salvo.' }).waitFor();
  const put = state.calls.filter((c) => c.method === 'PUT' && c.api === `/spfbl/access/${uid(2)}`).at(-1);
  assert.deepEqual([put.body.unlock_mode, put.body.domain_ids, put.body._reauth_token], ['direct', [uid(101), uid(102)], 'SYNTHETIC_GRANT']);
  assert.equal((await reauthSeen()).at(-1).purpose, `spfbl_access:${uid(2)}`, 'the grant is bound to the target account');
  const grants = page.getByRole('list', { name: 'Usuários com acesso ao SPFBL' });
  await grants.getByText('Ana Souza').waitFor();
  assert.equal(await grants.getByRole('listitem').filter({ hasText: 'Ana Souza' }).getByText('Desbloqueio direto').count(), 1);
  await page.getByRole('button', { name: 'Editar acesso de Ana Souza' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Editar acesso ao SPFBL' }).getByLabel('Usuário').isDisabled(), true, 'the account cannot be switched while editing');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Revogar acesso de Ana Souza' }).click();
  await page.getByText('Revogar o acesso de Ana Souza?').waitFor();
  state.calls.length = 0;
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('status').filter({ hasText: 'Acesso de Ana Souza revogado.' }).waitFor();
  const revoke = state.calls.filter((c) => c.method === 'DELETE' && c.api === `/spfbl/access/${uid(2)}`).at(-1);
  assert.equal(revoke.body._reauth_token, 'SYNTHETIC_GRANT'); assert.equal((await reauthSeen()).at(-1).purpose, `spfbl_access:${uid(2)}`);
  assert.equal(await grants.getByText('Ana Souza').count(), 0);
  await shot('page-admin-light-1280');

  // ================= 6. Responsive + dark theme, no horizontal scroll =================
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const dark of [false, true]) {
      await page.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark);
      await noOverflow(`admin ${width}px ${dark ? 'dark' : 'light'}`);
      await shot(`page-admin-${width}-${dark ? 'dark' : 'light'}`);
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1280, height: 900 });

  // ================= 7. A granted account: its own scope only, never configuration =================
  state = newState(); state.enabled = true; state.role = 'user';
  state.ownScope = { role: 'user', unlock_mode: 'review', domains: [{ id: uid(900), name: 'manual.example.org', active: true }, { id: uid(901), name: 'inativo.example.org', active: false }] };
  state.calls.length = 0;
  await open('page');
  await page.getByRole('heading', { name: 'Seus domínios' }).waitFor();
  await page.getByText('Solicitar revisão ao administrador').first().waitFor();
  assert.equal(await page.getByText('manual.example.org').count(), 1);
  assert.equal(await page.getByText('Conexão Matrix SPFBL').count(), 0); assert.equal(await page.getByText('Acessos de usuários').count(), 0);
  assert.deepEqual([...new Set(state.calls.map((c) => c.api))], ['/spfbl/overview'], 'a granted account never even requests configuration, domains or grants');
  for (const dark of [false, true]) { await page.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark); await shot(`page-user-${dark ? 'dark' : 'light'}`); }
  await page.setViewportSize({ width: 390, height: 800 }); await noOverflow('granted user 390px');

  assert.deepEqual(pageErrors, [], 'no uncaught page errors');
  console.log(JSON.stringify({ spfblUi: 'PASS', moduleSwitch: 'keyboard + reauth bound to the action, pessimistic, menu refreshed', secrets: 'never prefilled, cleared after save, absent from DOM/storage', domains: '121 rows paginated 25/page, filter, manual add/remove', access: 'dialog focus/Escape/return, candidates scoped, reauth bound to target, revoke', responsive: [1280, 768, 390, 320], themes: ['light', 'dark'], grantedUser: 'own scope only' }));
} finally {
  await browser?.close();
  await vite.close();
}
