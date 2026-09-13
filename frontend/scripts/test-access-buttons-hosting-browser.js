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
    assert.equal(await field.evaluate(el => getComputedStyle(el).width), '77px');
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

  const printer = { id: 'printer', name: 'Impressora fiscal', deviceType: 'IMPRESSORA', connections: [{ id: 'legacy-printer-eth', type: 'Eth1', ipv4: '10.0.0.20/24', gateway: '10.0.0.1' }], printerNetwork: { ip: '192.168.1.50', mask: '/24', gateway: '192.168.1.1', printPort: '9100', mac: 'AA:00:BB:11:CC:22', dhcp: 'Off', notes: 'Recepção' } };
  await render('devices', { devices: [printer], deviceLogins: [] });
  assert.match(await page.locator('main').innerText(), /IP: 192\.168\.1\.50 · Porta: 9100 · DHCP: Off/);
  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  const printerModal = page.locator('div.fixed').first();
  const addPrinterConnection = printerModal.locator('select:has(option[value="VPN"])');
  assert.deepEqual(await addPrinterConnection.locator('option').allTextContents(), ['Adicionar conexão...', 'VPN']);
  assert.equal(await printerModal.getByText('Eth1', { exact: false }).count() > 0, true, 'Conexão ETH legada deve permanecer visível');
  for (const label of ['IP da rede estática', 'Máscara da rede estática', 'Gateway da rede estática', 'Porta de impressão', 'MAC da rede estática', 'DHCP da rede estática', 'Observação da rede estática']) assert.equal(await printerModal.getByLabel(label, { exact: true }).count(), 1);
  await printerModal.getByLabel('Porta de impressão').fill('65536');
  assert.equal(await printerModal.getByRole('button', { name: 'Salvar', exact: true }).isEnabled(), false);
  await printerModal.getByLabel('Porta de impressão').fill('9100');
  await printerModal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  if (await page.getByRole('button', { name: 'Descartar', exact: true }).count()) await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  assert.match(await page.locator('div.fixed').first().innerText(), /Rede da impressora[\s\S]*192\.168\.1\.50[\s\S]*9100[\s\S]*AA:00:BB:11:CC:22[\s\S]*Off[\s\S]*Recepção/);
  await page.locator('div.fixed').first().getByRole('button', { name: 'Fechar', exact: true }).last().click();

  const legacyRouter = {
    id: 'router',
    name: 'Roteador Matriz',
    deviceType: 'ROTEADOR/GATEWAY',
    notes: 'Roteador principal',
    pppoeAccounts: [{ id: 'legacy-pppoe', operatorName: 'Vivo', login: 'legado@provedor', password: 'LEGACY-PPPOE-SECRET', supportPhone: '0800 000 0000' }],
    connections: [{ id: 'legacy-router-connection', type: 'Eth1', ipv4: '10.10.10.1/24' }],
    portRules: [{ id: 'legacy-router-port', name: 'Legada', portNumber: '9090', direction: 'Entrada', protocol: 'TCP' }]
  };
  await render('devices', { devices: [legacyRouter], deviceLogins: [] });
  assert.match(await page.locator('main').innerText(), /Roteador Matriz \(ROTEADOR\/GATEWAY\).*PPPoE: 1 · Portas WAN: 0 · LAN: 0/s);
  assert.doesNotMatch(await page.locator('main').innerText(), /Conexões: 1|Portas: 1/);
  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  const routerModal = page.locator('div.fixed').first();
  assert.equal(await routerModal.locator('textarea').first().evaluate(el => getComputedStyle(el).height), '45px');
  assert.equal(await routerModal.getByText('Adicionar conexão', { exact: false }).count(), 0);
  assert.equal(await routerModal.getByRole('button', { name: 'Adicionar porta', exact: true }).count(), 0);
  assert.equal(await routerModal.getByText('Rede LAN', { exact: true }).count(), 1);
  assert.equal(await routerModal.getByText('Portas WAN', { exact: true }).count(), 1);
  assert.equal(await routerModal.getByLabel('WAN do PPPoE').inputValue(), 'WAN1');
  assert.deepEqual(await routerModal.getByLabel('WAN do PPPoE').locator('option').allTextContents(), ['WAN1', 'WAN2', 'WAN3', 'WAN4', 'WAN5']);
  assert.equal(await routerModal.getByLabel('IP Público do PPPoE').inputValue(), '');
  assert.equal(await routerModal.getByLabel('MAC do PPPoE').inputValue(), '');
  await routerModal.getByRole('button', { name: 'Adicionar PPPoE', exact: true }).click();
  assert.equal(await routerModal.getByLabel('WAN do PPPoE').count(), 2);
  assert.equal(await routerModal.getByLabel('WAN do PPPoE').first().inputValue(), 'WAN2');
  assert.equal(await routerModal.getByLabel('WAN do PPPoE').first().locator('option[value="WAN1"]').isDisabled(), true);
  assert.equal(await routerModal.getByLabel('WAN do PPPoE').last().locator('option[value="WAN1"]').isDisabled(), false);
  assert.equal(await routerModal.getByLabel('WAN do PPPoE').last().locator('option[value="WAN2"]').isDisabled(), true);
  await routerModal.getByLabel('Login do PPPoE').first().fill('novo@provedor');
  await routerModal.getByLabel('PPPoE', { exact: true }).first().fill('pppoe-matriz');
  await routerModal.getByLabel('Senha PPPoE', { exact: true }).first().fill('NEW-PPPOE-SECRET');
  await routerModal.getByLabel('MAC do PPPoE').first().fill('AA:BB:CC:DD:EE:FF');
  await routerModal.getByLabel('WAN do PPPoE').first().selectOption('WAN3');
  await routerModal.getByLabel('IP Público do PPPoE').first().fill('abc8.8.8.8');
  assert.equal(await routerModal.getByLabel('IP Público do PPPoE').first().inputValue(), '8.8.8.8');
  await routerModal.getByLabel('IP Público do PPPoE').first().fill('999.999.999.999');
  assert.equal(await routerModal.getByRole('button', { name: 'Salvar', exact: true }).isEnabled(), false);
  await routerModal.getByLabel('IP Público do PPPoE').first().fill('187.110.167.94');
  await routerModal.getByLabel('Operadora do PPPoE').first().fill('Claro');
  await routerModal.getByLabel('Telefone do PPPoE').first().fill('0800 111 2222');
  assert.equal(await routerModal.getByRole('button', { name: 'Salvar', exact: true }).isEnabled(), true);

  const lanIpField = routerModal.getByLabel('IP da nova rede LAN', { exact: true });
  const lanMaskField = routerModal.getByLabel('Máscara da nova rede LAN', { exact: true });
  const lanVlanField = routerModal.getByLabel('VLAN da nova rede LAN', { exact: true });
  const lanTypeField = routerModal.getByLabel('Tipo da nova rede LAN', { exact: true });
  const lanNotesField = routerModal.getByLabel('Observação da nova rede LAN', { exact: true });
  assert.equal(await routerModal.getByLabel('Gateway da nova rede LAN', { exact: true }).count(), 0);
  assert.deepEqual(await lanTypeField.locator('option').allTextContents(), ['Padrão', 'Hotspot', 'IoT']);
  assert.equal(await lanTypeField.inputValue(), 'Padrão');
  const addLanButton = lanIpField.locator('xpath=../..').getByRole('button', { name: 'Adicionar', exact: true });
  await lanIpField.fill('999.999.999.999');
  assert.equal(await addLanButton.isEnabled(), false);
  await lanIpField.fill('192.168.10.1');
  await lanMaskField.fill('255.0.255.0');
  assert.equal(await addLanButton.isEnabled(), false);
  await lanMaskField.fill('/24');
  await lanVlanField.fill('12ab345');
  assert.equal(await lanVlanField.inputValue(), '1234');
  await lanVlanField.fill('5000');
  assert.equal(await addLanButton.isEnabled(), false);
  await lanVlanField.fill('10');
  await lanTypeField.selectOption('Hotspot');
  await lanNotesField.fill('Rede visitantes');
  assert.equal(await addLanButton.isEnabled(), true);
  await addLanButton.click();
  for (const field of [lanIpField, lanMaskField, lanVlanField, lanNotesField]) assert.equal(await field.inputValue(), '');
  assert.equal(await lanTypeField.inputValue(), 'Padrão');
  await routerModal.getByText('Redes configuradas: 1', { exact: true }).waitFor();
  await routerModal.getByRole('button', { name: 'Exibir redes LAN', exact: true }).click();
  const editableLanModal = page.locator('div.fixed').last();
  assert.equal(await editableLanModal.getByLabel('Editar IP da rede 192.168.10.1').inputValue(), '192.168.10.1');
  assert.equal(await editableLanModal.getByRole('button', { name: 'Excluir rede LAN', exact: true }).count(), 1);
  const lanSearch = editableLanModal.getByLabel('Pesquisar redes LAN');
  await lanSearch.fill('Rede visitantes');
  assert.equal(await editableLanModal.getByLabel('Editar observação da rede 192.168.10.1').count(), 1);
  await lanSearch.fill('');
  await editableLanModal.getByLabel('Editar máscara da rede 192.168.10.1').fill('255.255.255.0');
  await editableLanModal.getByRole('button', { name: 'Fechar', exact: true }).click();

  const wanField = routerModal.getByLabel('WAN da nova porta', { exact: true });
  const wanPortField = routerModal.getByLabel('Porta WAN', { exact: true });
  const wanProtocolField = routerModal.getByLabel('Protocolo da porta WAN', { exact: true });
  const wanDirectionField = routerModal.getByLabel('Direção da porta WAN', { exact: true });
  const wanNotesField = routerModal.getByLabel('Observação da porta WAN', { exact: true });
  for (const field of [wanField, wanPortField, wanProtocolField, wanDirectionField]) {
    assert.deepEqual(await field.evaluate(el => { const style = getComputedStyle(el); return [style.width, style.height, style.fontSize]; }), ['60px', '32px', '13px']);
  }
  assert.deepEqual(await wanField.locator('option').allTextContents(), ['WAN1', 'WAN2', 'WAN3', 'WAN4', 'WAN5']);
  assert.deepEqual(await wanProtocolField.locator('option').allTextContents(), ['TCP', 'UDP']);
  assert.deepEqual(await wanDirectionField.locator('option').allTextContents(), ['Ent.', 'Saí.']);
  assert.deepEqual(await wanNotesField.evaluate(el => { const style = getComputedStyle(el); return [style.height, style.fontSize, style.flexGrow]; }), ['32px', '13px', '0']);
  assert.equal(await wanNotesField.locator('xpath=..').evaluate(el => getComputedStyle(el).flexGrow), '1');
  const addWanPortButton = wanField.locator('xpath=../..').getByRole('button', { name: 'Adicionar', exact: true });
  await wanPortField.fill('abc12');
  assert.equal(await wanPortField.inputValue(), '12');
  await wanPortField.fill('123456');
  assert.equal(await wanPortField.inputValue(), '12345');
  await wanPortField.fill('65536');
  assert.equal(await addWanPortButton.isEnabled(), false);
  await wanPortField.fill('443');
  await wanField.selectOption('WAN2');
  await wanProtocolField.selectOption('UDP');
  await wanDirectionField.selectOption('Saída');
  await wanNotesField.fill('HTTPS externo');
  await addWanPortButton.click();
  assert.equal(await wanPortField.inputValue(), '');
  assert.equal(await wanField.inputValue(), 'WAN2');
  assert.equal(await wanProtocolField.inputValue(), 'UDP');
  assert.equal(await wanDirectionField.inputValue(), 'Saída');
  assert.equal(await wanNotesField.inputValue(), '');
  await wanField.selectOption('WAN1');
  await wanPortField.fill('22');
  await wanNotesField.fill('SSH interno');
  await addWanPortButton.click();
  await routerModal.getByText('Portas configuradas: 2', { exact: true }).waitFor();
  await routerModal.getByRole('button', { name: 'Exibir portas configuradas', exact: true }).click();
  const editableWanModal = page.locator('div.fixed').last();
  assert.deepEqual(await editableWanModal.locator('input[aria-label^="Editar porta"]').evaluateAll(inputs => inputs.map(input => input.value)), ['22', '443']);
  assert.equal(await editableWanModal.getByRole('button', { name: 'Excluir porta WAN', exact: true }).count(), 2);
  const wanSearch = editableWanModal.getByLabel('Pesquisar portas configuradas');
  await wanSearch.fill('HTTPS externo');
  assert.equal(await editableWanModal.getByLabel('Editar porta 22').count(), 0);
  assert.equal(await editableWanModal.getByLabel('Editar porta 443').count(), 1);
  await wanSearch.fill('');
  await editableWanModal.getByLabel('Direção da porta 443').selectOption('Entrada');
  await editableWanModal.getByLabel('Editar observação da porta 443').fill('HTTPS publicado');
  assert.equal(await editableWanModal.getByLabel('Direção da porta 443').inputValue(), 'Entrada');
  await editableWanModal.getByRole('button', { name: 'Copiar porta 22', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '22');
  await editableWanModal.getByRole('button', { name: 'Fechar', exact: true }).click();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await routerModal.locator('div.max-w-4xl').evaluate(el => el.scrollWidth > el.clientWidth), false);
      if (dark) assert.notEqual(await wanPortField.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
      if (process.env.ROUTER_SCREENSHOT_DIR) await routerModal.screenshot({ path: path.join(process.env.ROUTER_SCREENSHOT_DIR, 'router-' + width + '-' + (dark ? 'dark' : 'light') + '.png') });
    }
  }
  await routerModal.getByRole('button', { name: 'Salvar', exact: true }).click();
  const savedRouter = await page.evaluate(() => window.fixtureSaves.at(-1).payload.devices.find(device => device.id === 'router'));
  assert.equal(savedRouter.pppoeAccounts.length, 2);
  assert.deepEqual(savedRouter.pppoeAccounts[0], {
    id: savedRouter.pppoeAccounts[0].id,
    login: 'novo@provedor',
    pppoe: 'pppoe-matriz',
    password: 'NEW-PPPOE-SECRET',
    mac: 'AA:BB:CC:DD:EE:FF',
    wan: 'WAN3',
    publicIp: '187.110.167.94',
    operatorName: 'Claro',
    supportPhone: '0800 111 2222'
  });
  assert.equal(savedRouter.pppoeAccounts[1].wan, 'WAN1');
  assert.equal(savedRouter.pppoeAccounts[1].mac, '');
  assert.equal(savedRouter.pppoeAccounts[1].publicIp, '');
  assert.deepEqual(savedRouter.lanNetworks.map(network => ({ ip: network.ip, mask: network.mask, vlan: network.vlan, networkType: network.networkType, notes: network.notes })), [{ ip: '192.168.10.1', mask: '255.255.255.0', vlan: '10', networkType: 'Hotspot', notes: 'Rede visitantes' }]);
  assert.deepEqual(savedRouter.wanPortRules.map(rule => rule.portNumber), ['22', '443']);
  assert.deepEqual(savedRouter.wanPortRules.map(rule => rule.notes), ['SSH interno', 'HTTPS publicado']);
  assert.equal(savedRouter.wanPortRules[1].protocol, 'UDP');
  assert.equal(savedRouter.wanPortRules[1].direction, 'Entrada');
  assert.equal(savedRouter.connections[0].id, 'legacy-router-connection');
  assert.equal(savedRouter.portRules[0].id, 'legacy-router-port');
  await render('devices', { devices: [savedRouter], deviceLogins: [] });
  assert.match(await page.locator('main').innerText(), /PPPoE: 2 · Portas WAN: 2 · LAN: 1/);

  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  const readOnlyRouter = page.locator('div.fixed').first();
  const routerText = await readOnlyRouter.innerText();
  for (const value of ['WAN3', 'novo@provedor', 'pppoe-matriz', 'AA:BB:CC:DD:EE:FF', '187.110.167.94', 'Claro', '0800 111 2222']) assert.match(routerText, new RegExp(value.replaceAll('.', '\\.')));
  assert.doesNotMatch(routerText, /NEW-PPPOE-SECRET|LEGACY-PPPOE-SECRET|legacy-router-connection|9090/);
  assert.match(routerText, /Senha PPPoE[\s\S]*\*\*\*\*/i);
  await readOnlyRouter.getByRole('button', { name: 'Copiar login PPPoE', exact: true }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'novo@provedor');
  await readOnlyRouter.getByRole('button', { name: 'Copiar senha PPPoE', exact: true }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'NEW-PPPOE-SECRET');
  await readOnlyRouter.getByRole('button', { name: 'Exibir redes LAN', exact: true }).click();
  const readOnlyLanModal = page.locator('div.fixed').last();
  assert.match(await readOnlyLanModal.innerText(), /192\.168\.10\.1[\s\S]*255\.255\.255\.0[\s\S]*10[\s\S]*Hotspot[\s\S]*Rede visitantes/);
  assert.doesNotMatch(await readOnlyLanModal.innerText(), /Gateway/);
  assert.equal(await readOnlyLanModal.getByRole('button', { name: 'Excluir rede LAN', exact: true }).count(), 0);
  await readOnlyLanModal.getByRole('button', { name: 'Copiar IP 192.168.10.1', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '192.168.10.1');
  await readOnlyLanModal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await readOnlyRouter.getByRole('button', { name: 'Exibir portas configuradas', exact: true }).click();
  const readOnlyWanModal = page.locator('div.fixed').last();
  assert.match(await readOnlyWanModal.innerText(), /WAN[\s\S]*WAN1[\s\S]*Porta[\s\S]*22[\s\S]*UDP[\s\S]*Saída[\s\S]*SSH interno/i);
  assert.equal(await readOnlyWanModal.locator('select').count(), 0);
  assert.equal(await readOnlyWanModal.getByRole('button', { name: 'Excluir porta WAN', exact: true }).count(), 0);
  await readOnlyWanModal.getByRole('button', { name: 'Copiar porta 22', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '22');
  await readOnlyWanModal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await readOnlyRouter.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  await render('devices', { devices: [{ ...legacyRouter, id: 'legacy-wan-router', pppoeAccounts: [{ id: 'assigned', login: 'assigned', wan: 'WAN1' }, { id: 'without-wan', login: 'legacy' }] }], deviceLogins: [] });
  await page.getByRole('button', { name: 'Detalhes', exact: true }).first().click();
  const legacyWanRouterModal = page.locator('div.fixed').first();
  assert.deepEqual(await legacyWanRouterModal.getByLabel('WAN do PPPoE').evaluateAll(selects => selects.map(select => select.value)), ['WAN1', 'WAN2']);
  assert.equal(await legacyWanRouterModal.getByLabel('WAN do PPPoE').last().locator('option[value="WAN1"]').isDisabled(), true);
  await legacyWanRouterModal.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await render('devices', { devices: [{ ...legacyRouter, id: 'duplicated-router', pppoeAccounts: [{ id: 'dup-a', login: 'a', wan: 'WAN1' }, { id: 'dup-b', login: 'b', wan: 'WAN1' }] }], deviceLogins: [] });
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  const duplicateRouterModal = page.locator('div.fixed').first();
  assert.equal(await duplicateRouterModal.getByText('WAN duplicada em dado antigo', { exact: true }).count(), 2);
  assert.equal((await duplicateRouterModal.innerText()).match(/WAN1/g)?.length >= 2, true);
  await duplicateRouterModal.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  const data = {
    cpanels: [{ id: 'a', domain: 'principal.example', domainExpirationDate: '2026-12-31', domainExpirationNotifyEnabled: true, domainExpirationNotifyEmails: ['admin@example.com'] }, { id: 'b', domain: 'backup.example' }, { id: 'empty', domain: 'vazio.example' }],
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
  assert.match(await page.locator('main').innerText(), /Vencimento: 31\/12\/2026[\s\S]*Notificação: ativa · E-mails: 1/);
  await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
  const hostingReadOnly = page.locator('div.fixed').first();
  assert.match(await hostingReadOnly.innerText(), /Data de vencimento do domínio[\s\S]*31\/12\/2026[\s\S]*Notificação[\s\S]*Ativa[\s\S]*admin@example\.com/i);
  assert.match(await hostingReadOnly.innerText(), /Senha[\s\S]*\*\*\*\*/i);
  await hostingReadOnly.getByRole('button', { name: 'Fechar', exact: true }).last().click();
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
