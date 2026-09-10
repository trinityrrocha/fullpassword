import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const devicesSource = read('src/components/DevicesManager.jsx');
const windowsSource = read('src/components/WindowsServerManager.jsx');
const linuxSource = read('src/components/LinuxServerManager.jsx');

assert.match(devicesSource, /pppoeAccounts: \[\]/, 'Dispositivos antigos devem normalizar PPPoE como lista vazia');
assert.match(devicesSource, /wanPortRules: \[\]/, 'Dispositivos antigos devem normalizar portas WAN como lista vazia');
for (const field of ['login', 'pppoe', 'password', 'mac', 'publicIp', 'operatorName', 'supportPhone']) {
  assert.match(devicesSource, new RegExp(`${field}: (String\\(|sanitizeIpv4Input\\()`), `Normalização PPPoE sem o campo ${field}`);
}
assert.match(devicesSource, /wan: WAN_OPTIONS\.includes\(wan\) \? wan : WAN_OPTIONS\[0\]/, 'PPPoE antigo sem WAN deve usar WAN1');
assert.match(devicesSource, /const WAN_OPTIONS = \['WAN1', 'WAN2', 'WAN3', 'WAN4', 'WAN5'\]/, 'PPPoE e portas devem oferecer WAN1 até WAN5');
assert.match(devicesSource, /const WAN_PROTOCOL_OPTIONS = \['TCP', 'UDP'\]/, 'Portas WAN devem permitir somente TCP e UDP');
assert.match(devicesSource, /const WAN_DIRECTION_LABELS = \{ Entrada: 'Ent\.', Saída: 'Saí\.' \}/, 'Direções WAN devem usar rótulos compactos');
assert.match(devicesSource, /deviceType === DEVICE_TYPE_ROUTER_GATEWAY/, 'A seção PPPoE deve ser exclusiva de roteadores');
assert.match(devicesSource, /Adicionar PPPoE/, 'Roteadores devem permitir adicionar PPPoE');
assert.match(devicesSource, /pppoeAccounts: \[\{[^\n]+\}, \.\.\.pppoeAccounts\]/, 'A conta PPPoE mais recente deve entrar no topo');
assert.match(devicesSource, /Informe pelo menos a operadora ou o login/, 'Cada PPPoE deve exigir operadora ou login');
assert.match(devicesSource, /Este dispositivo possui PPPoE ou portas WAN cadastrados\./, 'Troca de tipo deve confirmar a remoção de PPPoE e portas WAN');
assert.match(devicesSource, /pppoeAccounts: nextDeviceType === DEVICE_TYPE_ROUTER_GATEWAY \? pppoeAccounts : \[\]/, 'PPPoE não pode permanecer oculto em outro tipo');
assert.match(devicesSource, /wanPortRules: nextDeviceType === DEVICE_TYPE_ROUTER_GATEWAY \? wanPortRules : \[\]/, 'Portas WAN não podem permanecer ocultas em outro tipo');
assert.match(devicesSource, /const formatRouterSummary/, 'A lista deve ter resumo do roteador');
assert.match(devicesSource, /PPPoE:.*accounts\.length.*Portas WAN:.*ports\.length/, 'O resumo deve contar PPPoE e portas WAN');
assert.match(devicesSource, /Senha PPPoE<\/span><div[^>]*><span>\*\*\*\*<\/span>/, 'A visualização deve mascarar a senha PPPoE');
assert.match(devicesSource, /<SecurePasswordInput[\s\S]*device_pppoe_password_/, 'A edição deve usar o campo seguro de senha');
assert.match(devicesSource, /label="IP Público" ariaLabel="IP Público do PPPoE"[\s\S]*?required=\{false\}/, 'IP Público deve usar a máscara IPv4 opcional');
assert.match(devicesSource, /hasInvalidPppoePublicIp/, 'IP Público inválido deve impedir o salvamento');
assert.match(devicesSource, /wanPortRules: \[\{ id: makeId\(\), \.\.\.wanPortDraft \}, \.\.\.wanPortRules\]/, 'Nova porta WAN deve entrar no topo');
assert.match(devicesSource, /Exibir portas configuradas/, 'Roteador deve abrir a lista de portas WAN');
assert.match(devicesSource, /function WanPortRulesModal/, 'Portas WAN devem possuir modal pesquisável');
assert.match(devicesSource, /aria-label="Pesquisar portas configuradas"/, 'Modal de portas WAN deve permitir pesquisa');
assert.match(devicesSource, /!\['DVR', DEVICE_TYPE_ROUTER_GATEWAY\]\.includes\(device\.deviceType\)/, 'DVR e roteador não devem mostrar conexões e portas genéricas');
assert.match(devicesSource, /h-\[32px\] w-\[60px\][^\n]+text-\[13px\]/, 'Campos de portas WAN devem ter 60x32px e fonte de 13px');

const summarySource = devicesSource.slice(
  devicesSource.indexOf('const formatRouterSummary'),
  devicesSource.indexOf('const normalizeDevicesForm')
);
assert.doesNotMatch(summarySource, /\.login|\.password/, 'O resumo não deve expor login ou senha PPPoE');

const managerSources = [
  ['Windows', windowsSource],
  ['Linux', linuxSource],
  ['Dispositivos', devicesSource]
];

for (const [name, source] of managerSources) {
  assert.match(source, /space-y-1\.5/, `${name} deve usar espaçamento compacto entre conexões`);
  assert.match(source, /md:grid-cols-\[minmax\(220px,260px\)_minmax\(0,1fr\)_minmax\(0,1fr\)_24px\]/, `${name} deve usar a grade responsiva de conexões`);
  assert.match(source, /aria-label="Excluir conexão"/, `${name} deve manter rótulo acessível na exclusão`);
  const connectionStart = source.lastIndexOf('>Conexões</h4>');
  const connectionEnd = name === 'Dispositivos'
    ? source.indexOf('<div className="border-t border-slate-200 pt-5">', connectionStart)
    : source.indexOf('<ServerPortsPanel', connectionStart);
  assert.ok(connectionEnd > connectionStart, `Fim da seção de conexões de ${name} deve ser localizado`);
  const connectionSection = source.slice(connectionStart, connectionEnd);
  assert.doesNotMatch(connectionSection, /overflow-x-auto|overflow-x-scroll|min-w-\[/, `Conexões de ${name} não devem criar rolagem horizontal`);
  const deleteConnectionButton = connectionSection.match(/<button[^\n]+aria-label="Excluir conexão"[^\n]+className="([^"]+)"/);
  assert.ok(deleteConnectionButton, `Botão de excluir conexão de ${name} não encontrado`);
  assert.doesNotMatch(deleteConnectionButton[1], /border-red|bg-red|rounded-md|h-9|w-9|h-10|w-10/, `A lixeira de ${name} deve aparecer sem botão quadrado`);
}

console.log('Frontend router WAN/PPPoE and connection layout tests passed.');
