import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Server, ShieldCheck, EthernetPort, Download, UserRound } from 'lucide-react';
import SecurePasswordInput from './SecurePasswordInput';
import DeleteConfirmationControl from './DeleteConfirmationControl';
import InlineField from './InlineField';

const systemOptions = [
  'Ubuntu',
  'Debian',
  'CentOS',
  'AlmaLinux',
  'Red Hat',
  'Oracle Linux',
  'CloudLinux',
  'Proxmox'
];

const connectionOptions = ['Eth1', 'Eth2', 'Eth3', 'Eth4', 'Eth5', 'VPN'];
const connectionVpnOptions = ['OpenVPN', 'WireGuard', 'ZeroTier', 'Tailscale', 'Outro'];
const protocolOptions = ['TCP', 'UDP', 'TCP/UDP', 'HTTPS', 'HTTP', 'ICMP', 'SMB', 'FTP', 'SSH', 'SMTP', 'RPD', 'ANY'];
const directionOptions = ['Entrada', 'Saída', 'Entrada/Saída'];

const sanitizePortInput = (value = '') => String(value).replace(/\D/g, '');
const sanitizeIpv4MaskInput = (value = '') => {
  const cleaned = String(value).replace(/[^0-9./]/g, '');
  const [address, ...maskParts] = cleaned.split('/');
  return maskParts.length ? `${address}/${maskParts.join('').replace(/\D/g, '')}` : address;
};

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const emptyProxmoxApi = () => ({
  username: '',
  tokenApi: '',
  tokenName: '',
  url: '',
  attachments: []
});

const emptyLinuxServer = () => ({
  id: makeId(),
  name: '',
  systemType: 'Ubuntu',
  notes: '',
  connections: [],
  portRules: [],
  proxmoxApi: emptyProxmoxApi()
});

const emptySshCredential = (serverId = '') => ({
  id: makeId(),
  serverId,
  username: '',
  password: '',
  sshPort: '22',
  publicKeyAttachment: null,
  privateKeyAttachment: null
});

const normalizeAttachments = (attachments) => Array.isArray(attachments)
  ? attachments.filter(Boolean).map((attachment) => ({
      id: attachment.id || makeId(),
      name: attachment.name || 'anexo.txt',
      type: attachment.type || 'application/octet-stream',
      size: attachment.size || 0,
      data: attachment.data || ''
    }))
  : [];

const normalizeAttachment = (attachment) => {
  if (!attachment) return null;
  return {
    id: attachment.id || makeId(),
    name: attachment.name || 'anexo',
    type: attachment.type || 'application/octet-stream',
    size: attachment.size || 0,
    data: attachment.data || ''
  };
};

const normalizeProxmoxApi = (proxmoxApi = {}) => ({
  username: proxmoxApi.username || proxmoxApi.user || '',
  tokenApi: proxmoxApi.tokenApi || proxmoxApi.token || '',
  tokenName: proxmoxApi.tokenName || '',
  url: proxmoxApi.url || '',
  attachments: normalizeAttachments(proxmoxApi.attachments)
});

const normalizeConnections = (server = {}) => {
  if (Array.isArray(server.connections)) {
    return server.connections.map((connection) => ({
      id: connection.id || makeId(),
      type: connection.type || 'Eth1',
      vpn: connection.type === 'VPN' ? (connection.vpn || connection.vpnType || 'OpenVPN') : '',
      ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')
    }));
  }

  if (server.ip) return [{ id: makeId(), type: 'Eth1', vpn: '', ipv4: sanitizeIpv4MaskInput(server.ip) }];
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

  if (server.port) {
    return [{
      id: makeId(),
      name: 'Porta principal',
      portNumber: sanitizePortInput(server.port),
      direction: 'Entrada',
      protocol: 'TCP'
    }];
  }

  return [];
};

const normalizeLinuxServer = (server = {}) => ({
  id: server.id || makeId(),
  name: server.name || server.serverName || '',
  systemType: server.systemType || server.os || server.type || 'Ubuntu',
  notes: server.notes || server.observations || server.annotations || '',
  connections: normalizeConnections(server),
  portRules: normalizePortRules(server),
  proxmoxApi: normalizeProxmoxApi(server.proxmoxApi || {})
});

const normalizeSshCredential = (credential = {}) => ({
  id: credential.id || makeId(),
  serverId: credential.serverId || '',
  username: credential.username || credential.user || '',
  password: credential.password || '',
  sshPort: sanitizePortInput(credential.sshPort || credential.port || '22'),
  publicKeyAttachment: normalizeAttachment(credential.publicKeyAttachment || credential.publicKey || null),
  privateKeyAttachment: normalizeAttachment(credential.privateKeyAttachment || credential.privateKey || null)
});

const normalizeLinuxForm = (data = {}) => {
  if (Array.isArray(data.servers) || Array.isArray(data.users) || Array.isArray(data.sshCredentials)) {
    return {
      servers: Array.isArray(data.servers) ? data.servers.map((server) => normalizeLinuxServer(server)) : [],
      sshCredentials: Array.isArray(data.sshCredentials)
        ? data.sshCredentials.map((credential) => normalizeSshCredential(credential))
        : Array.isArray(data.users)
          ? data.users.map((credential) => normalizeSshCredential(credential))
          : []
    };
  }

  const hasLegacyData = Boolean(data.port || data.passwords || data.notes || data.annotations || data.attachmentName || data.hasAttachment);
  const legacyServer = hasLegacyData
    ? [normalizeLinuxServer({
        name: 'Servidor Linux principal',
        systemType: 'Ubuntu',
        port: data.port || '',
        notes: data.notes || data.annotations || data.passwords || ''
      })]
    : [];

  return { servers: legacyServer, sshCredentials: [] };
};

const getConnectionLabel = (connection, allConnections = []) => {
  if (connection.type !== 'VPN') return connection.type;
  const vpnIndex = allConnections.filter((item) => item.type === 'VPN').findIndex((item) => item.id === connection.id);
  return `VPN ${vpnIndex + 1}`;
};

function ConnectionIcon({ type }) {
  const isVpn = String(type || '').toUpperCase() === 'VPN';
  const Icon = isVpn ? ShieldCheck : EthernetPort;
  return <Icon className={isVpn ? 'h-5 w-5 shrink-0 text-indigo-500' : 'h-5 w-5 shrink-0 text-slate-500'} />;
}

const readFileAsAttachment = (file) => new Promise((resolve, reject) => {
  if (!file) {
    resolve(null);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const data = result.includes(',') ? result.split(',')[1] : result;
    resolve({
      id: makeId(),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      data
    });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const readFilesAsAttachments = async (files) => {
  const selectedFiles = Array.from(files || []);
  const attachments = await Promise.all(selectedFiles.map((file) => readFileAsAttachment(file)));
  return attachments.filter(Boolean);
};

const downloadAttachment = (attachment) => {
  if (!attachment?.data) return;

  const binary = atob(attachment.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const blob = new Blob([bytes], { type: attachment.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name || 'anexo';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function AttachmentRow({ attachment, label, onRemove }) {
  if (!attachment) return <p className="text-xs text-slate-500">Nenhum arquivo anexado.</p>;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-sm text-slate-700 truncate">{label}: {attachment.name}</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => downloadAttachment(attachment)} className="inline-flex items-center justify-center px-3 py-1.5 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
          <Download className="w-4 h-4 mr-2" /> Download
        </button>
        {onRemove && (
          <button type="button" title="Remover" aria-label="Remover" onClick={onRemove} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function LinuxServerManager({ serverForm, setServerForm, handleSaveData, isSaving }) {
  const normalizedForm = useMemo(() => normalizeLinuxForm(serverForm), [serverForm]);
  const [serverDraft, setServerDraft] = useState(emptyLinuxServer());
  const [userDraft, setUserDraft] = useState(emptySshCredential());
  const [editingServer, setEditingServer] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [showServerCreateModal, setShowServerCreateModal] = useState(false);
  const [showUserCreateModal, setShowUserCreateModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const getServerById = (serverId) => normalizedForm.servers.find((item) => item.id === serverId);

  const getServerLabel = (serverId) => {
    const server = getServerById(serverId);
    if (!server) return 'Servidor não informado';
    return server.name ? `${server.name} - ${server.systemType || 'Linux'}` : server.systemType || 'Servidor sem nome';
  };

  const persistLinuxForm = async (nextForm, successMessage) => {
    const normalizedNextForm = normalizeLinuxForm(nextForm);
    const saved = await handleSaveData('Servidor Linux', normalizedNextForm, { successMessage });
    if (saved) setServerForm(normalizedNextForm);
    return saved;
  };

  const openCreateServerModal = () => {
    setServerDraft(emptyLinuxServer());
    setShowServerCreateModal(true);
  };

  const openCreateUserModal = () => {
    setUserDraft(emptySshCredential(normalizedForm.servers[0]?.id || ''));
    setShowUserCreateModal(true);
  };

  const addServer = async () => {
    if (!serverDraft.name.trim()) {
      alert('Informe o nome do servidor.');
      return;
    }

    const newServer = normalizeLinuxServer({ ...serverDraft, id: makeId() });
    const nextForm = {
      ...normalizedForm,
      servers: [newServer, ...normalizedForm.servers]
    };

    const saved = await persistLinuxForm(nextForm, 'Servidor Linux cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setServerDraft(emptyLinuxServer());
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
      servers: normalizedForm.servers.map((server) => server.id === editingServer.id ? normalizeLinuxServer(editingServer) : server)
    };

    const saved = await persistLinuxForm(nextForm, 'Servidor Linux atualizado e salvo no cofre.');
    if (saved) {
      setEditingServer(null);
      setDeleteConfirmation('');
    }
  };

  const deleteEditedServer = async () => {
    if (deleteConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      servers: normalizedForm.servers.filter((server) => server.id !== editingServer.id),
      sshCredentials: normalizedForm.sshCredentials.map((credential) => credential.serverId === editingServer.id ? { ...credential, serverId: '' } : credential)
    };

    const saved = await persistLinuxForm(nextForm, 'Servidor Linux excluído e cofre atualizado.');
    if (saved) {
      setEditingServer(null);
      setDeleteConfirmation('');
    }
  };

  const addSshCredential = async () => {
    if (!userDraft.serverId) {
      alert('Selecione o servidor Linux ao qual esta credencial pertence.');
      return;
    }
    if (!userDraft.username.trim()) {
      alert('Informe o usuário SSH.');
      return;
    }

    const newCredential = normalizeSshCredential({ ...userDraft, id: makeId() });
    const nextForm = {
      ...normalizedForm,
      sshCredentials: [newCredential, ...normalizedForm.sshCredentials]
    };

    const saved = await persistLinuxForm(nextForm, 'Credencial SSH cadastrada e salva automaticamente no cofre.');
    if (saved) {
      setUserDraft(emptySshCredential(userDraft.serverId));
      setShowUserCreateModal(false);
    }
  };

  const saveEditedSshCredential = async () => {
    if (!editingUser.serverId) {
      alert('Selecione o servidor Linux ao qual esta credencial pertence.');
      return;
    }
    if (!editingUser.username.trim()) {
      alert('Informe o usuário SSH.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      sshCredentials: normalizedForm.sshCredentials.map((credential) => credential.id === editingUser.id ? normalizeSshCredential(editingUser) : credential)
    };

    const saved = await persistLinuxForm(nextForm, 'Credencial SSH atualizada e salva no cofre.');
    if (saved) {
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const deleteEditedSshCredential = async () => {
    if (deleteUserConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      sshCredentials: normalizedForm.sshCredentials.filter((credential) => credential.id !== editingUser.id)
    };

    const saved = await persistLinuxForm(nextForm, 'Credencial SSH excluída e cofre atualizado.');
    if (saved) {
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const filteredCredentials = normalizedForm.sshCredentials.filter((credential) => {
    const search = userSearch.trim().toLowerCase();
    if (!search) return true;
    return [credential.username, credential.sshPort, getServerLabel(credential.serverId)].join(' ').toLowerCase().includes(search);
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium text-slate-900">Cadastro de Servidores</h3>
            <p className="text-sm text-slate-500">Cadastre e gerencie servidores Linux do cliente.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={openCreateServerModal} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> Cadastrar servidor
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {normalizedForm.servers.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum servidor Linux cadastrado.</p>
          ) : normalizedForm.servers.map((server) => (
            <div key={server.id} className="flex min-h-10 flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium text-slate-900"><Server className="h-5 w-5 shrink-0 text-slate-500" />{server.name || 'Servidor sem nome'}</p>
                <p className="truncate text-sm text-slate-500">Sistema: {server.systemType || '-'} | Conexões: {server.connections?.length || 0} | Portas: {server.portRules?.length || 0}</p>
              </div>
              <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingServer(normalizeLinuxServer(server)); setDeleteConfirmation(''); }} className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 sm:self-auto">
                <Edit2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium text-slate-900">Credenciais SSH</h3>
            <p className="text-sm text-slate-500">Cadastre usuários SSH vinculados aos servidores Linux.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={openCreateUserModal} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> Cadastrar usuário
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Pesquisar credencial SSH</label>
        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" placeholder="Buscar por usuário, porta SSH ou servidor..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4">Credenciais cadastradas</h3>
        <div className="space-y-3">
          {filteredCredentials.length === 0 ? (
            <p className="text-sm text-slate-500">{userSearch.trim() ? 'Nenhuma credencial encontrada.' : 'Nenhuma credencial SSH cadastrada.'}</p>
          ) : filteredCredentials.map((credential) => (
            <div key={credential.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <p className="font-medium text-slate-900 flex items-center gap-2"><UserRound className="h-5 w-5 shrink-0 text-slate-500" />{credential.username || 'Usuário SSH sem nome'}</p>
                <span className="text-slate-600">· Porta SSH: {credential.sshPort || '22'}</span>
                <span className="text-slate-600">· Servidor: {getServerLabel(credential.serverId)}</span>
                <span className="text-slate-600">· Chave pública: {credential.publicKeyAttachment?.name || '-'}</span>
                <span className="text-slate-600">· Chave privada: {credential.privateKeyAttachment?.name || '-'}</span>
              </div>
              <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingUser(normalizeSshCredential(credential)); setDeleteUserConfirmation(''); }} className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 sm:self-auto">
                <Edit2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {showServerCreateModal && (
        <LinuxServerModal
          title="Cadastrar servidor"
          server={serverDraft}
          setServer={setServerDraft}
          isSaving={isSaving}
          onCancel={() => setShowServerCreateModal(false)}
          onSave={addServer}
        />
      )}

      {showUserCreateModal && (
        <SshCredentialModal
          title="Cadastrar usuário"
          credential={userDraft}
          setCredential={setUserDraft}
          servers={normalizedForm.servers}
          getServerLabel={getServerLabel}
          isSaving={isSaving}
          onCancel={() => setShowUserCreateModal(false)}
          onSave={addSshCredential}
        />
      )}

      {editingServer && (
        <LinuxServerModal
          title="Detalhes do servidor Linux"
          server={editingServer}
          setServer={setEditingServer}
          isSaving={isSaving}
          deleteConfirmation={deleteConfirmation}
          setDeleteConfirmation={setDeleteConfirmation}
          onCancel={() => setEditingServer(null)}
          onSave={saveEditedServer}
          onDelete={deleteEditedServer}
        />
      )}

      {editingUser && (
        <SshCredentialModal
          title="Detalhes da credencial SSH"
          credential={editingUser}
          setCredential={setEditingUser}
          servers={normalizedForm.servers}
          getServerLabel={getServerLabel}
          isSaving={isSaving}
          deleteConfirmation={deleteUserConfirmation}
          setDeleteConfirmation={setDeleteUserConfirmation}
          onCancel={() => setEditingUser(null)}
          onSave={saveEditedSshCredential}
          onDelete={deleteEditedSshCredential}
        />
      )}
    </div>
  );
}

function LinuxServerModal({ title, server, setServer, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  const connections = normalizeConnections(server);
  const portRules = normalizePortRules(server);
  const proxmoxApi = normalizeProxmoxApi(server.proxmoxApi || {});

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
      connections: [...connections, { id: makeId(), type, vpn: type === 'VPN' ? 'OpenVPN' : '', ipv4: '' }]
    });
  };

  const updateConnection = (connectionId, field, value) => {
    setServer({
      ...server,
      connections: connections.map((connection) => connection.id === connectionId ? { ...connection, [field]: field === 'ipv4' ? sanitizeIpv4MaskInput(value) : value } : connection)
    });
  };

  const removeConnection = (connectionId) => {
    setServer({
      ...server,
      connections: connections.filter((connection) => connection.id !== connectionId)
    });
  };

  const addPortRule = () => {
    setServer({
      ...server,
      portRules: [...portRules, { id: makeId(), name: '', portNumber: '', direction: 'Entrada', protocol: 'TCP' }]
    });
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

  const updateProxmoxApi = (field, value) => {
    setServer({
      ...server,
      proxmoxApi: {
        ...proxmoxApi,
        [field]: value
      }
    });
  };

  const addProxmoxAttachments = async (files) => {
    const attachments = await readFilesAsAttachments(files);
    if (!attachments.length) return;

    setServer({
      ...server,
      proxmoxApi: {
        ...proxmoxApi,
        attachments: [...normalizeAttachments(proxmoxApi.attachments), ...attachments]
      }
    });
  };

  const removeProxmoxAttachment = (attachmentId) => {
    setServer({
      ...server,
      proxmoxApi: {
        ...proxmoxApi,
        attachments: normalizeAttachments(proxmoxApi.attachments).filter((attachment) => attachment.id !== attachmentId)
      }
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Servidor</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.name} onChange={(e) => setServer({ ...server, name: e.target.value })} placeholder="Ex: Linux Matriz" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de sistema</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={server.systemType} onChange={(e) => setServer({ ...server, systemType: e.target.value })}>
                {systemOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
              <textarea rows={3} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.notes} onChange={(e) => setServer({ ...server, notes: e.target.value })} placeholder="Observações sobre o servidor Linux"></textarea>
            </div>
          </div>

          {server.systemType === 'Proxmox' && (
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
              <h4 className="text-sm font-semibold text-slate-900 mb-4">Credencial Principal (Proxmox API)</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome do usuário</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={proxmoxApi.username} onChange={(e) => updateProxmoxApi('username', e.target.value)} placeholder="Ex: root@pam" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Token Name</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={proxmoxApi.tokenName} onChange={(e) => updateProxmoxApi('tokenName', e.target.value)} placeholder="Ex: fullpassword" />
                </div>
                <div className="sm:col-span-2 max-w-xl">
                  <SecurePasswordInput name={`proxmox_token_${server.id}`} label="Token API" value={proxmoxApi.tokenApi} onChange={(e) => updateProxmoxApi('tokenApi', e.target.value)} enableGenerator={false} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">URL: https</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={proxmoxApi.url} onChange={(e) => updateProxmoxApi('url', e.target.value)} placeholder="https://192.168.88.200:8006" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Arquivos de texto</label>
                  <input
                    type="file"
                    multiple
                    accept=".txt,.conf,.json,.yaml,.yml,.log,.pem,.key"
                    className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                    onChange={async (e) => {
                      await addProxmoxAttachments(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <div className="mt-3 space-y-2">
                    {normalizeAttachments(proxmoxApi.attachments).length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum arquivo anexado.</p>
                    ) : normalizeAttachments(proxmoxApi.attachments).map((attachment) => (
                      <AttachmentRow key={attachment.id} attachment={attachment} label="Arquivo" onRemove={() => removeProxmoxAttachment(attachment.id)} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

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
                <div key={connection.id} className={`flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 ${connection.type === 'VPN' ? 'flex-nowrap' : 'flex-wrap'}`}>
                  <div className="w-40 shrink-0 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 flex items-center gap-2"><ConnectionIcon type={connection.type} />{getConnectionLabel(connection, connections)}</div>
                  {connection.type === 'VPN' && (
                    <select aria-label="Tipo de VPN" className="w-48 shrink-0 border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={connection.vpn || 'OpenVPN'} onChange={(e) => updateConnection(connection.id, 'vpn', e.target.value)}>
                      {connectionVpnOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  )}
                  <input type="text" inputMode="decimal" className="flex-1 min-w-0 border-slate-300 rounded-md shadow-sm p-2 border" value={connection.ipv4} onChange={(e) => updateConnection(connection.id, 'ipv4', e.target.value)} placeholder="Ex: 192.168.1.10 ou 192.168.1.0/24" />
                  <button type="button" title="Remover" aria-label="Remover" onClick={() => removeConnection(connection.id)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Portas</h4>
                <p className="text-xs text-slate-500">Adicione regras de firewall sem limite.</p>
              </div>
              <button type="button" onClick={addPortRule} className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
                <Plus className="w-4 h-4 mr-2" /> Adicionar porta
              </button>
            </div>

            <div className="space-y-3">
              {portRules.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma porta adicionada.</p>
              ) : portRules.map((rule) => (
                <div key={rule.id} className="grid grid-cols-1 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 lg:grid-cols-2">
                  <InlineField label="Nome"><input type="text" aria-label="Nome" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={rule.name} onChange={(e) => updatePortRule(rule.id, 'name', e.target.value)} placeholder="Ex: SSH" /></InlineField>
                  <InlineField label="Porta"><input type="text" inputMode="numeric" aria-label="Porta" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={rule.portNumber} onChange={(e) => updatePortRule(rule.id, 'portNumber', e.target.value)} placeholder="Ex: 22" /></InlineField>
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

function SshCredentialModal({ title, credential, setCredential, servers, getServerLabel, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  const updateAttachment = async (field, files) => {
    const [attachment] = await readFilesAsAttachments(files);
    if (!attachment) return;
    setCredential({ ...credential, [field]: attachment });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5">
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
            <h4 className="text-sm font-semibold text-slate-900 mb-4">Credencial SSH</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Servidor Linux</label>
                <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={credential.serverId} onChange={(e) => setCredential({ ...credential, serverId: e.target.value })}>
                  <option value="">Selecione o servidor</option>
                  {servers.map((server) => <option key={server.id} value={server.id}>{getServerLabel(server.id)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Usuário</label>
                <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={credential.username} onChange={(e) => setCredential({ ...credential, username: e.target.value })} placeholder="Ex: root" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Porta do SSH</label>
                <input type="text" inputMode="numeric" className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={credential.sshPort} onChange={(e) => setCredential({ ...credential, sshPort: sanitizePortInput(e.target.value) })} placeholder="22" />
              </div>
              <div className="sm:col-span-2 max-w-md">
                <SecurePasswordInput name={`linux_ssh_password_${credential.id}`} label="Senha" value={credential.password} onChange={(e) => setCredential({ ...credential, password: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chave pública</label>
                <input
                  type="file"
                  accept=".pub,.txt,.pem,.key,.ppk"
                  className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                  onChange={async (e) => {
                    await updateAttachment('publicKeyAttachment', e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="mt-2">
                  <AttachmentRow attachment={credential.publicKeyAttachment} label="Chave pública" onRemove={() => setCredential({ ...credential, publicKeyAttachment: null })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chave privada</label>
                <input
                  type="file"
                  accept=".txt,.pem,.key,.ppk,.openssh"
                  className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                  onChange={async (e) => {
                    await updateAttachment('privateKeyAttachment', e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="mt-2">
                  <AttachmentRow attachment={credential.privateKeyAttachment} label="Chave privada" onRemove={() => setCredential({ ...credential, privateKeyAttachment: null })} />
                </div>
              </div>
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
