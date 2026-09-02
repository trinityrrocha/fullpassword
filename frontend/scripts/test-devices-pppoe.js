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
for (const field of ['operatorName', 'login', 'password', 'supportPhone']) {
  assert.match(devicesSource, new RegExp(`${field}: String\\(`), `Normalização PPPoE sem o campo ${field}`);
}
assert.match(devicesSource, /deviceType === 'ROTEADOR'/, 'A seção PPPoE deve ser exclusiva de roteadores');
assert.match(devicesSource, /Adicionar PPPoE/, 'Roteadores devem permitir adicionar PPPoE');
assert.match(devicesSource, /pppoeAccounts: \[\.\.\.pppoeAccounts,/, 'Roteadores devem permitir múltiplas contas PPPoE');
assert.match(devicesSource, /Informe pelo menos a operadora ou o login/, 'Cada PPPoE deve exigir operadora ou login');
assert.match(devicesSource, /Este dispositivo possui PPPoE cadastrados\./, 'Troca de tipo deve confirmar a remoção de PPPoE');
assert.match(devicesSource, /pppoeAccounts: nextDeviceType === 'ROTEADOR' \? pppoeAccounts : \[\]/, 'PPPoE não pode permanecer oculto em outro tipo');
assert.match(devicesSource, /const formatPppoeSummary/, 'A lista deve ter resumo PPPoE');
assert.match(devicesSource, /Senha PPPoE<\/span><p[^>]*>\*\*\*\*<\/p>/, 'A visualização deve mascarar a senha PPPoE');
assert.match(devicesSource, /<SecurePasswordInput[\s\S]*device_pppoe_password_/, 'A edição deve usar o campo seguro de senha');

const summarySource = devicesSource.slice(
  devicesSource.indexOf('const formatPppoeSummary'),
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
  const connectionEnd = source.indexOf('<div className="border-t border-slate-200 pt-5">', connectionStart);
  const connectionSection = source.slice(connectionStart, connectionEnd);
  assert.doesNotMatch(connectionSection, /overflow-x-auto|overflow-x-scroll|min-w-\[/, `Conexões de ${name} não devem criar rolagem horizontal`);
  const deleteConnectionButton = connectionSection.match(/<button[^\n]+aria-label="Excluir conexão"[^\n]+className="([^"]+)"/);
  assert.ok(deleteConnectionButton, `Botão de excluir conexão de ${name} não encontrado`);
  assert.doesNotMatch(deleteConnectionButton[1], /border-red|bg-red|rounded-md|h-9|w-9|h-10|w-10/, `A lixeira de ${name} deve aparecer sem botão quadrado`);
}

console.log('Frontend device PPPoE and connection layout tests passed.');
