import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(frontendRoot, 'src/components/DevicesManager.jsx'), 'utf8');

const deviceTypesDeclaration = source.match(/const DEVICE_TYPES = \[([^;]+)\];/)?.[1] || '';
assert.doesNotMatch(deviceTypesDeclaration, /['"]VOIP['"]/, 'VOIP não pode permanecer como tipo selecionável');
assert.doesNotMatch(deviceTypesDeclaration, /['"]PABX['"]/, 'PABX não pode permanecer como tipo separado');
assert.match(source, /const PABX_DEVICE_TYPE = 'PABX-IP\/VOIP'/, 'O tipo unificado PABX-IP/VOIP deve existir');
assert.match(source, /const LEGACY_PABX_DEVICE_TYPES = \['PABX', 'VOIP'\]/, 'PABX e VOIP legados devem ser reconhecidos');
assert.match(source, /LEGACY_PABX_DEVICE_TYPES\.includes\(deviceType\).*return PABX_DEVICE_TYPE/, 'Tipos legados devem normalizar para PABX-IP/VOIP');

for (const field of ['url', 'login', 'password']) {
  assert.match(source, new RegExp(`${field}: String\\(device\\.pabxPortal\\?\\.${field}`), `Portal sem normalização do campo ${field}`);
}
assert.match(source, /pabxPortal: \{ url: '', login: '', password: '' \}/, 'Dispositivo antigo deve receber portal vazio seguro');
assert.match(source, /contractedExtensions: ''/, 'Quantidade contratada deve normalizar como string vazia');
assert.match(source, /extensions: \[\]/, 'Dispositivo antigo deve normalizar ramais como lista vazia');

assert.match(source, /Portal PABX-IP\/VOIP/, 'PABX deve exibir seção de portal');
assert.match(source, /device\.deviceType === PABX_DEVICE_TYPE/, 'Portal e ramais devem ser exclusivos do tipo PABX');
assert.match(source, /device_pabx_portal_password_/, 'Senha do portal deve usar SecurePasswordInput');
assert.match(source, /Copiar URL do portal/, 'Visualização deve copiar URL do portal');
assert.match(source, /Copiar login do portal/, 'Visualização deve copiar login do portal');
assert.match(source, /Copiar senha do portal/, 'Visualização deve copiar senha do portal');

assert.match(source, /Adicionar ramal/, 'PABX deve permitir adicionar ramais');
assert.match(source, /extensions: \[\{ id: makeId\(\).*\}, \.\.\.extensions\]/, 'Novo ramal deve ser inserido no topo');
assert.doesNotMatch(source, /extensions: \[\.\.\.extensions, \{ id: makeId\(\)/, 'Novo ramal não pode ser inserido no fim');
for (const field of ['extension', 'login', 'password', 'collaborator']) {
  assert.match(source, new RegExp(`${field}: String\\(extension\\?\\.${field}`), `Normalização de ramal sem o campo ${field}`);
}
assert.match(source, /department: DEPARTMENT_OPTIONS\.includes\(extension\?\.department\)/, 'Departamento do ramal deve ser normalizado');
assert.match(source, /DEPARTMENT_OPTIONS\.map\(\(department\)/, 'Ramal deve reutilizar os departamentos existentes');
assert.match(source, /Ramais contratados: .*Ramais em uso:/, 'Contador contratado/em uso deve ser exibido');
assert.match(source, /const formatPabxExtensionsSummary/, 'Lista deve mostrar resumo de ramais');
assert.match(source, /Copiar login do ramal/, 'Visualização deve copiar login do ramal');
assert.match(source, /Copiar senha do ramal/, 'Visualização deve copiar senha do ramal');
assert.match(source, /const getDuplicateExtensions/, 'Detecção de ramais duplicados deve existir');
assert.match(source, /duplicateExtensions\.has\(normalizedExtension\)/, 'Campos duplicados devem ser destacados');
assert.match(source, /Ramal duplicado/, 'Aviso de ramal duplicado deve ser exibido');

const validateDeviceSource = source.slice(source.indexOf('const validateDevice ='), source.indexOf('const closeCreateDeviceModal'));
assert.doesNotMatch(validateDeviceSource, /duplicate|duplicado|Ramal duplicado/i, 'Ramal duplicado não pode bloquear o salvamento');

const deviceModalSource = source.slice(source.indexOf('function DeviceModal'));
assert.doesNotMatch(deviceModalSource, /<h4[^>]*>Portal PABX-IP\/VOIP<\/h4>/, 'Formulário não deve exibir o cabeçalho do portal');
for (const fieldLabel of ['URL do portal', 'Login do portal', 'Senha do portal']) {
  assert.match(deviceModalSource, new RegExp(fieldLabel), `Campo ${fieldLabel} deve permanecer no formulário`);
}
assert.doesNotMatch(deviceModalSource, />Quantidade de ramais contratada</, 'Label antigo de quantidade deve ser removido');
assert.match(deviceModalSource, />Quantidade de ramal</, 'Input deve usar o label compacto de quantidade');
assert.match(source, /sanitizeContractedExtensions = .*replace\(\/\\D\/g, ''\)\.slice\(0, 3\)/, 'Quantidade deve aceitar somente três dígitos');
assert.match(deviceModalSource, /inputMode="numeric" maxLength=\{3\} className="h-9 w-20/, 'Input de quantidade deve ser compacto e limitado');
assert.match(deviceModalSource, /'space-y-3 p-5'/, 'Formulário PABX deve usar espaçamento vertical compacto');

assert.match(source, /Este dispositivo possui dados de PABX-IP\/VOIP cadastrados\./, 'Mudança de tipo com dados PABX deve pedir confirmação');
assert.match(source, /pabxPortal: nextDeviceType === PABX_DEVICE_TYPE \? pabxPortal : \{ url: '', login: '', password: '' \}/, 'Mudança de tipo deve limpar o portal');
assert.match(source, /extensions: nextDeviceType === PABX_DEVICE_TYPE \? extensions : \[\]/, 'Mudança de tipo deve limpar ramais');
assert.match(source, /pppoeAccounts: nextDeviceType === 'ROTEADOR' \? pppoeAccounts : \[\]/, 'PPPoE e PABX não podem ser misturados');

assert.match(source, /Copiar login PPPoE/, 'Visualização do roteador deve copiar login PPPoE');
assert.match(source, /Copiar senha PPPoE/, 'Visualização do roteador deve copiar senha PPPoE');
assert.match(source, /Senha PPPoE<\/span><div[^>]*><span>\*\*\*\*<\/span>/, 'Senha PPPoE deve permanecer mascarada');
assert.match(source, /Senha do portal<\/span><div[^>]*><span>\*\*\*\*<\/span>/, 'Senha do portal deve permanecer mascarada');
assert.match(source, /<span>\*\*\*\*<\/span>\{extension\.password/, 'Senha dos ramais deve permanecer mascarada');

console.log('Frontend PABX/VOIP device tests passed.');
