/* global process */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.REAUTH_UI_EVIDENCE_DIR;
if (output) fs.mkdirSync(output, { recursive: true });
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{MemoryRouter,Routes,Route}from'react-router-dom';
import{AuthContext}from'/src/context/AuthContext.jsx';
import ReauthDialog from'/src/components/ReauthDialog.jsx';import GroupModal from'/src/components/GroupModal.jsx';
import ClientVault from'/src/pages/ClientVault.jsx';import api from'/src/services/api.js';import'/src/index.css';
api.defaults.baseURL='/api';
const auth={user:{id:'synthetic-user',role:'admin',mfa_enabled:false},masterKey:null,identityKeys:null,isVaultUnlocked:false,
 registerVaultLockCleanup:()=>()=>{},unlockVault:async value=>{window.__unlockValue=value;return{success:true};}};
function Fixture(){const[open,setOpen]=useState(false);return <AuthContext.Provider value={auth}><MemoryRouter><main className="p-4">
<button onClick={()=>setOpen(true)}>Novo Grupo</button><ClientVault/>
<GroupModal isOpen={open} onClose={()=>setOpen(false)} onSaveSuccess={()=>{setOpen(false);window.__groupSaved=true;}}/>
</main><ReauthDialog/></MemoryRouter></AuthContext.Provider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'reauth-unlock-isolated-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:reauth-fixture') return '\0reauth-fixture.jsx'; },
  load(id) { if (id === '\0reauth-fixture.jsx') return fixture; },
  transform(code, id) {
    if (id === '\0reauth-fixture.jsx') return transformWithOxc(code, 'reauth-fixture.jsx');
    if (id.replaceAll('\\', '/').endsWith('/src/context/AuthContext.jsx')) return code + '\nexport {AuthContext};';
  },
  configureServer(server) {
    server.middlewares.use('/__reauth_fixture', async (_req, res, next) => {
      try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__reauth_fixture', '<html lang="pt-BR"><head><title>Autenticação — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:reauth-fixture";</script></body></html>')); }
      catch (error) { next(error); }
    });
  }
}] });
let browser, page;
const errors = [];
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page = await context.newPage();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  let mfa = false, failCheck = false, malformed = false, checkDelay = 0, rejectReauth = false;
  const authWrites = [], groupWrites = [], logs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => logs.push(message.text()));
  page.on('dialog', async dialog => { errors.push('Unexpected native dialog'); await dialog.dismiss(); });
  await context.addCookies([{ name: 'fp_csrf', value: 'SYNTHETIC_CSRF', url: origin }]);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, origin, 'fixture cannot access any real installation');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() === 'GET') {
      if (url.pathname === '/api/clients' || url.pathname === '/api/users') return route.fulfill({ json: [] });
      if (url.pathname === '/api/auth/me') {
        if (checkDelay) await new Promise(resolve => setTimeout(resolve, checkDelay));
        if (failCheck) return route.fulfill({ status: 503, json: {} });
        return route.fulfill({ json: { user: malformed ? {} : { mfa_enabled: mfa, mfa_required: true } } });
      }
    }
    assert.equal(request.headers()['x-csrf-token'], 'SYNTHETIC_CSRF');
    const data = request.postDataJSON();
    if (url.pathname === '/api/auth/reauth') {
      authWrites.push(data);
      assert.equal(data.purpose, 'group_create');
      if (rejectReauth) return route.fulfill({ status: 403, json: { code: 'REAUTH_REQUIRED', purpose: 'group_create' } });
      if (mfa) assert.equal(data.mfa_code, '123456');
      else assert.equal(Object.hasOwn(data, 'mfa_code'), false);
      return route.fulfill({ json: { token: 'SYNTHETIC_GRANT' } });
    }
    if (url.pathname === '/api/groups') {
      groupWrites.push(data);
      if (!data._reauth_token) return route.fulfill({ status: 403, json: { code: 'REAUTH_REQUIRED', purpose: 'group_create' } });
      assert.equal(data._reauth_token, 'SYNTHETIC_GRANT');
      return route.fulfill({ status: 201, json: { group: { id: 'synthetic-group' } } });
    }
    throw new Error('Unexpected fixture endpoint ' + url.pathname);
  });
  const dialog = page.getByRole('dialog', { name: 'Confirmar alteração sensível' });
  const openGroup = async () => {
    await page.goto(origin + '/__reauth_fixture');
    await page.getByRole('button', { name: 'Novo Grupo', exact: true }).click();
    await page.getByLabel('Nome do Grupo').fill('Grupo fictício');
    await page.getByRole('button', { name: 'Salvar Grupo', exact: true }).click();
    await dialog.waitFor();
  };
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Confirmar' && !b.disabled));
  const discardGroup = async () => {
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Salvar Grupo' && !b.disabled));
    await page.getByRole('button', { name: 'Fechar Novo Grupo', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Novo Grupo', exact: true }).waitFor({ state: 'hidden' });
  };
  const screenshot = async name => { if (output) await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); };
  for (const width of [1280, 390]) for (const dark of [false, true]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/__reauth_fixture');
    await page.getByRole('heading', { name: 'Cofre Bloqueado' }).waitFor();
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    assert.equal(await page.getByRole('button', { name: 'Gerar senha segura' }).count(), 0);
    const unlock = page.getByLabel('Segredo de desbloqueio', { exact: false });
    assert.equal(await unlock.getAttribute('autocomplete'), 'current-password');
    await unlock.fill('SYNTHETIC_EXISTING_VAULT_SECRET');
    await page.getByRole('button', { name: 'Mostrar senha', exact: true }).click();
    assert.equal(await unlock.getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Ocultar senha', exact: true }).click();
    assert.equal(await unlock.getAttribute('type'), 'password');
    await screenshot(`unlock-${width}-${dark ? 'dark' : 'light'}`);
    await page.getByRole('button', { name: 'Desbloquear Cofre' }).click();
    await page.waitForFunction(() => window.__unlockValue === 'SYNTHETIC_EXISTING_VAULT_SECRET');
    assert.equal(await unlock.inputValue(), '');
    await openGroup(); await ready();
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    assert.equal(await dialog.locator('input[name="code"]').count(), 0, 'MFA policy alone must not show a factor');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot(`reauth-disabled-${width}-${dark ? 'dark' : 'light'}`);
    await dialog.getByLabel('Senha de login', { exact: true }).fill('SYNTHETIC_LOGIN_PASSWORD');
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => window.__groupSaved === true);
    await page.getByRole('dialog', { name: 'Novo Grupo', exact: true }).waitFor({ state: 'hidden' });
  }
  assert.equal(authWrites.length, 4, 'one reauth per confirmation even on double click');
  assert.equal(groupWrites.length, 8, 'one initial request plus one grant retry');
  mfa = true; await openGroup(); await ready();
  await dialog.getByLabel('Código MFA').fill('123456');
  await dialog.getByLabel('Senha de login', { exact: true }).fill('SYNTHETIC_LOGIN_PASSWORD');
  await screenshot('reauth-enabled');
  await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.waitForFunction(() => window.__groupSaved === true);
  await page.getByRole('dialog', { name: 'Novo Grupo', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(authWrites.at(-1).mfa_code, '123456', 'fresh account state overrides stale auth context');
  for (const kind of ['network', 'malformed']) {
    failCheck = kind === 'network'; malformed = kind === 'malformed';
    await openGroup(); await dialog.getByRole('button', { name: 'Tentar novamente' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Confirmar', exact: true }).isDisabled(), true);
    failCheck = false; malformed = false; mfa = false;
    await dialog.getByRole('button', { name: 'Tentar novamente' }).click(); await ready();
    assert.equal(await dialog.locator('input[name="code"]').count(), 0);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await discardGroup();
  }
  checkDelay = 400; await openGroup();
  assert.equal(await dialog.getByRole('button', { name: 'Confirmar', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); checkDelay = 0;
  await discardGroup();
  rejectReauth = true; await openGroup(); await ready();
  await dialog.getByLabel('Senha de login', { exact: true }).fill('SYNTHETIC_WRONG_PASSWORD');
  const count = authWrites.length;
  await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Confira os dados' }).waitFor(); await ready();
  assert.equal(authWrites.length, count + 1, 'wrong password must not recursively open another reauth');
  assert.equal(await dialog.getByLabel('Senha de login', { exact: true }).inputValue(), '');
  assert.equal(await dialog.locator('input[name="code"]').count(), 0);
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
  assert.deepEqual(errors, []);
  for (const secret of ['SYNTHETIC_LOGIN_PASSWORD', 'SYNTHETIC_EXISTING_VAULT_SECRET', 'SYNTHETIC_WRONG_PASSWORD']) assert(!logs.join('\n').includes(secret));
  console.log('PASS real group modal/reauth/unlock UI: disabled/enabled/policy-only/stale MFA, payloads, duplicate guard, failed/malformed/slow GET, retry/cancel, wrong password, no generator, show/hide, secret clearing, mobile/themes and no secret logs. Synthetic localhost only.');
} catch (error) {
  if (output && page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('Synthetic browser errors:', errors);
  throw error;
} finally { await browser?.close(); await vite.close(); }
