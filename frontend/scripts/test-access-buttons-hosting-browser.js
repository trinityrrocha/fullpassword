/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Windows from '/src/components/WindowsServerManager.jsx';
import Linux from '/src/components/LinuxServerManager.jsx';
import Hosting from '/src/components/CpanelWebManager.jsx';
import Devices from '/src/components/DevicesManager.jsx';
import Vpn from '/src/components/VpnManager.jsx';
import { AuthContext } from '/src/context/AuthContext.jsx';
import '/src/index.css';
const root = createRoot(document.getElementById('root'));
let key = 0;
const noop = () => {};
window.fixtureSaves = [];
const save = async (category, payload) => { window.fixtureSaves.push({ category, payload }); return true; };
window.renderFixture = ({ mode, data, isSaving = false }) => {
  const [Component, prop, setter] = { windows: [Windows, 'tsForm', 'setTsForm'], linux: [Linux, 'serverForm', 'setServerForm'], hosting: [Hosting, 'cpanelForm', 'setCpanelForm'], devices: [Devices, 'devicesForm', 'setDevicesForm'], vpn: [Vpn, 'vpnForm', 'setVpnForm'] }[mode];
  root.render(<AuthContext.Provider value={{ registerVaultLockCleanup: () => () => {} }}><main className="mx-auto max-w-5xl p-4"><Component key={key++} {...{ [prop]: data, [setter]: noop }} handleSaveData={save} isSaving={isSaving} /></main></AuthContext.Provider>);
};
window.renderFixture({ mode: 'hosting', data: { cpanels: [], users: [] } });
`;
const vite = await createServer({ root, appType: 'custom', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'local-access-hosting-fixture', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:access-fixture') return '\0virtual:access-fixture.jsx'; },
  load(id) { if (id === '\0virtual:access-fixture.jsx') return fixture; },
  transform(code, id) {
    if (id === '\0virtual:access-fixture.jsx') return transformWithOxc(code, 'access-fixture.jsx');
    if (id.endsWith('/AuthContext.jsx')) return code + '\nexport { AuthContext };';
  },
  configureServer(server) {
    server.middlewares.use('/__access', async (_req, res, next) => {
      try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__access', '<html><body><div id="root"></div><script type="module">import "virtual:access-fixture"</script></body></html>')); } catch (error) { next(error); }
    });
  }
}] });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__access`);
  await page.getByRole('button', { name: 'Adicionar usuário', exact: true }).waitFor();
  const render = async (mode, data, isSaving = false) => {
    await page.evaluate(args => window.renderFixture(args), { mode, data, isSaving });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const checkButton = async (mode, data, enabled, saving = false) => {
    await render(mode, data, saving);
    const button = page.getByRole('button', { name: mode === 'devices' ? 'Adicionar login' : 'Adicionar usuário', exact: true }).first();
    assert.equal(await button.isVisible(), true);
    assert.equal(await button.isEnabled(), enabled);
    assert.ok(await button.getAttribute('title'));
    if (!enabled) {
      assert.equal(await button.evaluate(el => getComputedStyle(el).cursor), 'not-allowed');
      assert.ok(Number(await button.evaluate(el => getComputedStyle(el).opacity)) < 1);
      // Call the actual React handler, bypassing disabled DOM behavior to test its guard.
      await button.evaluate(el => el[Object.keys(el).find(key => key.startsWith('__reactProps$'))].onClick());
      assert.equal(await page.locator('div.fixed').count(), 0);
    } else {
      await button.click();
      assert.ok(await page.locator('div.fixed').count() > 0);
      assert.ok(await page.locator('div.fixed select').filter({ has: page.locator('option[value="parent"]') }).count() > 0);
    }
  };
  for (const mode of ['windows', 'linux', 'hosting', 'vpn']) {
    const parentKey = mode === 'hosting' ? 'cpanels' : 'servers';
    const empty = { [parentKey]: [], users: [], sshCredentials: [] };
    const populated = { ...empty, [parentKey]: [{ id: 'parent', name: 'Servidor teste', domain: 'fixture.example' }] };
    await checkButton(mode, empty, false);
    await checkButton(mode, populated, true);
    await checkButton(mode, populated, false, true);
  }
  await checkButton('devices', { devices: [], logins: [] }, false);
  for (const deviceType of ['ROTEADOR/GATEWAY', 'WIFI/CONTROLLER', 'NAS STORAGE', 'PABX-IP/VOIP', 'DVR', 'IMPRESSORA']) {
    await checkButton('devices', { devices: [{ id: 'parent', name: 'Dispositivo teste', deviceType }], logins: [] }, !['ROTEADOR/GATEWAY', 'WIFI/CONTROLLER'].includes(deviceType));
  }
  await render('devices', { devices: [], deviceLogins: [] });
  await page.getByRole('button', { name: 'Adicionar dispositivo', exact: true }).click();
  let deviceModal = page.locator('div.fixed').first();
  const createType = deviceModal.locator('select').first();
  assert.equal(await createType.isEnabled(), true);
  await createType.selectOption('DVR');
  for (const label of ['IP do DVR', 'PORTA TCP', 'PORTA HTTPS', 'PORTA HTTP', 'PORTA RTSP', 'PORTA NTP', 'PORTA POS', 'ID', 'MAC', 'DDNS']) {
    assert.equal(await deviceModal.getByLabel(label, { exact: true }).count(), 1, label);
  }
  assert.deepEqual(await deviceModal.getByLabel('IP do DVR').evaluate(el => { const style = getComputedStyle(el); return [style.width, style.height, style.fontSize]; }), ['120px', '32px', '13px']);
  for (const label of ['PORTA TCP', 'PORTA HTTPS', 'PORTA HTTP', 'PORTA RTSP', 'PORTA NTP', 'PORTA POS']) {
    const field = deviceModal.getByLabel(label, { exact: true });
    assert.equal(await field.evaluate(el => getComputedStyle(el).width), '60px');
    assert.equal(await field.evaluate(el => getComputedStyle(el).height), '32px');
    assert.equal(await field.evaluate(el => getComputedStyle(el).fontSize), '13px');
  }
  for (const label of ['ID', 'MAC', 'DDNS']) assert.deepEqual(await deviceModal.getByLabel(label, { exact: true }).evaluate(el => { const style = getComputedStyle(el); return [style.width, style.height, style.fontSize]; }), ['250px', '32px', '13px']);
  for (const forbidden of ['Adicionar conexão', 'Adicionar porta', 'Exibir portas configuradas']) assert.equal(await deviceModal.getByText(forbidden, { exact: false }).count(), 0);
  await deviceModal.getByLabel('PORTA TCP').fill('abc123456');
  assert.equal(await deviceModal.getByLabel('PORTA TCP').inputValue(), '12345');
  await deviceModal.getByLabel('PORTA TCP').fill('65536');
  assert.equal(await deviceModal.getByRole('button', { name: 'Salvar', exact: true }).isEnabled(), false);
  await deviceModal.getByLabel('PORTA TCP').fill('65535');
  assert.equal(await deviceModal.getByRole('button', { name: 'Salvar', exact: true }).isEnabled(), true);
  await deviceModal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();

  const legacyDvr = { id: 'dvr', name: 'DVR Loja 1', deviceType: 'DVR', notes: '', dvrAccess: { ip: '192.168.1.10', tcpPort: '37777', httpsPort: '443', httpPort: '80', rtspPort: '554', ntpPort: '123', posPort: '9000', deviceId: 'DVR-ID', mac: 'AA:BB:CC:DD:EE:FF', ddns: 'loja.example' }, connections: [{ id: 'legacy-connection', type: 'Eth1', ipv4: '10.0.0.1' }], portRules: [{ id: 'legacy-port', name: 'Antiga', portNumber: '4567', direction: 'Entrada', protocol: 'TCP' }] };
  await render('devices', { devices: [legacyDvr], deviceLogins: [{ id: 'login', deviceId: 'dvr', login: 'operador', password: 'TEST-FIXTURE-SECRET', department: 'Geral', permission: 'User' }] });
  assert.match(await page.locator('main').innerText(), /DVR Loja 1.*IP: 192\.168\.1\.10.*TCP: 37777.*HTTP: 80.*Logins: 1/s);
  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  deviceModal = page.locator('div.fixed').first();
  const editType = deviceModal.locator('select').first();
  assert.equal(await editType.isEnabled(), false);
  assert.equal(await editType.getAttribute('title'), 'O tipo do dispositivo não pode ser alterado após o cadastro.');
  await editType.evaluate(el => el[Object.keys(el).find(key => key.startsWith('__reactProps$'))].onChange({ target: { value: 'IMPRESSORA' } }));
  assert.equal(await editType.inputValue(), 'DVR');
  assert.equal(await deviceModal.getByText('Exibir lista de logins e usuários', { exact: true }).count(), 1);
  for (const forbidden of ['Adicionar conexão', 'Adicionar porta', 'Exibir portas configuradas']) assert.equal(await deviceModal.getByText(forbidden, { exact: false }).count(), 0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.DVR_SCREENSHOT_DIR) await deviceModal.screenshot({ path: path.join(process.env.DVR_SCREENSHOT_DIR, `dvr-${width}-${dark ? 'dark' : 'light'}.png`) });
    }
  }
  await deviceModal.getByRole('button', { name: 'Salvar', exact: true }).click();
  const savedDvr = await page.evaluate(() => window.fixtureSaves.at(-1).payload.devices.find(device => device.id === 'dvr'));
  assert.equal(savedDvr.dvrAccess.tcpPort, '37777');
  assert.equal(savedDvr.connections[0].id, 'legacy-connection');
  assert.equal(savedDvr.portRules[0].id, 'legacy-port');
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  const readOnlyDvr = page.locator('div.fixed').first();
  for (const value of ['192.168.1.10', '37777', '443', '80', '554', '123', '9000', 'DVR-ID', 'AA:BB:CC:DD:EE:FF', 'loja.example']) assert.match(await readOnlyDvr.innerText(), new RegExp(value.replaceAll('.', '\\.')));
  assert.doesNotMatch(await readOnlyDvr.innerText(), /Conexões|Portas\s*$|legacy-connection|4567/m);
  assert.equal(await readOnlyDvr.getByText('Exibir lista de logins e usuários', { exact: true }).count(), 1);
  assert.doesNotMatch(await readOnlyDvr.innerText(), /TEST-FIXTURE-SECRET/);
  await readOnlyDvr.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  await render('devices', { devices: [{ id: 'old-dvr', name: 'DVR antigo', deviceType: 'DVR', connections: [{ id: 'old-eth', type: 'Eth1', ipv4: '10.0.0.1' }], portRules: [{ id: 'old-port', portNumber: '1234' }] }], deviceLogins: [] });
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  assert.equal(await page.locator('div.fixed').first().getByText('Acesso DVR', { exact: true }).count(), 1);
  await page.locator('div.fixed').first().getByRole('button', { name: 'Fechar', exact: true }).last().click();

  const data = {
    cpanels: [{ id: 'a', domain: 'principal.example' }, { id: 'b', domain: 'backup.example' }, { id: 'empty', domain: 'vazio.example' }],
    users: [' ERP ', 'sistema', 'Financeiro', 'RH', ''].map((department, index) => ({ id: `u${index}`, cpanelId: ['a', 'a', 'b', 'missing', ''][index], name: `Pessoa ${index}`, login: `login${index}`, password: 'TEST-FIXTURE-SECRET', department }))
  };
  await render('hosting', data);
  const groups = page.locator('section');
  assert.deepEqual(await groups.evaluateAll(elements => elements.map(el => el.getAttribute('aria-label'))), ['principal.example', 'backup.example', 'Sem servidor vinculado']);
  assert.equal(await groups.getByRole('button', { name: 'Visualizar', exact: true }).count(), 5);
  assert.equal(await groups.locator('svg.lucide-monitor-cog').count(), 3); // Empty legacy department normalizes to Sistema, unchanged.
  assert.equal(await groups.locator('svg.lucide-briefcase-business').count(), 2);
  assert.equal(await groups.getByRole('img', { name: /^Departamento:/ }).count(), 5);
  for (const icon of await groups.locator('svg[aria-label^="Departamento:"]').all()) {
    assert.equal(await icon.getAttribute('aria-label'), await icon.locator('..').getAttribute('title'));
    const departmentName = (await icon.getAttribute('aria-label')).replace(/^Departamento: /, '');
    assert.equal(await icon.locator('..').innerText(), departmentName, 'Department must show its name alongside the icon, without the prefix');
  }
  assert.equal(await groups.getByText('Financeiro', { exact: true }).count(), 1);
  assert.equal(await groups.getByText('ERP', { exact: true }).count(), 1);
  assert.doesNotMatch((await groups.allTextContents()).join(' '), /TEST-FIXTURE-SECRET|Departamento:/);
  assert.match(await page.locator('main').innerText(), /Senha: \*\*\*\*/);
  await groups.getByRole('button', { name: 'Copiar login', exact: true }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'login0@principal.example');
  await groups.getByRole('button', { name: 'Copiar senha', exact: true }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'TEST-FIXTURE-SECRET');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const search = page.getByPlaceholder('Buscar por nome, login, departamento ou domínio...');
  await search.fill('Financeiro');
  assert.equal(await groups.count(), 1);
  assert.equal(await groups.getAttribute('aria-label'), 'backup.example');
  await search.fill('não existe');
  assert.equal(await groups.count(), 0);
  await page.getByText('Nenhum usuário encontrado.', { exact: true }).waitFor();
  await search.fill('');
  await page.locator('select').selectOption('a');
  assert.equal(await groups.count(), 1);
  assert.equal(await groups.getByRole('button', { name: 'Visualizar', exact: true }).count(), 2);
  await page.locator('select').selectOption('');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.HOSTING_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.HOSTING_SCREENSHOT_DIR, `hosting-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
    }
  }
  await groups.last().getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  await page.locator('div.fixed').getByText('Departamento', { exact: true }).waitFor();
  assert.ok(await page.locator('div.fixed select option[value="a"]').count() > 0);
  assert.deepEqual(errors, []);
  console.log('Access/hosting browser tests passed: all parent guards, eligible devices, grouping, legacy users, search/filter, departments, copy, masked passwords, desktop/mobile and light/dark.');
} finally {
  if (browser) await browser.close();
  await vite.close();
}
