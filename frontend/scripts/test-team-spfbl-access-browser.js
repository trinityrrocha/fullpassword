/* global process */
// "Gestão de Equipe": the SPFBL access tab inside the user dialog. Visible only for a Super Admin while the module is ON; the
// access is saved AFTER the user, through the existing per-target endpoint; a failed access save is reported by name.
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
  const users = [{ id: uid(2), name: 'Ana Souza', email: 'ana@example.invalid', is_active: true, role: 'user', groups: [] }, { id: uid(3), name: 'Inativa Silva', email: 'in@example.invalid', is_active: false, role: 'user', groups: [] }, { id: uid(1), name: 'Super', email: 'sa@example.invalid', is_active: true, role: 'admin', is_super_admin: true, groups: [] }];
  const domains = Array.from({ length: 6 }, (_, i) => ({ id: uid(100 + i), name: `site${i}.example.com`, active: true }));
  let moduleOn = true; let failAccess = false; let grants = [{ user_id: uid(2), name: 'Ana Souza', email: 'ana@example.invalid', unlock_mode: 'review', domains: [domains[0]], user_active: true }];
  const calls = [];
  await page.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    assert.equal(url.origin, origin);
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const body = req.postData() ? req.postDataJSON() : {};
    calls.push({ method: req.method(), path: url.pathname, body });
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (req.method() !== 'GET') assert.equal(req.headers()['x-csrf-token'], 'SYNTHETIC_CSRF');
    if (url.pathname === '/api/system/modules/menu') return json({ modules: { spfbl: moduleOn } });
    if (url.pathname === '/api/users' && req.method() === 'GET') return json(users);
    if (url.pathname === '/api/groups') return json([]);
    if (url.pathname === '/api/auth/password-policy') return json({ login_min_length: 12, login_rotation_months: 12, vault_min_length: 16, vault_rotation_months: 12 });
    if (url.pathname === '/api/spfbl/domains') return json({ domains });
    if (url.pathname === '/api/spfbl/access' && req.method() === 'GET') return json({ access: grants });
    if (url.pathname.startsWith('/api/spfbl/access/')) {
      if (failAccess) return json({ error: 'Reautenticação recusada' }, 403);
      const id = url.pathname.split('/').pop();
      if (req.method() === 'DELETE') { grants = grants.filter((g) => g.user_id !== id); return json({ ok: true }); }
      grants = [...grants.filter((g) => g.user_id !== id), { user_id: id, unlock_mode: body.unlock_mode, domains: domains.filter((d) => body.domain_ids.includes(d.id)) }];
      return json({ user_id: id, name: 'x' });
    }
    if (url.pathname === '/api/users' && req.method() === 'POST') return json({ id: uid(9), name: body.name }, 201);
    if (url.pathname.startsWith('/api/users/') && req.method() === 'PUT') return json({ ok: true });
    throw new Error(`Unexpected fixture endpoint ${req.method()} ${url.pathname}`);
  });
  const open = async (as = '') => { await page.goto(`${origin}/__team${as}`); await page.getByText('Ana Souza').first().waitFor(); };
  const editAna = async () => { await page.getByRole('row', { name: /Ana Souza/ }).getByRole('button', { name: 'Editar' }).click(); await page.getByRole('dialog', { name: 'Editar Usuário' }).waitFor(); };

  // 1. module OFF: no tab at all, in the edit and in the create dialogs
  moduleOn = false; await open(); await editAna();
  assert.equal(await page.getByRole('tab', { name: 'SPFBL' }).count(), 0, 'no SPFBL tab while the module is off');
  await page.keyboard.press('Escape');

  // 2. module ON, Super Admin: tab exists; the existing grant is loaded; revoking saves AFTER the user, per target
  moduleOn = true; await open(); await editAna();
  const dialog = page.getByRole('dialog', { name: 'Editar Usuário' });
  await dialog.getByRole('tab', { name: 'SPFBL' }).click();
  const give = dialog.getByRole('checkbox', { name: /Dar acesso ao SPFBL/ });
  await give.waitFor(); assert.equal(await give.isChecked(), true, 'the current grant is shown');
  assert.equal(await dialog.getByRole('radio', { name: /Revisão|Solicitar/ }).count() > 0, true);
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await page.getByRole('dialog', { name: 'Editar Usuário' }).waitFor({ state: 'detached' });
  assert.equal(calls.some((c) => c.path.startsWith('/api/spfbl/access/')), false, 'an untouched SPFBL tab never calls the access endpoint (no needless reauthentication)');

  // 3. change the grant: user first, then the access; invalid selection is blocked on the tab
  await editAna(); await dialog.getByRole('tab', { name: 'SPFBL' }).click();
  await dialog.getByRole('checkbox', { name: 'site1.example.com' }).check();
  await dialog.getByRole('radio', { name: /direto/i }).check();
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await dialog.waitFor({ state: 'detached' });
  const order = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.replace(uid(2), ':id')}`);
  assert.deepEqual(order, ['PUT /api/users/:id', 'PUT /api/spfbl/access/:id'], 'user first, then its access');
  const saved = calls.find((c) => c.path.startsWith('/api/spfbl/access/')).body;
  assert.deepEqual([saved.unlock_mode, saved.domain_ids.length], ['direct', 2]);
  await editAna(); await dialog.getByRole('tab', { name: 'SPFBL' }).click();
  await dialog.getByRole('checkbox', { name: 'site0.example.com' }).uncheck(); await dialog.getByRole('checkbox', { name: 'site1.example.com' }).uncheck();
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Escolha de 1 a 100 domínios' }).waitFor();
  assert.equal(await dialog.getByRole('tab', { name: 'SPFBL' }).getAttribute('aria-selected'), 'true', 'the error moves the person to the tab that needs fixing');
  // switch off -> revoke
  await dialog.getByRole('checkbox', { name: /Dar acesso ao SPFBL/ }).uncheck();
  calls.length = 0;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click(); await dialog.waitFor({ state: 'detached' });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === `/api/spfbl/access/${uid(2)}`), 'unchecking and saving revokes');

  // 4. access failure after the user was saved is visible, and the dialog stays open on the SPFBL tab
  await editAna(); await dialog.getByRole('tab', { name: 'SPFBL' }).click();
  await dialog.getByRole('checkbox', { name: /Dar acesso ao SPFBL/ }).check();
  await dialog.getByRole('checkbox', { name: 'site2.example.com' }).check();
  failAccess = true;
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Usuário salvo, mas o acesso ao SPFBL NÃO foi salvo' }).waitFor();
  failAccess = false; await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Descartar', exact: true }).last().click();
  await dialog.waitFor({ state: 'detached' });

  // 5. inactive account: explained, no controls; Super Admin target: no tab
  await page.getByRole('row', { name: /Inativa Silva/ }).getByRole('button', { name: 'Editar' }).click();
  await dialog.getByRole('tab', { name: 'SPFBL' }).click();
  await dialog.getByText('Ative a conta do usuário').waitFor();
  assert.equal(await dialog.getByRole('checkbox', { name: /Dar acesso ao SPFBL/ }).count(), 0);
  await page.keyboard.press('Escape');
  const superRow = page.getByRole('row', { name: /Super/ }).getByRole('button', { name: 'Editar' });
  if (await superRow.count()) { await superRow.click(); await dialog.waitFor(); assert.equal(await dialog.getByRole('tab', { name: 'SPFBL' }).count(), 0, 'a Super Admin never gets SPFBL access'); await page.keyboard.press('Escape'); }

  // 6. create: the access goes after POST /users with the new id
  await page.getByRole('button', { name: 'Novo Membro', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Cadastrar Novo Membro' });
  await create.getByLabel('Nome Completo').fill('Novo Fulano'); await create.getByLabel('E-mail').fill('novo@example.invalid');
  await create.getByLabel('Senha de Acesso').fill('SenhaInicial#2026-ok');
  await create.getByRole('tab', { name: 'SPFBL' }).click();
  await create.getByRole('checkbox', { name: /Dar acesso ao SPFBL/ }).check();
  await create.getByRole('checkbox', { name: 'site3.example.com' }).check();
  calls.length = 0;
  await create.getByRole('button', { name: 'Salvar Usuário' }).click(); await create.waitFor({ state: 'detached' });
  const created = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.replace(uid(9), ':new')}`);
  assert.deepEqual(created, ['POST /api/users', 'PUT /api/spfbl/access/:new']);

  // 7. an ordinary admin (not Super Admin) never sees the tab
  moduleOn = true; await open('?as=admin'); await page.getByRole('row', { name: /Ana Souza/ }).getByRole('button', { name: 'Editar' }).click();
  await dialog.waitFor(); assert.equal(await dialog.getByRole('tab', { name: 'SPFBL' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ teamSpfblAccess: 'PASS', hiddenWhenModuleOff: true, order: 'user then access', failure: 'visible', create: 'POST then PUT' }));
} finally {
  await browser?.close(); await vite.close();
}
