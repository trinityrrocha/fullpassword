import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(frontendRoot, 'src/components/DevicesManager.jsx'), 'utf8');

assert.match(source, /const DEVICE_LOGIN_EXCLUDED_TYPES = new Set\(\[DEVICE_TYPE_WIFI_CONTROLLER, DEVICE_TYPE_ROUTER_GATEWAY\]\)/, 'Wi-Fi e roteador devem ser excluídos do fluxo de login');
assert.match(source, /const eligibleLoginDevices = useMemo\(\(\) => normalizedForm\.devices\.filter\(canReceiveDeviceLogin\)/, 'Modal superior deve receber somente dispositivos elegíveis');
assert.match(source, /devices=\{eligibleLoginDevices\}/, 'Select de criação deve usar dispositivos elegíveis');

const addLoginSource = source.slice(source.indexOf('const addDeviceLogin ='), source.indexOf('const saveEditedLogin ='));
assert.match(addLoginSource, /selectedDevice\.deviceType === DEVICE_TYPE_NAS_STORAGE/);
assert.match(addLoginSource, /nasUsers: \[newUser, \.\.\.normalizeNasUsers\(device\)\]/, 'NAS criado pelo modal superior deve usar nasUsers');
assert.match(addLoginSource, /selectedDevice\.deviceType === PABX_DEVICE_TYPE/);
assert.match(addLoginSource, /extensions: \[newExtension, \.\.\.normalizeExtensions\(device\)\]/, 'PABX criado pelo modal superior deve usar extensions');
assert.match(addLoginSource, /deviceLogins: \[newLogin, \.\.\.normalizedForm\.deviceLogins\]/, 'Tipos genéricos devem preservar deviceLogins');

const modalSource = source.slice(source.indexOf('function DeviceLoginModal'), source.indexOf('function DeviceModal'));
for (const expected of ['Ramal', 'Login', 'Senha', 'Departamento', 'Colaborador', 'Permissão']) {
  assert.match(modalSource, new RegExp(expected), `Campo dinâmico ausente: ${expected}`);
}
assert.match(modalSource, /isNasStorage/);
assert.match(modalSource, /isPabx/);
assert.match(modalSource, /SecurePasswordInput/, 'Senha deve continuar usando SecurePasswordInput');

assert.match(source, /const getUnifiedDeviceAccessItems/, 'Lista inferior deve ser derivada por helper único');
assert.match(source, /source: 'generic'/, 'Lista deve incluir logins genéricos');
assert.match(source, /'nasUser'/, 'Lista deve incluir usuários NAS');
assert.match(source, /'pabxExtension'/, 'Lista deve incluir ramais PABX');
assert.match(source, /const filteredAccessGroups = normalizedForm\.devices\.map/, 'Lista deve ser agrupada por dispositivo');
assert.match(source, /<DeviceTypeIcon type=\{device\.deviceType\}/, 'Grupo deve mostrar ícone do tipo do dispositivo');

assert.match(source, /function DeviceAccessListModal/, 'Modal reutilizável de logins e usuários deve existir');
assert.match(source, /aria-label="Pesquisar logins e usuários"/, 'Modal deve oferecer pesquisa');
assert.match(source, /Exibir lista de logins e usuários/, 'Formulários internos devem abrir a lista');
assert.match(source, /Ramal duplicado/, 'Ramal duplicado deve continuar destacado');
assert.match(source, /draftExtensionIsDuplicate/, 'Ramal duplicado no rascunho deve apenas avisar');

assert.match(source, /Senha: \*\*\*\*/, 'Listas devem mascarar senhas');
assert.match(source, /label="Copiar senha"/, 'Lista inferior deve permitir cópia autorizada da senha');
assert.doesNotMatch(source, /localStorage|sessionStorage/, 'Dados de acesso não podem ser persistidos no armazenamento do navegador');

console.log('Frontend unified device access tests passed.');
