/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import WindowsServerManager from '/src/components/WindowsServerManager.jsx';
import LinuxServerManager from '/src/components/LinuxServerManager.jsx';
import { AuthContext } from '/src/context/AuthContext.jsx';
import VaultReadOnlyGuard from '/src/components/VaultReadOnlyGuard.jsx';
import '/src/index.css';
const servers = [
  { id: 'srv-a', name: 'Servidor A', connections: [{ id: 'eth-a', type: 'Eth1', name: 'Principal', ipv4: '', gateway: '' }], portRules: [{ id: 'old', portNumber: '443', host: 'legacy.example', protocol: 'HTTPS', direction: 'Entrada' }], tsRules: [{ id: 'old-ts', host: 'ts.example', port: '3389' }] },
  { id: 'srv-b', name: 'Servidor B', connections: [{ id: 'eth-b', type: 'Eth1', name: 'Filial', ipv4: '', gateway: '' }], portRules: [], tsRules: [] }
];
const users = [{ id: 'u-a', serverId: 'srv-a', name: 'Pessoa A', username: 'login-a', password: 'TEST-FIXTURE-PASSWORD', permission: 'user', department: 'TI' }, { id: 'u-b', serverId: 'srv-b', name: 'Pessoa B', username: 'login-b', password: 'TEST-FIXTURE-PASSWORD', permission: 'user' }];
window.fixtureSaves = [];
function Fixture() {
  const [mode, setMode] = useState('windows');
  const [readOnly, setReadOnly] = useState(false);
  const [failSave, setFailSave] = useState(false);
  const [windows, setWindows] = useState({ servers, users });
  const [linux, setLinux] = useState({ servers: servers.map(s => ({ ...s, tsRules: undefined, systemType: 'Ubuntu' })), sshCredentials: [] });
  const save = async (category, payload) => {
    if (failSave) return false;
    window.fixtureSaves.push({ category, payload });
    return true;
  };
  return <AuthContext.Provider value={{ registerVaultLockCleanup: () => () => {} }}>
    <nav><button onClick={() => setMode(mode === 'windows' ? 'linux' : 'windows')}>Alternar sistema</button> | <button onClick={() => setReadOnly(!readOnly)}>Alternar somente leitura</button> | <button onClick={() => setFailSave(!failSave)}>Alternar falha</button></nav>
    <main className="mx-auto max-w-5xl p-4" data-vault-readonly-scope="true">
      <VaultReadOnlyGuard enabled permissions={{ can_view: true, can_edit: !readOnly, can_add: !readOnly, can_delete: !readOnly }} />
      {mode === 'windows' ? <WindowsServerManager tsForm={windows} setTsForm={setWindows} handleSaveData={save} readOnly={readOnly} /> : <LinuxServerManager serverForm={linux} setServerForm={setLinux} handleSaveData={save} readOnly={readOnly} />}
    </main>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;
const vite = await createServer({
  root, server: { host: '127.0.0.1', port: 0 }, appType: 'custom',
  plugins: [{
    name: 'local-server-flow-fixture', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:server-flow-fixture') return '\0virtual:server-flow-fixture.jsx'; },
    load(id) { if (id === '\0virtual:server-flow-fixture.jsx') return fixture; },
    transform(code, id) {
      if (id === '\0virtual:server-flow-fixture.jsx') return transformWithOxc(code, 'server-flow-fixture.jsx');
      if (id.endsWith('/AuthContext.jsx')) return code + '\nexport { AuthContext };';
    },
    configureServer(server) {
      server.middlewares.use('/__server_flows', async (_req, res, next) => {
        try {
          const html = await server.transformIndexHtml('/__server_flows', '<html><body><div id="root"></div><script type="module">import "virtual:server-flow-fixture";</script></body></html>');
          res.setHeader('Content-Type', 'text/html'); res.end(html);
        } catch (error) { next(error); }
      });
    }
  }]
});
let browser;
try {
  await vite.listen();
  const address = vite.httpServer.address();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${address.port}/__server_flows`);
  await page.getByRole('heading', { name: 'Servidores cadastrados', exact: true }).waitFor();
  const clickExact = (name) => (name === 'Fechar' ? page.locator('div.fixed').last() : page).getByRole('button', { name, exact: true }).last().click();
  const assertNoOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Page must not overflow horizontally');

  await page.getByRole('button', { name: 'Adicionar login', exact: true }).nth(1).click();
  assert.equal(await page.locator('select').last().count(), 1);
  assert.equal(await page.locator('select').filter({ has: page.locator('option[value="srv-b"]') }).last().inputValue(), 'srv-b');
  await page.getByPlaceholder('Ex: João Silva').fill('Pessoa nova');
  await page.getByPlaceholder('login', { exact: true }).fill('login-novo');
  await clickExact('Cancelar');
  await clickExact('Continuar editando');
  await clickExact('Salvar');
  await page.getByRole('heading', { name: 'Adicionar Usuário', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.fixtureSaves.at(-1).payload.users[0].serverId), 'srv-b');
  assert.equal(await page.evaluate(() => window.fixtureSaves.at(-1).payload.users.length), 3);
  await page.getByRole('button', { name: 'Exibir lista de usuários', exact: true }).first().click();
  const usersModal = page.locator('div.fixed').last();
  assert.match(await usersModal.innerText(), /login-a/);
  assert.doesNotMatch(await usersModal.innerText(), /login-b|TEST-FIXTURE-PASSWORD/);
  await page.getByLabel('Pesquisar usuários do servidor').fill('inexistente');
  await page.getByText('Nenhum usuário encontrado.', { exact: true }).waitFor();
  await clickExact('Fechar');

  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  assert.equal(await page.getByLabel('TS', { exact: true }).inputValue(), 'Não');
  assert.equal(await page.getByLabel('Host/DDNS', { exact: true }).count(), 0);
  await page.getByLabel('Porta', { exact: true }).fill('a123456b');
  assert.match(await page.getByLabel('Porta', { exact: true }).inputValue(), /^\d{1,5}$/);
  await page.getByLabel('Porta', { exact: true }).fill('123456');
  assert.equal(await page.getByLabel('Porta', { exact: true }).inputValue(), '12345');
  await page.getByLabel('Porta', { exact: true }).fill('65536');
  await clickExact('Adicionar');
  await page.getByRole('alert').filter({ hasText: '1 e 65535' }).waitFor();
  await page.getByLabel('Porta', { exact: true }).fill('61033');
  await page.getByLabel('TS', { exact: true }).selectOption('Sim');
  await clickExact('Adicionar');
  await page.getByRole('alert').filter({ hasText: 'Host/DDNS' }).waitFor();
  await page.getByLabel('Host/DDNS', { exact: true }).fill('new.example');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      await page.evaluate(enabled => document.documentElement.classList.toggle('dark', enabled), dark);
      await assertNoOverflow();
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await clickExact('Adicionar');
  assert.equal(await page.getByLabel('Porta', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Conexão da porta').inputValue(), 'eth-a');
  await page.getByRole('button', { name: /Exibir portas configuradas/ }).click();
  assert.match(await page.locator('div.fixed').last().innerText(), /61033.*Entrada\/Saída/s);
  await page.getByLabel('Pesquisar portas').fill('new.example');
  assert.equal(await page.getByRole('button', { name: 'Editar porta', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Editar porta', exact: true }).click();
  await page.getByLabel('Porta', { exact: true }).fill('61034');
  await clickExact('Aplicar edição');
  await clickExact('Salvar');
  await page.getByRole('heading', { name: 'Detalhes do servidor', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.fixtureSaves.at(-1).payload.servers[0].portRules[0].portNumber), '61034');

  // Save-and-close includes the unsubmitted draft, and a failure leaves it intact.
  await clickExact('Alternar falha');
  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  await page.getByLabel('Porta', { exact: true }).fill('1234');
  await clickExact('Cancelar');
  await clickExact('Salvar e fechar');
  assert.equal(await page.getByLabel('Porta', { exact: true }).inputValue(), '1234');
  await clickExact('Cancelar');
  await clickExact('Descartar');
  await clickExact('Alternar falha');
  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  await page.getByLabel('Porta', { exact: true }).fill('1234');
  await clickExact('Cancelar');
  await clickExact('Salvar e fechar');
  await page.getByRole('heading', { name: 'Detalhes do servidor', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.fixtureSaves.at(-1).payload.servers[0].portRules[0].portNumber), '1234');

  await clickExact('Alternar somente leitura');
  await page.getByRole('button', { name: 'Exibir lista de usuários', exact: true }).first().click();
  assert.equal(await page.getByLabel('Pesquisar usuários do servidor').evaluate(el => el.readOnly), false);
  assert.equal(await page.getByRole('button', { name: 'Editar usuário', exact: true }).count(), 0);
  await clickExact('Fechar');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  await page.getByRole('button', { name: /Exibir portas configuradas/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Editar porta', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Excluir porta', exact: true }).count(), 0);
  await page.getByLabel('Pesquisar portas').fill('ts.example');
  assert.match(await page.locator('div.fixed').last().innerText(), /ts.example/);
  await clickExact('Fechar');
  await clickExact('Fechar');
  await clickExact('Alternar somente leitura');
  await clickExact('Alternar sistema');

  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  assert.equal(await page.getByLabel('TS', { exact: true }).count(), 0);
  await page.getByLabel('Porta', { exact: true }).fill('22');
  await page.getByLabel('Protocolo', { exact: true }).selectOption('SSH');
  await clickExact('Adicionar');
  await page.getByLabel('Porta', { exact: true }).fill('443');
  await page.getByLabel('Protocolo', { exact: true }).selectOption('HTTPS');
  await page.getByLabel('Host/DDNS', { exact: true }).fill('web.example');
  await clickExact('Adicionar');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      await page.evaluate(enabled => document.documentElement.classList.toggle('dark', enabled), dark);
      await assertNoOverflow();
      const portBounds = await page.getByLabel('Porta', { exact: true }).boundingBox();
      assert.ok(portBounds.width > 100);
    }
  }
  await page.getByRole('button', { name: /Exibir portas configuradas/ }).click();
  await page.getByLabel('Pesquisar portas').fill('web.example');
  assert.match(await page.locator('div.fixed').last().innerText(), /HTTPS/);
  await assertNoOverflow();
  await clickExact('Fechar');
  await clickExact('Salvar');
  await page.getByRole('heading', { name: 'Detalhes do servidor Linux', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.fixtureSaves.at(-1).payload.servers[0].portRules[0].host), 'web.example');
  assert.deepEqual(errors, []);
  console.log('Browser fixture passed: Windows users, ports, draft/failure handling, readonly search, Linux ports, desktop/mobile and light/dark.');
} finally {
  if (browser) await browser.close();
  await vite.close();
}
