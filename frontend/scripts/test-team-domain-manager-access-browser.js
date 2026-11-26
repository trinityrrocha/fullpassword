/* global process */
// "Gestão de Equipe": the Domain Manager access tab inside the user dialog (read only). Visible only for a Super Admin while the
// module is ON; saved AFTER the user, through the per-target endpoint; a failed access save is reported by name.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = `
import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import{AuthContext}from'/src/context/AuthContext.jsx';import TeamList from'/src/pages/TeamList.jsx';import api from'/src/services/api.js';import'/src/index.css';api.defaults.baseURL='/api';
const admin=new URLSearchParams(location.search).get('as')!=='admin';
const value={user:{id:'sa',name:'Admin fictício',email:'admin@example.invalid',role:'admin',is_super_admin:admin},masterKey:null,identityKeys:null,registerVaultLockCleanup:()=>()=>{}};
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthContext.Provider value={value}><main className="p-4"><TeamList/></main></AuthContext.Provider></BrowserRouter>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'team-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:team-fixture') return '\0team-fixture.jsx'; },
  load(id) { if (id === '\0team-fixture.jsx') return fixture; },
  transform(code, id) {
    if (id === '\0team-fixture.jsx') return transformWithOxc(code, 'team-fixture.jsx');
    if (id.replaceAll('\\', '/').endsWith('/src/context/AuthContext.jsx')) return code + '\nexport {AuthContext};';
  },
  configureServer(server) {
    server.middlewares.use('/__team', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__team', '<html lang="pt-BR"><head><title>Equipe</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:team-fixture"></script></body></html>')); });
  }
}] });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await context.addCookies([{ name: 'fp_csrf', value: 'SYNTHETIC_CSRF', url: origin }]);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const users = [{ id: uid(2), name: 'Ana Souza', email: 'ana@example.invalid', is_active: true, role: 'user', groups: [] }, { id: uid(3), name: 'Inativa Silva', email: 'in@example.invalid', is_active: false, role: 'user', groups: [] }];
  const domains = Array.from({ length: 6 }, (_, i) => ({ id: uid(100 + i), name: `site${i}.example.com` }));
  let dmOn = true; let spfblOn = false; let failAccess = false; let revoke404 = false; let grants = [{ user_id: uid(2), name: 'Ana Souza', email: 'ana@example.invalid', domains: [domains[0]], user_active: true }];
  const calls = [];
  await page.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    assert.equal(url.origin, origin);
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const body = req.postData() ? req.postDataJSON() : {};
    calls.push({ method: req.method(), path: url.pathname, body });
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (req.method() !== 'GET') assert.equal(req.headers()['x-csrf-token'], 'SYNTHETIC_CSRF');
    if (url.pathname === '/api/system/modules/menu') return json({ modules: { spfbl: spfblOn, domain_manager: dmOn } });
    if (url.pathname === '/api/users' && req.method() === 'GET') return json(users);
    if (url.pathname === '/api/groups') return json([]);
    if (url.pathname === '/api/auth/password-policy') return json({ login_min_length: 12, login_rotation_months: 12, vault_min_length: 16, vault_rotation_months: 12 });
    if (url.pathname === '/api/spfbl/domains') return json({ domains: [] });
    if (url.pathname === '/api/spfbl/access' && req.method() === 'GET') return json({ access: [] });
    if (url.pathname === '/api/domain-manager/access/domains') return json({ domains });
    if (url.pathname === '/api/domain-manager/access' && req.method() === 'GET') return json({ access: grants });
    if (url.pathname.startsWith('/api/domain-manager/access/')) {
      if (failAccess) return json({ error: 'Reautenticação recusada' }, 403);
      const id = url.pathname.split('/').pop();
      if (req.method() === 'DELETE') {
        if (revoke404) return json({ code: 'DM_ACCESS_NOT_FOUND', error: 'Acesso não encontrado.' }, 404);
        grants = grants.filter((g) => g.user_id !== id); return json({ revoked: true });
      }
      grants = [...grants.filter((g) => g.user_id !== id), { user_id: id, domains: domains.filter((d) => body.domain_ids.includes(d.id)) }];
      return json({ access: { user_id: id } });
    }
    if (url.pathname === '/api/users' && req.method() === 'POST') return json({ id: uid(9), name: body.name }, 201);
    if (url.pathname.startsWith('/api/users/') && req.method() === 'PUT') return json({ ok: true });
    throw new Error(`Unexpected fixture endpoint ${req.method()} ${url.pathname}`);
  });
  const open = async () => { await page.goto(`${origin}/__team`); await page.getByText('Ana Souza').first().waitFor(); };
  const editAna = async () => { await page.getByRole('row', { name: /Ana Souza/ }).getByRole('button', { name: 'Editar' }).click(); await page.getByRole('dialog', { name: 'Editar Usuário' }).waitFor(); };
  const dialog = page.getByRole('dialog', { name: 'Editar Usuário' });
  const TAB = 'Domain Manager';
  const ACCESS = /Dar acesso ao Domain Manager/;

  // 1. module OFF: no tab
  dmOn = false; await open(); await editAna();
  assert.equal(await dialog.getByRole('tab', { name: TAB }).count(), 0, 'no tab while the module is off');
  assert.equal(await dialog.getByRole('tab').count(), 0, 'and no tab bar at all');
  await page.keyboard.press('Escape');

  // 2. module ON: tab, existing grant loaded, read-only wording, no SPFBL-style mode choice; untouched tab never calls the API
  dmOn = true; await open(); await editAna();
  await dialog.getByRole('tab', { name: TAB }).click();
  const give = dialog.getByRole('checkbox', { name: ACCESS });
  await give.waitFor(); assert.equal(await give.isChecked(), true, 'the current grant is shown');
  assert.match(await dialog.getByRole('tabpanel', { name: TAB }).innerText(), /Somente leitura/);
  assert.equal(await dialog.getByRole('radio').count(), 0, 'no unlock mode: access is read only');
  assert.equal(await dialog.getByRole('checkbox', { name: 'site0.example.com' }).isChecked(), true);
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click(); await dialog.waitFor({ state: 'detached' });
  assert.equal(calls.some((c) => c.path.startsWith('/api/domain-manager/access/')), false, 'an untouched tab never calls the access endpoint (no needless reauthentication)');

  // 3. change the grant: the user first, then the access, with the chosen domains
  await editAna(); await dialog.getByRole('tab', { name: TAB }).click();
  await dialog.getByRole('checkbox', { name: 'site1.example.com' }).check();
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click(); await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.replace(uid(2), ':id')}`), ['PUT /api/users/:id', 'PUT /api/domain-manager/access/:id']);
  assert.deepEqual(calls.find((c) => c.path.startsWith('/api/domain-manager/access/')).body, { domain_ids: [domains[0].id, domains[1].id] });

  // 4. nothing selected is blocked on the tab; switching off revokes
  await editAna(); await dialog.getByRole('tab', { name: TAB }).click();
  await dialog.getByRole('checkbox', { name: 'site0.example.com' }).uncheck(); await dialog.getByRole('checkbox', { name: 'site1.example.com' }).uncheck();
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Escolha de 1 a 100 domínios para o acesso ao Domain Manager' }).waitFor();
  assert.equal(await dialog.getByRole('tab', { name: TAB }).getAttribute('aria-selected'), 'true', 'the error moves the person to the tab that needs fixing');
  await dialog.getByRole('checkbox', { name: ACCESS }).uncheck();
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click(); await dialog.waitFor({ state: 'detached' });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === `/api/domain-manager/access/${uid(2)}`), 'unchecking and saving revokes');

  // 5. a failed access save (after the user was saved) is named and the dialog stays on the tab
  await editAna(); await dialog.getByRole('tab', { name: TAB }).click();
  await dialog.getByRole('checkbox', { name: ACCESS }).check();
  await dialog.getByRole('checkbox', { name: 'site2.example.com' }).check();
  failAccess = true;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Usuário salvo, mas o acesso ao Domain Manager NÃO foi salvo' }).waitFor();
  failAccess = false; await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Descartar', exact: true }).last().click();
  await dialog.waitFor({ state: 'detached' });

  // 6. both modules on: both tabs, each with its own panel
  spfblOn = true; await open(); await editAna();
  assert.deepEqual(await dialog.getByRole('tab').allInnerTexts(), ['Dados', 'SPFBL', 'Domain Manager']);
  await dialog.getByRole('tab', { name: TAB }).click();
  assert.equal(await dialog.getByRole('tabpanel', { name: TAB }).isVisible(), true);
  assert.equal(await dialog.getByRole('tabpanel', { name: 'SPFBL' }).isVisible(), false);
  await page.keyboard.press('Escape'); spfblOn = false;

  // 7. inactive account: explained, no controls
  await open();
  await page.getByRole('row', { name: /Inativa Silva/ }).getByRole('button', { name: 'Editar' }).click();
  await dialog.getByRole('tab', { name: TAB }).click();
  await dialog.getByText('Ative a conta do usuário').waitFor();
  assert.equal(await dialog.getByRole('checkbox', { name: ACCESS }).count(), 0);
  await page.keyboard.press('Escape');

  // 8. create: the access goes after POST /users with the new id
  await page.getByRole('button', { name: 'Novo Membro', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Cadastrar Novo Membro' });
  await create.getByLabel('Nome Completo').fill('Novo Fulano'); await create.getByLabel('E-mail').fill('novo@example.invalid');
  await create.getByLabel('Senha de Acesso').fill('SenhaInicial#2026-ok');
  await create.getByRole('tab', { name: TAB }).click();
  await create.getByRole('checkbox', { name: ACCESS }).check();
  await create.getByRole('checkbox', { name: 'site3.example.com' }).check();
  calls.length = 0;
  await create.getByRole('button', { name: 'Salvar Usuário' }).click(); await create.waitFor({ state: 'detached' });
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.replace(uid(9), ':new')}`), ['POST /api/users', 'PUT /api/domain-manager/access/:new']);

  // 9. a revocation that is already done (a retry) counts as done: no stuck error, the dialog closes
  await open();
  grants = [{ user_id: uid(2), name: 'Ana Souza', email: 'ana@example.invalid', domains: [domains[0]], user_active: true }];
  revoke404 = true;
  await editAna(); await dialog.getByRole('tab', { name: TAB }).click();
  await dialog.getByRole('checkbox', { name: ACCESS }).uncheck();
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click(); await dialog.waitFor({ state: 'detached' });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/api/domain-manager/access/')), 'the revocation was attempted');
  revoke404 = false;

  // 10. deactivating the account in the same save: the access draft is left alone (no call the server would refuse), no false error
  grants = [];
  await open(); await editAna(); await dialog.getByRole('tab', { name: TAB }).click();
  await dialog.getByRole('checkbox', { name: ACCESS }).check();
  await dialog.getByRole('checkbox', { name: 'site4.example.com' }).check();
  await dialog.getByRole('tab', { name: 'Dados' }).click();
  await dialog.getByRole('switch', { name: 'Status da Conta' }).click();
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click(); await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.replace(uid(2), ':id')}`), ['PUT /api/users/:id'], 'only the user is saved');

  assert.deepEqual(errors, []);
  console.log('team dialog Domain Manager access browser tests passed');
} finally {
  await browser?.close();
  await vite.close();
}
