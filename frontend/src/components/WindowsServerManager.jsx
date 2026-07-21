import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Server, UserRound, UserStar, TriangleAlert, ShieldCheck, EthernetPort } from 'lucide-react';
import SecurePasswordInput from './SecurePasswordInput';
import DeleteConfirmationControl from './DeleteConfirmationControl';
import InlineField from './InlineField';
import VaultAttachmentsField from './VaultAttachmentsField';
import { normalizeVaultAttachments } from '../utils/vaultAttachments';

const WINDOWS_SERVER_FILE_EXTENSIONS = ['.txt', '.conf', '.json', '.xml', '.log', '.zip', '.rar'];

const permissionOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
  { value: 'user+TS', label: 'User + TS' },
  { value: 'admin+TS', label: 'Admin + TS' },
  { value: 'sistema', label: 'Sistema' }
];

const departmentOptions = [
  'Comercial',
  'Contabilidade',
  'ERP',
  'Financeiro',
  'Fiscal',
  'Gerencia',
  'Outro',
  'RH',
  'Sistema',
  'Suporte',
  'Vendas'
];

const connectionOptions = ['Eth1', 'Eth2', 'Eth3', 'Eth4', 'Eth5', 'VPN'];
const protocolOptions = ['TCP', 'UDP', 'TCP/UDP', 'HTTPS', 'HTTP', 'ICMP', 'SMB', 'FTP', 'SSH', 'SMTP', 'RPD', 'ANY'];
const directionOptions = ['Entrada', 'Saída', 'Entrada/Saída'];
const tsProtocolOptions = ['TCP', 'UDP', 'TCP/UDP'];

const sanitizePortInput = (value = '') => String(value).replace(/\D/g, '');
const sanitizeIpv4MaskInput = (value = '') => {
  const cleaned = String(value).replace(/[^0-9./]/g, '');
  const [address, ...maskParts] = cleaned.split('/');
  return maskParts.length ? `${address}/${maskParts.join('').replace(/\D/g, '')}` : address;
};

function PermissionIcon({ permission }) {
  const normalizedPermission = String(permission || '').toLowerCase();
  if (normalizedPermission === 'sistema') {
    return <TriangleAlert className="h-5 w-5 shrink-0 text-amber-500" aria-label="Sistema" />;
  }
  if (normalizedPermission.includes('admin')) {
    return <UserStar className="h-5 w-5 shrink-0 text-red-400" aria-label="Admin" />;
  }
  return <UserRound className="h-5 w-5 shrink-0 text-slate-500" aria-label="Usuário padrão" />;
}

function ConnectionIcon({ type }) {
  const isVpn = String(type || '').toUpperCase() === 'VPN';
  const Icon = isVpn ? ShieldCheck : EthernetPort;
  return <Icon className={isVpn ? 'h-5 w-5 shrink-0 text-indigo-500' : 'h-5 w-5 shrink-0 text-slate-500'} aria-label={isVpn ? 'VPN' : 'Rede'} />;
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const emptyServer = () => ({
  id: makeId(),
  name: '',
  notes: '',
  connections: [],
  portRules: [],
  tsRules: [],
  attachments: []
});

const emptyUser = (serverId = '') => ({
  id: makeId(),
  serverId,
  name: '',
  username: '',
  password: '',
  permission: 'user',
  department: ''
});

const normalizeConnections = (server = {}) => {
  if (Array.isArray(server.connections)) {
    return server.connections.map((connection) => ({
      id: connection.id || makeId(),
      type: connection.type || 'Eth1',
      ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')
    }));
  }

  if (server.ip) {
    return [{ id: makeId(), type: 'Eth1', ipv4: sanitizeIpv4MaskInput(server.ip) }];
  }

  return [];
};

const normalizePortRules = (server = {}) => {
  if (Array.isArray(server.portRules)) {
    return server.portRules.map((rule) => ({
      id: rule.id || makeId(),
      name: rule.name || '',
      portNumber: sanitizePortInput(rule.portNumber || rule.port || ''),
      direction: rule.direction || 'Entrada',
      protocol: rule.protocol || 'TCP'
    }));
  }

  const migratedRules = [];
  if (server.internalPort || server.port) {
    migratedRules.push({
      id: makeId(),
      name: 'Porta interna',
      portNumber: sanitizePortInput(server.internalPort || server.port || ''),
      direction: 'Entrada',
      protocol: 'RPD'
    });
  }
  if (server.externalPort) {
    migratedRules.push({
      id: makeId(),
      name: 'Porta externa',
      portNumber: sanitizePortInput(server.externalPort),
      direction: 'Entrada',
      protocol: 'RPD'
    });
  }

  return migratedRules;
};

const normalizeTsRules = (server = {}) => {
  if (!Array.isArray(server.tsRules)) return [];

  return server.tsRules.map((rule) => ({
    id: rule.id || makeId(),
    name: rule.name || '',
    host: rule.host || rule.ip || '',
    port: sanitizePortInput(rule.port || ''),
    direction: directionOptions.includes(rule.direction) ? rule.direction : 'Entrada',
    protocol: tsProtocolOptions.includes(rule.protocol) ? rule.protocol : 'TCP'
  }));
};

const normalizeServer = (server = {}) => ({
  id: server.id || makeId(),
  name: server.name || '',
  notes: server.notes || server.observations || '',
  connections: normalizeConnections(server),
  portRules: normalizePortRules(server),
  tsRules: normalizeTsRules(server),
  attachments: normalizeVaultAttachments(server)
});

const normalizeWindowsForm = (data = {}) => {
  if (Array.isArray(data.servers) || Array.isArray(data.users)) {
    return {
      servers: Array.isArray(data.servers)
        ? data.servers.map((server) => normalizeServer(server))
        : [],
      users: Array.isArray(data.users)
        ? data.users.map((user) => ({
            id: user.id || makeId(),
            serverId: user.serverId || '',
            name: user.name || '',
            username: user.username || user.login || '',
            password: user.password || '',
            permission: user.permission || 'user',
            department: user.department || ''
          }))
        : []
    };
  }

  const legacyServerId = `legacy-${String(data.ip || 'principal').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const legacyServer = data.ip || data.port || data.domain
    ? [normalizeServer({
        id: legacyServerId,
        name: data.domain || 'Servidor principal',
        ip: data.ip || '',
        internalPort: data.port || '',
        externalPort: data.externalPort || '',
        notes: data.notes || data.observations || ''
      })]
    : [];

  return {
    servers: legacyServer,
    users: Array.isArray(data.users)
      ? data.users.map((user) => ({
          id: user.id || makeId(),
          serverId: user.serverId || legacyServerId,
          name: user.name || '',
          username: user.username || user.login || '',
          password: user.password || '',
          permission: user.permission || 'user',
          department: user.department || ''
        }))
      : []
  };
};

const getConnectionLabel = (connection, allConnections = []) => {
  if (connection.type !== 'VPN') return connection.type;
  const vpnIndex = allConnections.filter((item) => item.type === 'VPN').findIndex((item) => item.id === connection.id);
  return `VPN ${vpnIndex + 1}`;
};

export default function WindowsServerManager({ tsForm, setTsForm, handleSaveData, isSaving }) {
  const normalizedForm = useMemo(() => normalizeWindowsForm(tsForm), [tsForm]);
  const [serverDraft, setServerDraft] = useState(emptyServer());
  const [userDraft, setUserDraft] = useState(emptyUser());
  const [editingServer, setEditingServer] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteServerConfirmation, setDeleteServerConfirmation] = useState('');
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [showServerCreateModal, setShowServerCreateModal] = useState(false);
  const [showUserCreateModal, setShowUserCreateModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const getServerById = (serverId) => normalizedForm.servers.find((item) => item.id === serverId);

  const getServerLabel = (serverId) => {
    const server = getServerById(serverId);
    if (!server) return 'Servidor não informado';
    const firstConnection = server.connections?.[0];
    return firstConnection?.ipv4 ? `${server.name || 'Servidor sem nome'} - ${firstConnection.ipv4}` : server.name || 'Servidor sem nome';
  };

  const persistWindowsForm = async (nextForm, successMessage) => {
    const saved = await handleSaveData('Servidor TS', nextForm, { successMessage });
    if (saved) setTsForm(nextForm);
    return saved;
  };

  const openCreateServerModal = () => {
    setServerDraft(emptyServer());
    setShowServerCreateModal(true);
  };

  const openCreateUserModal = () => {
    setUserDraft(emptyUser(normalizedForm.servers[0]?.id || ''));
    setShowUserCreateModal(true);
  };

  const addServer = async () => {
    if (!serverDraft.name.trim()) {
      alert('Informe o nome do servidor.');
      return;
    }

    const newServer = { ...serverDraft, id: makeId() };
    const nextForm = {
      ...normalizedForm,
      servers: [newServer, ...normalizedForm.servers]
    };

    const saved = await persistWindowsForm(nextForm, 'Servidor cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setServerDraft(emptyServer());
      setUserDraft((current) => ({ ...current, serverId: current.serverId || newServer.id }));
      setShowServerCreateModal(false);
    }
  };

  const saveEditedServer = async () => {
    if (!editingServer.name.trim()) {
      alert('Informe o nome do servidor.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      servers: normalizedForm.servers.map((server) => server.id === editingServer.id ? editingServer : server)
    };

    const saved = await persistWindowsForm(nextForm, 'Servidor atualizado e salvo no cofre.');
    if (saved) {
      setEditingServer(null);
      setDeleteServerConfirmation('');
    }
  };

  const deleteEditedServer = async () => {
    if (deleteServerConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      servers: normalizedForm.servers.filter((server) => server.id !== editingServer.id),
      users: normalizedForm.users.map((user) => user.serverId === editingServer.id ? { ...user, serverId: '' } : user)
    };

    const saved = await persistWindowsForm(nextForm, 'Servidor excluído e cofre atualizado.');
    if (saved) {
      setEditingServer(null);
      setDeleteServerConfirmation('');
    }
  };

  const addUser = async () => {
    if (!userDraft.serverId) {
      alert('Selecione o servidor ao qual este usuário pertence.');
      return;
    }
    if (!userDraft.name.trim() || !userDraft.username.trim()) {
      alert('Informe o nome e o nome do usuário.');
      return;
    }

    const newUser = { ...userDraft, id: makeId() };
    const nextForm = {
      ...normalizedForm,
      users: [newUser, ...normalizedForm.users]
    };

    const saved = await persistWindowsForm(nextForm, 'Usuário cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setUserDraft(emptyUser(userDraft.serverId));
      setShowUserCreateModal(false);
    }
  };

  const saveEditedUser = async () => {
    if (!editingUser.serverId) {
      alert('Selecione o servidor ao qual este usuário pertence.');
      return;
    }
    if (!editingUser.name.trim() || !editingUser.username.trim()) {
      alert('Informe o nome e o nome do usuário.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      users: normalizedForm.users.map((user) => user.id === editingUser.id ? editingUser : user)
    };

    const saved = await persistWindowsForm(nextForm, 'Usuário atualizado e salvo no cofre.');
    if (saved) {
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const deleteEditedUser = async () => {
    if (deleteUserConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      users: normalizedForm.users.filter((user) => user.id !== editingUser.id)
    };

    const saved = await persistWindowsForm(nextForm, 'Usuário excluído e cofre atualizado.');
    if (saved) {
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const filteredUsers = normalizedForm.users.filter((user) => {
    const search = userSearch.trim().toLowerCase();
    if (!search) return true;

    return [
      user.name,
      user.username,
      user.permission,
      user.department,
      getServerLabel(user.serverId)
    ].join(' ').toLowerCase().includes(search);
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium text-slate-900">Cadastro de Servidores</h3>
            <p className="text-sm text-slate-500">Cadastre e gerencie servidores Windows do cliente.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={openCreateServerModal} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> Cadastrar servidor
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {normalizedForm.servers.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum servidor cadastrado.</p>
          ) : normalizedForm.servers.map((server) => (
            <div key={server.id} className="flex min-h-10 flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium text-slate-900"><Server className="h-5 w-5 shrink-0 text-slate-500" />{server.name || 'Servidor sem nome'}</p>
                <p className="truncate text-sm text-slate-500">Conexões: {server.connections?.length || 0} | Portas: {server.portRules?.length || 0} | TS: {server.tsRules?.length || 0}</p>
              </div>
              <button type="button" onClick={() => { setEditingServer({ ...server }); setDeleteServerConfirmation(''); }} className="inline-flex shrink-0 items-center self-start px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50 sm:self-auto">
                <Edit2 className="w-4 h-4 mr-2" /> Detalhes
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium text-slate-900">Cadastro de Usuários</h3>
            <p className="text-sm text-slate-500">Cadastre usuários vinculados aos servidores Windows.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={openCreateUserModal} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> Adicionar Usuário
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Pesquisar usuário</label>
        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" placeholder="Buscar por nome, login, departamento, permissão ou servidor..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4">Usuários Cadastrados</h3>
        <div className="space-y-3">
          {filteredUsers.length === 0 ? (
            <p className="text-sm text-slate-500">{userSearch.trim() ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado.'}</p>
          ) : filteredUsers.map((user) => (
            <div key={user.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <p className="flex items-center gap-2 font-medium text-slate-900"><PermissionIcon permission={user.permission} />{user.name || 'Usuário sem nome'}</p>
                <span className="text-slate-600">· Usuário: {user.username || '-'}</span>
                <span className="text-slate-600">· Permissão: {user.permission || '-'}</span>
                {user.department && <span className="text-slate-600">· Depto: {user.department}</span>}
                <span className="text-slate-600">· Servidor: {getServerLabel(user.serverId)}</span>
              </div>
              <button type="button" onClick={() => { setEditingUser({ ...user }); setDeleteUserConfirmation(''); }} className="inline-flex shrink-0 items-center self-start px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50 sm:self-auto">
                <Edit2 className="w-4 h-4 mr-2" /> Detalhes
              </button>
            </div>
          ))}
        </div>
      </div>

      {showServerCreateModal && (
        <WindowsServerModal
          title="Cadastrar servidor"
          server={serverDraft}
          setServer={setServerDraft}
          isSaving={isSaving}
          onCancel={() => setShowServerCreateModal(false)}
          onSave={addServer}
        />
      )}

      {showUserCreateModal && (
        <WindowsUserModal
          title="Adicionar Usuário"
          user={userDraft}
          setUser={setUserDraft}
          servers={normalizedForm.servers}
          getServerLabel={getServerLabel}
          isSaving={isSaving}
          onCancel={() => setShowUserCreateModal(false)}
          onSave={addUser}
        />
      )}

      {editingServer && (
        <WindowsServerModal
          title="Detalhes do servidor"
          server={editingServer}
          setServer={setEditingServer}
          isSaving={isSaving}
          deleteConfirmation={deleteServerConfirmation}
          setDeleteConfirmation={setDeleteServerConfirmation}
          onCancel={() => setEditingServer(null)}
          onSave={saveEditedServer}
          onDelete={deleteEditedServer}
        />
      )}

      {editingUser && (
        <WindowsUserModal
          title="Detalhes do usuário"
          user={editingUser}
          setUser={setEditingUser}
          servers={normalizedForm.servers}
          getServerLabel={getServerLabel}
          isSaving={isSaving}
          deleteConfirmation={deleteUserConfirmation}
          setDeleteConfirmation={setDeleteUserConfirmation}
          onCancel={() => setEditingUser(null)}
          onSave={saveEditedUser}
          onDelete={deleteEditedUser}
        />
      )}
    </div>
  );
}

function WindowsServerModal({ title, server, setServer, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  const connections = normalizeConnections(server);
  const portRules = normalizePortRules(server);
  const tsRules = normalizeTsRules(server);

  const canAddConnection = (type) => {
    if (!type) return false;
    if (type === 'VPN') return connections.filter((connection) => connection.type === 'VPN').length < 5;
    return !connections.some((connection) => connection.type === type);
  };

  const addConnection = (type) => {
    if (!type) return;
    if (!canAddConnection(type)) {
      alert(type === 'VPN' ? 'A conexão VPN pode ser adicionada no máximo 5 vezes.' : `${type} já foi adicionada neste servidor.`);
      return;
    }

    setServer({
      ...server,
      connections: [...connections, { id: makeId(), type, ipv4: '' }]
    });
  };

  const updateConnection = (connectionId, ipv4) => {
    setServer({
      ...server,
      connections: connections.map((connection) => connection.id === connectionId ? { ...connection, ipv4: sanitizeIpv4MaskInput(ipv4) } : connection)
    });
  };

  const removeConnection = (connectionId) => {
    setServer({
      ...server,
      connections: connections.filter((connection) => connection.id !== connectionId)
    });
  };

  const addPortItem = (type) => {
    if (type === 'porta') {
      setServer({
        ...server,
        portRules: [...portRules, { id: makeId(), name: '', portNumber: '', direction: 'Entrada', protocol: 'TCP' }]
      });
    }
    if (type === 'ts') {
      setServer({
        ...server,
        tsRules: [...tsRules, { id: makeId(), name: '', host: '', port: '', direction: 'Entrada', protocol: 'TCP' }]
      });
    }
  };

  const updatePortRule = (ruleId, field, value) => {
    setServer({
      ...server,
      portRules: portRules.map((rule) => rule.id === ruleId ? { ...rule, [field]: field === 'portNumber' ? sanitizePortInput(value) : value } : rule)
    });
  };

  const removePortRule = (ruleId) => {
    setServer({
      ...server,
      portRules: portRules.filter((rule) => rule.id !== ruleId)
    });
  };

  const updateTsRule = (ruleId, field, value) => {
    setServer({
      ...server,
      tsRules: tsRules.map((rule) => rule.id === ruleId ? { ...rule, [field]: field === 'port' ? sanitizePortInput(value) : value } : rule)
    });
  };

  const removeTsRule = (ruleId) => {
    setServer({
      ...server,
      tsRules: tsRules.filter((rule) => rule.id !== ruleId)
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome do servidor</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.name} onChange={(e) => setServer({ ...server, name: e.target.value })} placeholder="Ex: TS Matriz" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
              <textarea rows={3} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.notes} onChange={(e) => setServer({ ...server, notes: e.target.value })} placeholder="Observações sobre o servidor"></textarea>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Conexões</h4>
                <p className="text-xs text-slate-500">Eth1 até Eth5 apenas uma vez. VPN pode ser adicionada até 5 vezes.</p>
              </div>
              <select value="" onChange={(e) => { addConnection(e.target.value); e.target.value = ''; }} className="w-full sm:w-56 border-slate-300 rounded-md shadow-sm p-2 border bg-white text-sm">
                <option value="">Adicionar conexão...</option>
                {connectionOptions.map((option) => <option key={option} value={option} disabled={!canAddConnection(option)}>{option}</option>)}
              </select>
            </div>

            <div className="space-y-3">
              {connections.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma conexão adicionada.</p>
              ) : connections.map((connection) => (
                <div key={connection.id} className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-3 items-end rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Conexão</label>
                    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700"><ConnectionIcon type={connection.type} />{getConnectionLabel(connection, connections)}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IPv4</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={connection.ipv4} onChange={(e) => updateConnection(connection.id, e.target.value)} placeholder="Ex: 192.168.1.10" />
                  </div>
                  <button type="button" title="Remover" aria-label="Remover" onClick={() => removeConnection(connection.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Portas e TS</h4>
                <p className="text-xs text-slate-500">Adicione regras de firewall ou acessos TS sem limite.</p>
              </div>
              <select value="" onChange={(e) => { addPortItem(e.target.value); e.target.value = ''; }} className="w-full sm:w-56 border-slate-300 rounded-md shadow-sm p-2 border bg-white text-sm">
                <option value="">Adicionar porta...</option>
                <option value="porta">Porta</option>
                <option value="ts">TS</option>
              </select>
            </div>

            <div className="space-y-3">
              {portRules.length === 0 && tsRules.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma porta ou TS adicionada.</p>
              ) : null}

              {portRules.map((rule) => (
                <div key={rule.id} className="grid grid-cols-1 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 lg:grid-cols-2">
                  <InlineField label="Nome"><input type="text" aria-label="Nome" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={rule.name} onChange={(e) => updatePortRule(rule.id, 'name', e.target.value)} placeholder="Ex: ERP Web" /></InlineField>
                  <InlineField label="Porta"><input type="text" aria-label="Porta" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={rule.portNumber} onChange={(e) => updatePortRule(rule.id, 'portNumber', e.target.value)} placeholder="Ex: 443" /></InlineField>
                  <InlineField label="Entrada/Saída">
                    <select aria-label="Entrada/Saída" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm" value={rule.direction} onChange={(e) => updatePortRule(rule.id, 'direction', e.target.value)}>
                      {directionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </InlineField>
                  <InlineField label="Protocolo">
                    <select aria-label="Protocolo" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm" value={rule.protocol} onChange={(e) => updatePortRule(rule.id, 'protocol', e.target.value)}>
                      {protocolOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </InlineField>
                  <button type="button" title="Remover" aria-label="Remover" onClick={() => removePortRule(rule.id)} className="inline-flex h-9 w-9 items-center justify-center justify-self-end rounded-md border border-red-300 text-red-600 hover:bg-red-50 lg:col-span-2">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {tsRules.map((rule) => (
                <div key={rule.id} className="grid grid-cols-1 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 lg:grid-cols-2">
                  <InlineField label="Nome"><input type="text" aria-label="Nome" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={rule.name} onChange={(e) => updateTsRule(rule.id, 'name', e.target.value)} placeholder="Ex: Acesso TS" /></InlineField>
                  <InlineField label="IP ou Host"><input type="text" aria-label="IP ou Host" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={rule.host} onChange={(e) => updateTsRule(rule.id, 'host', e.target.value)} placeholder="Ex: ts.empresa.com.br" /></InlineField>
                  <InlineField label="Porta"><input type="text" aria-label="Porta" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={rule.port} onChange={(e) => updateTsRule(rule.id, 'port', e.target.value)} placeholder="Ex: 3389" /></InlineField>
                  <InlineField label="Entrada/Saída"><select aria-label="Entrada/Saída" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm" value={rule.direction} onChange={(e) => updateTsRule(rule.id, 'direction', e.target.value)}>{directionOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></InlineField>
                  <InlineField label="Protocolo"><select aria-label="Protocolo" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm" value={rule.protocol} onChange={(e) => updateTsRule(rule.id, 'protocol', e.target.value)}>{tsProtocolOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></InlineField>
                  <button type="button" title="Remover" aria-label="Remover" onClick={() => removeTsRule(rule.id)} className="inline-flex h-9 w-9 items-center justify-center justify-self-end rounded-md border border-red-300 text-red-600 hover:bg-red-50 lg:col-span-2">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <VaultAttachmentsField
            title="Arquivos do Servidor Windows"
            helpText="Arquivos de texto, configuração, ZIP e RAR."
            attachments={server.attachments}
            allowedExtensions={WINDOWS_SERVER_FILE_EXTENSIONS}
            onChange={(attachments) => setServer({ ...server, attachments })}
          />

        </div>
        <div className={`flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-end ${onDelete ? 'sm:justify-between' : 'sm:justify-end'}`}>
          {onDelete && (
            <DeleteConfirmationControl value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} onDelete={onDelete} disabled={isSaving} />
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onCancel} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
            <button type="button" disabled={isSaving} onClick={onSave} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WindowsUserModal({ title, user, setUser, servers, getServerLabel, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Servidor</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={user.serverId} onChange={(e) => setUser({ ...user, serverId: e.target.value })}>
                <option value="">Selecione o servidor</option>
                {servers.map((server) => <option key={server.id} value={server.id}>{getServerLabel(server.id)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={user.name} onChange={(e) => setUser({ ...user, name: e.target.value })} placeholder="Ex: João Silva" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome do usuário</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={user.username} onChange={(e) => setUser({ ...user, username: e.target.value })} placeholder="login" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Permissão</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={user.permission} onChange={(e) => setUser({ ...user, permission: e.target.value })}>
                {permissionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Departamento</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={user.department || ''} onChange={(e) => setUser({ ...user, department: e.target.value })}>
                <option value="">Selecione...</option>
                {departmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2 max-w-md">
              <SecurePasswordInput name={`windows_user_password_${user.id}`} label="Senha" value={user.password} onChange={(e) => setUser({ ...user, password: e.target.value })} />
            </div>
          </div>

        </div>
        <div className={`flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-end ${onDelete ? 'sm:justify-between' : 'sm:justify-end'}`}>
          {onDelete && (
            <DeleteConfirmationControl value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} onDelete={onDelete} disabled={isSaving} />
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onCancel} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
            <button type="button" disabled={isSaving} onClick={onSave} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
