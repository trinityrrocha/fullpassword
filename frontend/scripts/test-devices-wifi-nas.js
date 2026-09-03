import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(frontendRoot, 'src/components/DevicesManager.jsx'), 'utf8');

assert.match(source, /const DEVICE_TYPE_WIFI_CONTROLLER = 'WIFI\/CONTROLLER'/);
assert.match(source, /const DEVICE_TYPE_ROUTER_GATEWAY = 'ROTEADOR\/GATEWAY'/);
assert.match(source, /const DEVICE_TYPE_NAS_STORAGE = 'NAS STORAGE'/);
assert.match(source, /NAS: DEVICE_TYPE_WIFI_CONTROLLER/, 'NAS legado deve normalizar para WIFI/CONTROLLER');
assert.match(source, /ROTEADOR: DEVICE_TYPE_ROUTER_GATEWAY/, 'ROTEADOR legado deve normalizar para ROTEADOR/GATEWAY');

const deviceTypes = source.match(/const DEVICE_TYPES = \[([^;]+)\];/)?.[1] || '';
assert.doesNotMatch(deviceTypes, /['"]NAS['"]/, 'NAS legado não pode ser opção selecionável');
assert.doesNotMatch(deviceTypes, /['"]ROTEADOR['"]/, 'ROTEADOR legado não pode ser opção selecionável');
for (const expectedType of ['DEVICE_TYPE_WIFI_CONTROLLER', "'DVR'", "'IMPRESSORA'", 'DEVICE_TYPE_NAS_STORAGE', 'PABX_DEVICE_TYPE', 'DEVICE_TYPE_ROUTER_GATEWAY']) {
  assert.ok(deviceTypes.includes(expectedType), `Tipo ausente: ${expectedType}`);
}

for (const [type, icon] of [
  ['DEVICE_TYPE_WIFI_CONTROLLER', 'WifiCog'],
  ['DVR', 'Cctv'],
  ['IMPRESSORA', 'Printer'],
  ['DEVICE_TYPE_NAS_STORAGE', 'ServerPlus'],
  ['PABX_DEVICE_TYPE', 'Phone'],
  ['DEVICE_TYPE_ROUTER_GATEWAY', 'Router']
]) {
  assert.match(source, new RegExp(`(?:\\[${type}\\]|${type}): ${icon}`), `Ícone incorreto para ${type}`);
}
assert.match(source, /function DeviceTypeIcon/, 'Helper de ícone por tipo deve existir');
assert.match(source, /<DeviceTypeIcon type=\{device\.deviceType\}/, 'Lista deve usar o ícone específico');

for (const field of ['nasAccess', 'nasUsers', 'wifiControllerAccess', 'wifiNetworks']) {
  assert.match(source, new RegExp(`${field}:`), `Campo ${field} deve existir no modelo normalizado`);
}
assert.match(source, /const normalizeNasUsers/, 'Usuários NAS devem ser normalizados');
assert.match(source, /const normalizeWifiNetworks/, 'Redes Wi-Fi devem ser normalizadas');

assert.match(source, /Acesso NAS STORAGE/, 'Formulário/visualização NAS deve mostrar acesso');
assert.match(source, /const emptyNasUserDraft/, 'NAS deve usar rascunho isolado para o novo usuário');
assert.match(source, /nasUsers: \[\{ id: makeId\(\), \.\.\.nasUserDraft \}, \.\.\.nasUsers\]/, 'Novo usuário NAS deve entrar no topo');
assert.match(source, /setNasUserDraft\(emptyNasUserDraft\(\)\)/, 'Rascunho NAS deve ser limpo depois de adicionar');
assert.match(source, /Exibir lista de logins e usuários/, 'NAS deve abrir a lista compacta de usuários');
assert.match(source, /Usuários NAS: \$\{normalizeNasUsers\(device\)\.length\}/, 'Lista deve resumir usuários NAS');
assert.match(source, /Copiar login do usuário NAS/, 'Read-only NAS deve copiar login');
assert.match(source, /Copiar senha do usuário NAS/, 'Read-only NAS deve copiar senha');

assert.match(source, /Acesso WIFI\/CONTROLLER/, 'Formulário/visualização Wi-Fi deve mostrar acesso');
assert.match(source, /Adicionar rede Wi-Fi/, 'Controller deve permitir várias redes Wi-Fi');
assert.match(source, /wifiNetworks: \[\{ id: makeId\(\).*radio24Bandwidth: '20'.*radio5Bandwidth: '40'.*radio6Bandwidth: '160'.*\}, \.\.\.wifiNetworks\]/, 'Nova rede deve entrar no topo com bandas padrão');
assert.match(source, /sanitizeVlanInput = .*replace\(\/\\D\/g, ''\)\.slice\(0, 4\)/, 'VLAN deve aceitar somente quatro dígitos');
assert.match(source, /maxLength=\{4\}/, 'Input VLAN deve limitar quatro dígitos');
assert.match(source, /const WIFI_NETWORK_TYPES = \['Padrão', 'Hotspot', 'IoT'\]/, 'Tipos de rede devem incluir Hotspot corretamente');
assert.doesNotMatch(source, /Hostpot/, 'Grafia Hostpot não pode existir');
assert.match(source, /Redes Wi-Fi: \$\{normalizeWifiNetworks\(device\)\.length\}/, 'Lista deve resumir redes Wi-Fi');
assert.match(source, /Copiar senha da rede/, 'Read-only deve copiar senha Wi-Fi');

assert.match(source, /dados de NAS STORAGE cadastrados/, 'Saída de NAS com dados deve confirmar');
assert.match(source, /dados de WIFI\/CONTROLLER cadastrados/, 'Saída de Wi-Fi com dados deve confirmar');
assert.match(source, /nasAccess: nextDeviceType === DEVICE_TYPE_NAS_STORAGE/, 'Troca de tipo deve limpar acesso NAS');
assert.match(source, /nasUsers: nextDeviceType === DEVICE_TYPE_NAS_STORAGE \? nasUsers : \[\]/, 'Troca de tipo deve limpar usuários NAS');
assert.match(source, /wifiControllerAccess: nextDeviceType === DEVICE_TYPE_WIFI_CONTROLLER/, 'Troca de tipo deve limpar acesso Wi-Fi');
assert.match(source, /wifiNetworks: nextDeviceType === DEVICE_TYPE_WIFI_CONTROLLER \? wifiNetworks : \[\]/, 'Troca de tipo deve limpar redes Wi-Fi');

const readOnlySource = source.slice(source.indexOf('function DeviceReadOnlyModal'), source.indexOf('function DeviceLoginReadOnlyModal'));
assert.doesNotMatch(readOnlySource, /<input|<select|>Salvar<|>Excluir</, 'Modal read-only não pode editar dados');
assert.match(readOnlySource, /<span>\*\*\*\*<\/span>/, 'Senhas devem permanecer mascaradas');

console.log('Frontend WIFI/CONTROLLER and NAS STORAGE tests passed.');
