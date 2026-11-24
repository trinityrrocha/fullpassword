/* global process */
// VaultSharingManager: a group AND selected users. Synthetic localhost only; the key rotation itself is stubbed (covered by the
// native PostgreSQL test and the crypto tests): here we check what the screen asks for and what it sends.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = `
import React from'react';import{createRoot}from'react-dom/client';
import VaultSharingManager from'/src/components/VaultSharingManager.jsx';import api from'/src/services/api.js';import'/src/index.css';api.defaults.baseURL='/api';
window.__saved=[];window.__fail=false;
const save=async(groups,users)=>{window.__saved.push({groups,users});if(window.__fail)throw new Error('x');};
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-xl p-4"><VaultSharingManager clientId="00000000-0000-0000-0000-000000000200" saveCryptoShares={save} compact/></main>);
`;
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{
  name: 'share-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:share-fixture') return '\0share-fixture.jsx'; },
  load(id) { if (id === '\0share-fixture.jsx') return fixture; },
  transform(code, id) { if (id === '\0share-fixture.jsx') return transformWithOxc(code, 'share-fixture.jsx'); },
  configureServer(server) { server.middlewares.use('/__share', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__share', '<html lang="pt-BR"><head><title>Cofre</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:share-fixture"></script></body></html>')); }); }
}] });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', async (d) => { errors.push(`native ${d.type()}: ${d.message()}`); await d.dismiss(); });
  const people = [
    { id: 'u-ana', name: 'Ana Souza', email_hint: 'an***@example.com', has_identity: true, is_active: true },
    { id: 'u-bruno', name: 'Bruno Lima', email_hint: 'br***@example.com', has_identity: true, is_active: true },
    { id: 'u-nokey', name: 'Bruna Sem Chave', email_hint: 'br***@example.com', has_identity: false, is_active: true }
  ];
  let current = [{ ...people[0], can_edit: true, can_add: false, can_delete: false, can_view: true }];
  let failUserShares = false; const queries = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (url.pathname === '/api/groups/options') return json([{ id: 'g1', name: 'Equipe NOC' }]);
    if (url.pathname.endsWith('/shares') && url.pathname.startsWith('/api/vault-items/')) return json([{ group_id: 'g1', group_name: 'Equipe NOC', can_view: true, can_edit: false, can_add: false, can_delete: false }]);
    if (url.pathname.endsWith('/user-shares')) return failUserShares ? json({ error: 'x' }, 500) : json({ users: current });
    if (url.pathname.endsWith('/user-directory')) {
      const q = url.searchParams.get('q'); queries.push(q);
      return json({ users: people.filter((p) => p.name.toLowerCase().includes(String(q).toLowerCase())) });
    }
    throw new Error(`Unexpected fixture endpoint ${route.request().method()} ${url.pathname}`);
  });
  await page.goto(`${origin}/__share`);
  await page.getByText('Usuários para compartilhar').waitFor();
  assert.equal(await page.getByRole('listbox').count(), 0);
  // the current direct share is shown with its rights
  const direct = page.getByRole('list', { name: 'Usuários com acesso direto' });
  await direct.getByText('Ana Souza').waitFor();
  assert.equal(await direct.getByRole('checkbox', { name: 'Editar (Ana Souza)' }).isChecked(), true);
  await page.getByText(/Compartilhando com: 1 grupo e 1 usuário/).waitFor();
  // search needs 2+ characters, never lists everybody
  const search = page.getByLabel('Usuários para compartilhar');
  await search.fill('b'); await page.waitForTimeout(450); assert.deepEqual(queries, [], 'no request below 2 characters');
  await search.fill('bru'); await page.getByRole('list', { name: 'Resultado da busca de usuários' }).waitFor();
  const found = page.getByRole('list', { name: 'Resultado da busca de usuários' });
  assert.equal(await found.getByRole('listitem').count(), 2);
  assert.equal(await found.getByRole('checkbox').nth(1).isDisabled(), true, 'an account without a crypto identity cannot be picked');
  await found.getByText('Ainda não ativou a chave de acesso').waitFor();
  assert.ok(!(await found.innerText()).includes('@example.com') || (await found.innerText()).includes('***'), 'only a masked address is shown');
  await found.getByRole('checkbox').first().check();
  await direct.getByText('Bruno Lima').waitFor();
  await direct.getByRole('checkbox', { name: 'Adicionar (Bruno Lima)' }).check();
  await direct.getByRole('checkbox', { name: 'Editar (Ana Souza)' }).uncheck();
  await page.getByText(/1 grupo e 2 usuários/).waitFor();
  // save sends the group and the users (ids and rights only)
  await page.getByRole('button', { name: 'Salvar compartilhamento' }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  const saved = await page.evaluate(() => window.__saved[0]);
  assert.deepEqual(saved.groups.map((g) => g.group_id), ['g1']);
  assert.deepEqual(saved.users, [
    { user_id: 'u-ana', can_view: true, can_edit: false, can_add: false, can_delete: false },
    { user_id: 'u-bruno', can_view: true, can_edit: false, can_add: true, can_delete: false }
  ]);
  assert.ok(!JSON.stringify(saved).includes('email'), 'names and hints never travel back');
  // removing a user
  await direct.getByRole('button', { name: 'Remover Ana Souza' }).click();
  assert.equal(await direct.getByText('Ana Souza').count(), 0);
  // when the direct shares cannot be read the section is hidden and NOTHING is sent for them (the server keeps them)
  failUserShares = true; await page.reload();
  await page.getByText('Selecione os grupos...').first().waitFor().catch(() => {});
  await page.getByRole('button', { name: 'Salvar compartilhamento' }).waitFor();
  assert.equal(await page.getByText('Usuários para compartilhar').count(), 0);
  await page.getByRole('button', { name: 'Salvar compartilhamento' }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  assert.equal(await page.evaluate(() => window.__saved[0].users), undefined, 'unread direct shares are omitted, never overwritten with an empty list');
  assert.deepEqual(errors.filter((e) => !e.startsWith('native alert')), []);
  console.log(JSON.stringify({ vaultUserShare: 'PASS', search: '2+ characters, masked', noIdentity: 'not pickable', payload: 'ids and rights', unreadSafe: true }));
} finally { await browser?.close(); await vite.close(); }
