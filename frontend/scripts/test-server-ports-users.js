import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import windowsPlugin from '../viteClientVaultWindowsPlugin.js';
import {
  applyPortDraft, connectionIp, connectionLabel, connectionShortLabel, createPortDraft, editablePortDirection, getServerPorts, getWindowsTsAddresses,
  hasPortDraft, PORT_DIRECTIONS, removeServerPort, sanitizeServerPort, serverHostHref, validatePortDraft
} from '../src/utils/serverPorts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const winSource = read('src/components/WindowsServerManager.jsx');
const linuxSource = read('src/components/LinuxServerManager.jsx');
const panelSource = read('src/components/ServerPortsPanel.jsx');
const guardSource = read('src/hooks/useServerFormGuard.jsx');
const connection = { id: 'eth-1', type: 'Eth1', name: 'TS', ipv4: '', gateway: '' };
assert.equal(connectionIp({ ipv4: '192.168.1.211', gateway: '192.168.1.1' }), '192.168.1.211');
assert.equal(connectionIp({ type: 'VPN', ipv4Cidr: '10.15.0.0/24' }), '10.15.0.0/24');
assert.equal(connectionIp({ ipAddress: '10.0.0.8' }), '10.0.0.8');
assert.equal(connectionIp({ gateway: '192.168.1.1' }), '');
assert.equal(connectionIp(undefined), '');
const server = {
  id: 'server-a', name: 'Servidor A', connections: [connection],
  portRules: [{ id: 'legacy-port', name: 'Antiga', portNumber: '443', protocol: 'HTTPS', direction: 'Entrada', host: 'legacy.example' }],
  tsRules: [{ id: 'legacy-ts', name: 'TS antigo', port: '3389', host: 'ts.example', direction: 'Saída', protocol: 'UDP' }]
};
const original = structuredClone(server);
const draft = { ...createPortDraft(connection.id), portNumber: '61033' };
assert.equal(createPortDraft().isTs, false);
assert.equal(createPortDraft().direction, 'Entrada');
assert.deepEqual(PORT_DIRECTIONS, ['Entrada', 'Saída']);
assert.equal(editablePortDirection('Entrada/Saída'), 'Entrada');
assert.equal(editablePortDirection('Saída'), 'Saída');
const historical = { ...server, portRules: [{ ...server.portRules[0], direction: 'Entrada/Saída' }] };
assert.equal(getServerPorts(historical)[0].direction, 'Entrada/Saída');
assert.match(validatePortDraft({ ...draft, direction: 'Entrada/Saída' }, [connection], true), /Entrada ou Saída/);
assert.equal(createPortDraft().protocol, 'TCP');
assert.equal(createPortDraft().host, '');
assert.equal(hasPortDraft(createPortDraft()), false);
assert.equal(hasPortDraft(draft), true);
assert.equal(sanitizeServerPort('a12b345678'), '12345');
for (const port of ['', '0', '65536', '999999', '12a', '1.5', '-1']) {
  assert.match(validatePortDraft({ ...draft, portNumber: port }, [connection], true), /1 e 65535/);
}
for (const port of ['1', '65535', '443']) assert.equal(validatePortDraft({ ...draft, portNumber: port }, [connection], true), '');
assert.match(validatePortDraft(draft, [], true), /conexão/);
assert.match(validatePortDraft({ ...draft, connectionId: 'other-server' }, [connection], true), /conexão/);
assert.match(validatePortDraft({ ...draft, isTs: true }, [connection], true), /Host\/DDNS/);
assert.equal(validatePortDraft({ ...draft, isTs: true, host: 'host interno' }, [connection], true), '');
assert.equal(validatePortDraft(draft, [connection], false), '');
const windows = applyPortDraft(server, { ...draft, isTs: true, host: 'new.example' }, true);
assert.equal(windows.portRules[0].portNumber, '61033');
assert.equal(windows.portRules[0].isTs, true);
assert.equal(windows.portRules[0].connectionId, connection.id);
assert.equal(Object.hasOwn(windows.portRules[0], 'ipv4'), false);
assert.equal(Object.hasOwn(windows.portRules[0], 'connectionIp'), false);
assert.deepEqual(windows.portRules.slice(1), server.portRules);
assert.deepEqual(windows.tsRules, server.tsRules);
assert.deepEqual(server, original, 'Adding must not mutate legacy data');
assert.equal(getServerPorts(windows).length, 3);
assert.equal(getWindowsTsAddresses(windows).length, 2);
assert.equal(getServerPorts(server)[0].isTs, false);
const legacyTs = getServerPorts(server).find((rule) => rule.source === 'tsRules');
const edited = applyPortDraft(server, { ...draft, editing: legacyTs, isTs: true, host: 'changed.example' }, true);
assert.equal(edited.tsRules.length, 0);
assert.equal(getServerPorts(edited).length, 2);
assert.equal(edited.portRules[0].id, 'legacy-ts');
assert.equal(edited.portRules[0].name, 'TS antigo');
assert.deepEqual(removeServerPort(server, legacyTs).portRules, server.portRules);
assert.equal(applyPortDraft(server, { ...draft, host: 'ignored.example' }, true).portRules[0].host, '');
assert.equal(applyPortDraft(server, { ...draft, editing: getServerPorts(server)[0] }, true).portRules[0].host, 'legacy.example');
const linux = applyPortDraft({ ...server, tsRules: [] }, { ...draft, host: 'web.example', protocol: 'HTTPS' }, false);
assert.equal(linux.portRules[0].host, 'web.example');
assert.equal(linux.portRules[0].isTs, false);
assert.equal(connectionLabel(connection, [connection]), 'Eth1 - TS');
assert.equal(connectionShortLabel(connection, [connection]), 'Eth1');
assert.equal(connectionShortLabel({ id: 'vpn', type: 'VPN', name: 'Matriz' }, [{ id: 'vpn', type: 'VPN' }]), 'VPN 1');
assert.equal(connectionLabel({ id: 'vpn', type: 'VPN', name: 'Matriz' }, [{ id: 'vpn', type: 'VPN' }]), 'VPN 1 - Matriz');
assert.equal(connectionLabel(null, []), 'Sem vínculo (legado)');
for (const host of ['javascript:alert(1)', 'data:text/html,example', '//evil.example', 'https://user:password@example.org']) {
  assert.equal(serverHostHref(host), undefined, host);
}
assert.equal(serverHostHref('ts.example'), 'https://ts.example/');

// Exercise the normalizer actually injected into ClientVault by the production Vite plugin.
const transformed = windowsPlugin().transform('const normalizeTsForm = (data = {}) => {\n};\n\nexport default function ClientVault() {}', '/src/ClientVault.jsx').code;
const injected = transformed.slice(0, transformed.indexOf('export default function ClientVault'));
const roundTrip = vm.runInNewContext(injected + '\nnormalizeTsForm(input)', { input: { servers: [windows], users: [] }, makeId: () => 'test-id' });
assert.equal(roundTrip.servers[0].portRules[0].host, 'new.example');
assert.equal(roundTrip.servers[0].portRules[0].isTs, true);
assert.equal(roundTrip.servers[0].portRules[0].connectionId, connection.id);
assert.equal(roundTrip.servers[0].tsRules[0].direction, 'Saída');
assert.equal(roundTrip.servers[0].tsRules[0].protocol, 'UDP');
assert.equal(roundTrip.servers[0].portRules.length, 2);

for (const source of [winSource, linuxSource]) {
  assert.match(source, /<ServerPortsPanel/);
  assert.match(source, /applyPortDraft\(normalized/);
  assert.match(source, /await onSave\(payload\)/);
  assert.match(source, /useServerFormGuard/);
  assert.match(source, /if \(saved\) \{/);
  assert.doesNotMatch(source, /Estrada\/Saída/);
  assert.doesNotMatch(source, /console\.(log|warn|error).*?(password|senha)/i);
}
assert.match(winSource, /openCreateUserModal\(server.id\)/);
assert.match(winSource, /setUserDraft\(emptyUser\(serverId\)\)/);
assert.match(winSource, /normalizedForm.users.filter\(\(user\) => user.serverId === usersServer.id\)/);
assert.doesNotMatch(winSource, /border-sky-200|bg-sky-50/);
assert.match(panelSource, /\(!windows \|\| draft.isTs\)/);
assert.match(panelSource, /setDraft\(createPortDraft\(selectedConnection\)\)/);
assert.match(panelSource, /Pesquisar portas/);
assert.match(panelSource, /!readOnly &&/);
assert.match(panelSource, /data-vault-action="edit"/);
assert.doesNotMatch(panelSource, /overflow-x-auto|localStorage|sessionStorage/);
assert.match(guardSource, /Continuar editando/);
assert.match(guardSource, /Descartar/);
assert.match(guardSource, /Salvar e fechar/);
assert.doesNotMatch(guardSource, /await onSave\(\);\s*onCancel/);
const readonlyGuard = read('src/components/VaultReadOnlyGuard.jsx');
const lockSource = readonlyGuard.slice(readonlyGuard.indexOf('const lockControl ='), readonlyGuard.indexOf('const unlockControl ='));
for (const [type, optedIn, expectedLocked] of [['search', true, false], ['search', false, true], ['password', true, true], ['text', true, true]]) {
  const control = { tagName: 'INPUT', type, dataset: optedIn ? { vaultSearch: 'true' } : {}, classList: { add() {} } };
  vm.runInNewContext(lockSource + '\nlockControl(control)', { control });
  assert.equal(control.readOnly === true, expectedLocked, 'Only explicit list search may bypass readonly input locking');
}

// Render real JSX through Vite; test-only exports never change the production modules.
const vite = await createServer({
  root, server: { middlewareMode: true }, appType: 'custom',
  plugins: [{
    name: 'expose-server-components-for-tests', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/AuthContext.jsx')) return code + '\nexport { AuthContext };';
      if (id.endsWith('/WindowsServerManager.jsx')) return code + '\nexport { WindowsServerModal, WindowsUsersListModal, WindowsServerReadOnlyModal, normalizeWindowsForm };';
      if (id.endsWith('/LinuxServerManager.jsx')) return code + '\nexport { LinuxServerModal, LinuxServerReadOnlyModal, normalizeLinuxForm };';
      return null;
    }
  }]
});
try {
  const clientVault = await vite.transformRequest('/src/pages/ClientVault.jsx');
  for (const manager of ['WindowsServerManager', 'LinuxServerManager']) {
    const usage = clientVault.code.slice(clientVault.code.lastIndexOf('jsxDEV(' + manager), clientVault.code.lastIndexOf('jsxDEV(' + manager) + 1000);
    assert.match(usage, /readOnly:/, 'Production Vite transform must pass readonly context to ' + manager);
  }
  const win = await vite.ssrLoadModule('/src/components/WindowsServerManager.jsx');
  const lin = await vite.ssrLoadModule('/src/components/LinuxServerManager.jsx');
  const panel = await vite.ssrLoadModule('/src/components/ServerPortsPanel.jsx');
  const { AuthContext } = await vite.ssrLoadModule('/src/context/AuthContext.jsx');
  const render = (Component, props) => renderToStaticMarkup(createElement(AuthContext.Provider, { value: { registerVaultLockCleanup: () => () => {} } }, createElement(Component, props)));
  const noop = () => {};
  const props = { server, onChange: noop, windows: true, draft: createPortDraft(), setDraft: noop };
  const html = render(panel.default, props);
  for (const label of ['Conexão da porta', 'Porta', 'Entrada/Saída', 'Protocolo', 'TS', 'Exibir portas configuradas']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /aria-label="Host\/DDNS"/);
  assert.match(html, /type="checkbox" aria-label="TS"/);
  assert.doesNotMatch(html, /<select[^>]*aria-label="TS"|<option[^>]*>Não<\/option>/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /value="Entrada"[^>]*>Ent\.<\/option>/);
  assert.match(html, /value="Saída"[^>]*>Saí\.<\/option>/);
  assert.doesNotMatch(html, /<option[^>]*value="Entrada\/Saída"/);
  assert.match(html, /title="Eth1 - TS"[^>]*>Eth1<\/option>/);
  assert.match(html, /md:flex-nowrap/);
  assert.match(html, /readonly="" aria-label="IP da conexão selecionada"/i);
  assert.match(html, /w-\[120px\]/);
  assert.match(html, /text-\[13px\]/);
  assert.doesNotMatch(html, /text-\[10px\]/);
  assert.match(html, /maxLength="5"/);
  const tsHtml = render(panel.default, { ...props, draft: { ...draft, isTs: true } });
  assert.match(tsHtml, /aria-label="Host\/DDNS"/);
  assert.match(tsHtml, /type="checkbox"[^>]*checked/);
  const linuxHtml = render(panel.default, { ...props, windows: false, protocols: ['TCP', 'HTTPS', 'SSH'] });
  assert.match(linuxHtml, /aria-label="Host\/DDNS"/);
  assert.doesNotMatch(linuxHtml, /aria-label="TS"/);
  assert.match(linuxHtml, /<option.*HTTPS/);
  const readOnlyHtml = render(panel.default, { server, readOnly: true, windows: true });
  assert.doesNotMatch(readOnlyHtml, /<input|<select|Editar porta|Excluir porta/);
  assert.match(readOnlyHtml, /Exibir portas configuradas/);
  const users = [{ id: 'u1', serverId: server.id, name: 'Pessoa A', username: 'login-a', password: 'TEST-ONLY-DO-NOT-DISPLAY', department: 'TI', permission: 'user' }];
  const usersHtml = render(win.WindowsUsersListModal, { server, users, readOnly: true, onClose: noop });
  assert.match(usersHtml, /Senha: \*\*\*\*/);
  assert.match(usersHtml, /login-a/);
  assert.doesNotMatch(usersHtml, /TEST-ONLY-DO-NOT-DISPLAY|Editar usuário|Excluir usuário/);
  const editableUsersHtml = render(win.WindowsUsersListModal, { server, users, readOnly: false, onClose: noop, onEdit: noop });
  assert.match(editableUsersHtml, /Editar usuário/);
  assert.match(editableUsersHtml, /Excluir usuário/);
  const managerHtml = render(win.default, { tsForm: { servers: [windows], users }, setTsForm: noop, handleSaveData: noop });
  assert.match(managerHtml, /Adicionar login/);
  assert.match(managerHtml, /Exibir lista de usuários/);
  assert.match(managerHtml, /TS: 2 configurados/);
  assert.doesNotMatch(managerHtml, /TEST-ONLY-DO-NOT-DISPLAY/);
  const savedWindows = win.normalizeWindowsForm({ servers: [windows], users });
  const savedLinux = lin.normalizeLinuxForm({ servers: [linux], sshCredentials: [] });
  assert.equal(savedWindows.servers[0].portRules[0].connectionId, connection.id);
  assert.equal(savedWindows.servers[0].portRules[0].isTs, true);
  assert.equal(savedWindows.users.length, 1);
  assert.equal(savedLinux.servers[0].portRules[0].host, 'web.example');
  const legacyWindows = win.normalizeWindowsForm({ servers: [{ id: 'old', internalPort: '3389', externalPort: '61000' }], users });
  assert.equal(legacyWindows.servers[0].portRules.length, 2);
  const legacyLinux = lin.normalizeLinuxForm({ servers: [{ id: 'old', port: '22' }] });
  assert.equal(legacyLinux.servers[0].portRules.length, 1);
  for (const [Component, data] of [[win.WindowsServerModal, savedWindows.servers[0]], [lin.LinuxServerModal, savedLinux.servers[0]]]) {
    const modalHtml = render(Component, { title: 'Teste', server: data, setServer: noop, onCancel: noop, onSave: noop });
    assert.match(modalHtml, /Exibir portas configuradas/);
  }
  console.log('Server ports/users: validation, legacy round-trip, Vite normalization and JSX rendering passed.');
} finally {
  await vite.close();
}
