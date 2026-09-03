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
assert.match(source, /const getDuplicateLogins/, 'PABX deve detectar logins duplicados');
assert.match(source, /draftLoginIsDuplicate/, 'Login duplicado no rascunho deve apenas avisar');
assert.match(source, /Login duplicado/, 'Aviso de login duplicado deve ser exibido');

const saveEditedLoginSource = source.slice(source.indexOf('const saveEditedLogin ='), source.indexOf('const deleteEditedLogin ='));
assert.match(saveEditedLoginSource, /editingLogin\.source === 'nasUser'/, 'Detalhes deve atualizar nasUsers');
assert.match(saveEditedLoginSource, /editingLogin\.source === 'pabxExtension'/, 'Detalhes deve atualizar extensions');
const lowerListSource = source.slice(source.indexOf('filteredAccessGroups.map'), source.indexOf('{showCreateModal'));
assert.doesNotMatch(lowerListSource, /accessItem\.source === 'generic'.*Detalhes/, 'Ícone Detalhes não pode ficar limitado ao login genérico');

assert.match(source, /\['DVR', 'IMPRESSORA'\]\.includes\(normalized\.deviceType\)/, 'Visualização de DVR e impressora deve mostrar a lista de acessos');
assert.match(source, /\['DVR', 'IMPRESSORA'\]\.includes\(device\.deviceType\)/, 'Cadastro de DVR e impressora deve mostrar a lista de acessos');
assert.match(source, /kind="generic"/, 'Lista de DVR e impressora deve reutilizar o modal de acessos genéricos');
const readOnlyModalSource = source.slice(source.indexOf('function DeviceReadOnlyModal'), source.indexOf('function DeviceLoginReadOnlyModal'));
assert.match(readOnlyModalSource, /kind="generic" readOnly/, 'Lista de DVR e impressora deve ser estritamente read-only na visualização');
assert.doesNotMatch(readOnlyModalSource, /onEdit=|onRemove=/, 'Visualização não pode oferecer edição ou exclusão');

assert.match(source, /function UnsavedChangesDialog/, 'Aviso reutilizável de alterações não salvas deve existir');
assert.match(source, /Alterações não salvas/, 'Aviso deve explicar as alterações pendentes');
assert.match(source, /Salvar e fechar/, 'Aviso deve permitir salvar antes de fechar');
assert.match(source, /const requestClose = \(\) =>/, 'Modais editáveis devem interceptar o fechamento');
assert.match(source, /hasNasUserDraft \|\| hasPabxExtensionDraft/, 'Rascunhos internos também devem contar como alteração não salva');
assert.match(source, /const saveDeviceIncludingDrafts = async/, 'Salvar e fechar deve preparar rascunhos pendentes');
assert.match(source, /nasUsers: \[\{ id: makeId\(\), \.\.\.nasUserDraft \}, \.\.\.nasUsers\]/, 'Rascunho NAS deve entrar no payload antes de salvar');
assert.match(source, /extensions: \[\{ id: makeId\(\), \.\.\.pabxExtensionDraft \}, \.\.\.extensions\]/, 'Rascunho PABX deve entrar no payload antes de salvar');
assert.match(source, /onSave=\{saveDeviceIncludingDrafts\}/, 'Salvar e fechar deve usar o payload com rascunhos');
assert.match(source, /onContinue=\{\(\) => setShowUnsavedDialog\(false\)\}/, 'Continuar editando deve fechar apenas o aviso');
assert.match(source, /onDiscard=\{onCancel\}/, 'Descartar deve fechar o modal sem persistir');
assert.match(source, /if \(saved\) \{[\s\S]*setEditingDevice\(null\)/, 'Modal de dispositivo só deve fechar após salvamento bem-sucedido');

const validateDeviceSource = source.slice(source.indexOf('const validateDevice ='), source.indexOf('const closeCreateDeviceModal'));
assert.doesNotMatch(validateDeviceSource, /duplicad/i, 'Duplicidade de ramal/login não pode bloquear o salvamento');

assert.match(source, /Senha: \*\*\*\*/, 'Listas devem mascarar senhas');
assert.match(source, /label="Copiar senha"/, 'Lista inferior deve permitir cópia autorizada da senha');
assert.doesNotMatch(source, /localStorage|sessionStorage/, 'Dados de acesso não podem ser persistidos no armazenamento do navegador');

console.log('Frontend unified device access tests passed.');
