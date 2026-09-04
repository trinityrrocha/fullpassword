import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Server, ShieldCheck, EthernetPort, Download, UserRound, Eye } from 'lucide-react';
import SecurePasswordInput from './SecurePasswordInput';
import DeleteConfirmationControl from './DeleteConfirmationControl';
import ReadOnlyDetailsModal, { ReadOnlyAttachments, ReadOnlyField, ReadOnlySection } from './ReadOnlyDetailsModal';
import { downloadAttachment } from '../utils/attachments';
import CopyButton from './CopyButton';
import IpCidrInput from './IpCidrInput';
import Ipv4Input from './Ipv4Input';
import { sanitizeIpv4Input, validateIpv4, validateIpv4Cidr } from '../utils/ipCidr';
import { validateVaultAttachmentSelection } from '../utils/requestLimits';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import ServerPortsPanel from './ServerPortsPanel';
import useServerFormGuard from '../hooks/useServerFormGuard';
import { applyPortDraft, createPortDraft, hasPortDraft } from '../utils/serverPorts';

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
      name: connection.name || connection.connectionName || '',
      ipv4: sanitizeIpv4MaskInput(connection.ipv4Cidr || connection.ipv4 || connection.ip || connection.ipAddress || connection.address || ''),
      gateway: String(connection.gateway || connection.gatewayIpv4 || '').trim()
    }));
  }

  const legacyIpv4 = server.ipv4Cidr || server.ipv4 || server.ip || server.ipAddress || server.address || '';
  if (legacyIpv4) return [{ id: makeId(), type: 'Eth1', vpn: '', name: '', ipv4: sanitizeIpv4MaskInput(legacyIpv4), gateway: '' }];
  return [];
};

const normalizePortRules = (server = {}) => {
  if (Array.isArray(server.portRules)) {
    return server.portRules.map((rule) => ({
      id: rule.id || makeId(),
      name: rule.name || '',
      connectionId: rule.connectionId || '',
      isTs: rule.isTs === true,
      host: String(rule.host || rule.ip || ''),
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

const getLinuxConnectionError = (server) => {
  const sourceConnections = Array.isArray(server?.connections) ? server.connections : normalizeConnections(server);
  for (const connection of sourceConnections) {
    const ipv4Cidr = connection.ipv4Cidr || connection.ipv4 || connection.ip || connection.ipAddress || connection.address || '';
    if (validateIpv4Cidr(ipv4Cidr).state === 'invalid') {
      return `Corrija o IPV4/CIDR da conexão ${connection.type === 'VPN' ? 'VPN' : connection.type || 'Eth'} antes de salvar.`;
    }
    if (connection.type === 'VPN') continue;
    if (validateIpv4(connection.gateway || connection.gatewayIpv4 || '').state === 'invalid') {
      return `Corrija o Gateway(IPV4) da conexão ${connection.type || 'Eth'} antes de salvar.`;
    }
  }
  return '';
};

const isProxmoxServer = (server) => String(server?.systemType || server?.os || server?.type || '').toLowerCase().includes('proxmox');

function ConnectionIcon({ type }) {
  const isVpn = String(type || '').toUpperCase() === 'VPN';
  const Icon = isVpn ? ShieldCheck : EthernetPort;
  return <Icon className={isVpn ? 'h-5 w-5 shrink-0 text-indigo-500' : 'h-5 w-5 shrink-0 text-slate-500'} />;
}

function SilentCopyButton({ value, label }) {
  return <CopyButton value={value} label={`Copiar ${label}`} />;
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

const readFilesAsAttachments = async (files, existingAttachments = []) => {
  const selectedFiles = validateVaultAttachmentSelection(files, existingAttachments);
  const attachments = await Promise.all(selectedFiles.map((file) => readFileAsAttachment(file)));
  return attachments.filter(Boolean);
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
          <button type="button" title="Remover" aria-label="Remover" onClick={onRemove} className="action-icon-button action-icon-delete">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function LinuxServerManager({ serverForm, setServerForm, handleSaveData, isSaving, onDeleteModule, readOnly = false }) {
  const normalizedForm = useMemo(() => normalizeLinuxForm(serverForm), [serverForm]);
  const [serverDraft, setServerDraft] = useState(emptyLinuxServer());
  const [userDraft, setUserDraft] = useState(emptySshCredential());
  const [editingServer, setEditingServer] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [viewingServer, setViewingServer] = useState(null);
  const [viewingUser, setViewingUser] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [showServerCreateModal, setShowServerCreateModal] = useState(false);
  const [showUserCreateModal, setShowUserCreateModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userServerFilter, setUserServerFilter] = useState('');

  useClearOnVaultLock(() => {
    setServerDraft(emptyLinuxServer());
    setUserDraft(emptySshCredential());
    setEditingServer(null);
    setEditingUser(null);
    setViewingServer(null);
    setViewingUser(null);
    setDeleteConfirmation('');
    setDeleteUserConfirmation('');
    setShowServerCreateModal(false);
    setShowUserCreateModal(false);
    setUserSearch('');
    setUserServerFilter('');
  });

  const getServerById = (serverId) => normalizedForm.servers.find((item) => item.id === serverId);

  const getServerLabel = (serverId) => {
    const server = getServerById(serverId);
    if (!server) return 'Servidor não informado';
    return server.name ? `${server.name} - ${server.systemType || 'Linux'}` : server.systemType || 'Servidor sem nome';
  };

  const getServerEth1Address = (serverId) => {
    const server = getServerById(serverId);
    const eth1 = server ? normalizeLinuxServer(server).connections.find((connection) => connection.type === 'Eth1') : null;
    return eth1?.ipv4 || 'não informado';
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

  const closeCreateServerModal = () => {
    setServerDraft(emptyLinuxServer());
    setShowServerCreateModal(false);
  };

  const closeCreateUserModal = () => {
    setUserDraft(emptySshCredential(normalizedForm.servers[0]?.id || ''));
    setShowUserCreateModal(false);
  };

  const addServer = async (serverToSave = serverDraft) => {
    if (!serverToSave.name.trim()) {
      alert('Informe o nome do servidor.');
      return;
    }
    const connectionError = getLinuxConnectionError(serverToSave);
    if (connectionError) {
      alert(connectionError);
      return;
    }

    const newServer = normalizeLinuxServer({ ...serverToSave, id: makeId() });
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

  const saveEditedServer = async (serverToSave = editingServer) => {
    if (!serverToSave.name.trim()) {
      alert('Informe o nome do servidor.');
      return;
    }
    const connectionError = getLinuxConnectionError(serverToSave);
    if (connectionError) {
      alert(connectionError);
      return;
    }

    const nextForm = {
      ...normalizedForm,
      servers: normalizedForm.servers.map((server) => server.id === serverToSave.id ? normalizeLinuxServer(serverToSave) : server)
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
    if (userServerFilter && credential.serverId !== userServerFilter) return false;

    const search = userSearch.trim().toLowerCase();
    if (!search) return true;
    return [credential.username, credential.sshPort, getServerLabel(credential.serverId)].join(' ').toLowerCase().includes(search);
  });

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex min-h-10 w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1 shadow-sm sm:h-10 sm:flex-nowrap sm:py-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <button type="button" disabled={isSaving} onClick={openCreateServerModal} className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="mr-2 h-4 w-4" /> Adicionar Servidor
          </button>
          <button type="button" disabled={isSaving} onClick={openCreateUserModal} className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            <Plus className="mr-2 h-4 w-4" /> Adicionar usuário
          </button>
        </div>
        {onDeleteModule && <button type="button" title="Excluir servidor" aria-label="Excluir servidor" onClick={onDeleteModule} className="action-icon-button action-icon-delete"><Trash2 className="h-4 w-4" /></button>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 pb-4 pt-3">
        <h3 className="mb-2 text-lg font-medium text-slate-900">Servidores cadastrados</h3>
        <div className="space-y-2">
          {normalizedForm.servers.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum servidor Linux cadastrado.</p>
          ) : normalizedForm.servers.map((server) => {
            const proxmoxApi = normalizeProxmoxApi(server.proxmoxApi);
            const isProxmox = isProxmoxServer(server);
            return (
              <div key={server.id} className="flex flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 lg:flex-nowrap">
                  <strong className="flex min-w-0 items-center gap-2 truncate font-medium text-slate-900"><Server className="h-5 w-5 shrink-0 text-slate-500" />{server.name || 'Servidor sem nome'}</strong>
                  {isProxmox ? (
                    <>
                      <span>Proxmox</span>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap"><span>Login: {proxmoxApi.username || 'não informado'}</span><SilentCopyButton value={proxmoxApi.username} label="login" /></span>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap"><span>Senha: ****</span><SilentCopyButton value={proxmoxApi.tokenApi} label="senha" /></span>
                      <span className="inline-flex min-w-0 items-center gap-1"><span className="truncate">URL: {proxmoxApi.url || 'não informada'}</span><SilentCopyButton value={proxmoxApi.url} label="URL" /></span>
                    </>
                  ) : (
                    <>
                      <span className="whitespace-nowrap">Sistema: {server.systemType || '-'}</span>
                      <span className="whitespace-nowrap">Conexões: {server.connections?.length || 0}</span>
                      <span className="whitespace-nowrap">Portas: {server.portRules?.length || 0}</span>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 gap-2 self-start sm:self-auto"><button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingServer(server)} className="action-icon-button action-icon-view"><Eye className="h-4 w-4" /></button><button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { if (readOnly) { setViewingServer(server); return; } setEditingServer(normalizeLinuxServer(server)); setDeleteConfirmation(''); }} className="action-icon-button action-icon-edit"><Edit2 className="h-4 w-4" /></button></div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Pesquisar usuário</label>
          <input type="text" className="w-full rounded-md border border-slate-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" placeholder="Buscar por usuário, porta SSH ou servidor..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Filtrar por servidor</label>
          <select className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" value={userServerFilter} onChange={(e) => setUserServerFilter(e.target.value)}>
            <option value="">Todos os servidores</option>
            {normalizedForm.servers.map((server) => <option key={server.id} value={server.id}>{getServerLabel(server.id)}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 pb-5 pt-3">
        <h3 className="mb-2 text-lg font-medium text-slate-900">Usuários cadastrados</h3>
        <div className="space-y-2">
          {filteredCredentials.length === 0 ? (
            <p className="text-sm text-slate-500">{userSearch.trim() || userServerFilter ? 'Nenhum usuário encontrado.' : 'Nenhuma credencial SSH cadastrada.'}</p>
          ) : filteredCredentials.map((credential) => (
            <div key={credential.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <p className="inline-flex items-center gap-1 font-medium text-slate-900">
                  <UserRound className="mr-1 h-5 w-5 shrink-0 text-slate-500" />
                  <span>{credential.username || 'Usuário SSH sem nome'}</span>
                  <CopyButton value={credential.username} label="Copiar usuário" />
                </p>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <span>· Senha: ****</span>
                  <CopyButton value={credential.password} label="Copiar senha" />
                </span>
                <span className="text-slate-600">· Eth1: {getServerEth1Address(credential.serverId)}</span>
                <span className="text-slate-600">· Porta SSH: {credential.sshPort || '22'}</span>
                <span className="text-slate-600">· Servidor: {getServerLabel(credential.serverId)}</span>
              </div>
              <div className="flex shrink-0 gap-2 self-start sm:self-auto"><button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingUser(credential)} className="action-icon-button action-icon-view"><Eye className="h-4 w-4" /></button><button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { if (readOnly) { setViewingUser(credential); return; } setEditingUser(normalizeSshCredential(credential)); setDeleteUserConfirmation(''); }} className="action-icon-button action-icon-edit"><Edit2 className="h-4 w-4" /></button></div>
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
          onCancel={closeCreateServerModal}
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
          onCancel={closeCreateUserModal}
          onSave={addSshCredential}
        />
      )}

      {viewingServer && <LinuxServerReadOnlyModal server={viewingServer} onClose={() => setViewingServer(null)} />}
      {viewingUser && <SshCredentialReadOnlyModal credential={viewingUser} server={normalizedForm.servers.find((item) => item.id === viewingUser.serverId)} onClose={() => setViewingUser(null)} />}

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

function LinuxServerReadOnlyModal({ server, onClose }) {
  const normalized = normalizeLinuxServer(server);
  return <ReadOnlyDetailsModal title="Visualizar servidor Linux" onClose={onClose}>
    <div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField label="Servidor" value={normalized.name} /><ReadOnlyField label="Sistema" value={normalized.systemType} /><ReadOnlyField label="Observações" value={normalized.notes} /></div>
    {isProxmoxServer(normalized) && <ReadOnlySection title="Acesso Proxmox"><div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField label="URL">{normalized.proxmoxApi.url || 'não informada'} <SilentCopyButton value={normalized.proxmoxApi.url} label="URL" /></ReadOnlyField><ReadOnlyField label="Login">{normalized.proxmoxApi.username || 'não informado'} <SilentCopyButton value={normalized.proxmoxApi.username} label="login" /></ReadOnlyField><ReadOnlyField label="Senha">**** <SilentCopyButton value={normalized.proxmoxApi.tokenApi} label="senha" /></ReadOnlyField></div></ReadOnlySection>}
    <ReadOnlySection title="Conexões">{normalized.connections.length ? <div className="space-y-2">{normalized.connections.map((connection) => <div key={connection.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{getConnectionLabel(connection, normalized.connections)}{connection.type === 'VPN' ? ` / ${connection.vpn}` : ''} · {connection.ipv4 || '-'}{connection.type !== 'VPN' ? ` · Gateway: ${connection.gateway || '-'}` : ''}</div>)}</div> : <p className="text-sm text-slate-500">Nenhuma conexão cadastrada.</p>}</ReadOnlySection>
    <ServerPortsPanel server={normalized} protocols={protocolOptions} readOnly />
    <ReadOnlyAttachments files={normalized.proxmoxApi.attachments} />
  </ReadOnlyDetailsModal>;
}

function SshCredentialReadOnlyModal({ credential, server, onClose }) {
  const normalized = normalizeSshCredential(credential);
  return <ReadOnlyDetailsModal title="Visualizar credencial SSH" onClose={onClose}>
    <div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField label="Usuário">{normalized.username || '-'} <CopyButton value={normalized.username} label="Copiar usuário" /></ReadOnlyField><ReadOnlyField label="Senha">**** <CopyButton value={normalized.password} label="Copiar senha" /></ReadOnlyField><ReadOnlyField label="Porta SSH" value={normalized.sshPort} /><ReadOnlyField label="Servidor" value={server?.name || 'Servidor não informado'} /><ReadOnlyField label="Chave pública" value={normalized.publicKeyAttachment?.name} /><ReadOnlyField label="Chave privada" value={normalized.privateKeyAttachment?.name} /></div>
    <ReadOnlyAttachments files={[normalized.publicKeyAttachment, normalized.privateKeyAttachment]} />
  </ReadOnlyDetailsModal>;
}

function LinuxServerModal({ title, server, setServer, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  const connections = normalizeConnections(server);
  const [portDraft, setPortDraft] = useState(() => createPortDraft());
  const [saveError, setSaveError] = useState('');
  const saveIncludingPortDraft = async () => {
    try {
      const normalized = normalizeLinuxServer(server);
      const payload = hasPortDraft(portDraft)
        ? applyPortDraft(normalized, { ...portDraft, connectionId: portDraft.connectionId || connections[0]?.id || '' }, false)
        : normalized;
      setSaveError('');
      await onSave(payload);
    } catch (error) { setSaveError(error.message || 'Não foi possível salvar o servidor.'); }
  };
  const { requestClose, dialog } = useServerFormGuard(server, onCancel, saveIncludingPortDraft, isSaving, hasPortDraft(portDraft));
  const proxmoxApi = normalizeProxmoxApi(server.proxmoxApi || {});
  const hasInvalidConnections = connections.some((connection) => (
    validateIpv4Cidr(connection.ipv4).state === 'invalid'
    || (
      connection.type !== 'VPN'
      && validateIpv4(connection.gateway).state === 'invalid'
    )
  ));

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
      connections: [...connections, { id: makeId(), type, vpn: type === 'VPN' ? 'OpenVPN' : '', name: '', ipv4: '', gateway: '' }]
    });
  };

  const updateConnection = (connectionId, field, value) => {
    const nextValue = field === 'ipv4'
      ? sanitizeIpv4MaskInput(value)
      : field === 'gateway'
        ? sanitizeIpv4Input(value)
        : value;
    setServer({
      ...server,
      connections: connections.map((connection) => connection.id === connectionId ? { ...connection, [field]: nextValue } : connection)
    });
  };

  const removeConnection = (connectionId) => {
    setServer({
      ...server,
      connections: connections.filter((connection) => connection.id !== connectionId)
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
    try {
      const currentAttachments = normalizeAttachments(proxmoxApi.attachments);
      const attachments = await readFilesAsAttachments(files, currentAttachments);
      if (!attachments.length) return;

      setServer({
        ...server,
        proxmoxApi: {
          ...proxmoxApi,
          attachments: [...currentAttachments, ...attachments]
        }
      });
    } catch (error) {
      window.alert(error.message || 'Não foi possível adicionar o arquivo.');
    }
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
          <button type="button" onClick={requestClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-6">
          {saveError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
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

            <div className="space-y-1.5">
              {connections.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma conexão adicionada.</p>
              ) : connections.map((connection) => {
                const ipv4CidrValidation = validateIpv4Cidr(connection.ipv4);
                const gatewayValidation = validateIpv4(connection.gateway);
                const isVpn = connection.type === 'VPN';
                return (
                  <div key={connection.id} className="w-full rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
                    <div className="grid w-full grid-cols-1 items-center gap-2 p-2 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(0,1fr)_24px]">
                      <div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <ConnectionIcon type={connection.type} />
                        <span className="shrink-0">{getConnectionLabel(connection, connections)}</span>
                        <input type="text" aria-label="Nome da conexão" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-700 placeholder-slate-400 outline-none focus:ring-0 dark:text-slate-200 dark:placeholder-slate-500" value={connection.name || ''} onChange={(e) => updateConnection(connection.id, 'name', e.target.value)} placeholder="Nome" />
                      </div>
                      {isVpn ? (
                        <>
                          <select aria-label="Tipo de VPN" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={connection.vpn || 'OpenVPN'} onChange={(e) => updateConnection(connection.id, 'vpn', e.target.value)}>
                            {connectionVpnOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <IpCidrInput
                            value={connection.ipv4}
                            onChange={(value) => updateConnection(connection.id, 'ipv4', value)}
                            state={ipv4CidrValidation.state}
                            error={ipv4CidrValidation.error}
                            label=""
                            ariaLabel="IPV4/CIDR da VPN"
                            placeholder="192.168.1.10/24"
                            prefix="IPV4/"
                            required={false}
                            showHelperText={false}
                            containerClassName="w-full min-w-0"
                            inputWrapperClassName="h-10 w-full min-w-0"
                            inputClassName="text-sm tracking-normal"
                          />
                        </>
                      ) : (
                        <>
                          <IpCidrInput
                            value={connection.ipv4}
                            onChange={(value) => updateConnection(connection.id, 'ipv4', value)}
                            state={ipv4CidrValidation.state}
                            error={ipv4CidrValidation.error}
                            label=""
                            ariaLabel="IPV4/CIDR"
                            placeholder="192.168.1.10/24"
                            prefix="IPV4/"
                            required={false}
                            showHelperText={false}
                            containerClassName="w-full min-w-0"
                            inputWrapperClassName="h-10 w-full min-w-0"
                            inputClassName="text-sm tracking-normal"
                          />
                          <Ipv4Input
                            value={connection.gateway}
                            onChange={(value) => updateConnection(connection.id, 'gateway', value)}
                            state={gatewayValidation.state}
                            error={gatewayValidation.error}
                            label=""
                            ariaLabel="Gateway(IPV4)"
                            placeholder="192.168.1.1"
                            prefix="Gateway/"
                            required={false}
                            showHelperText={false}
                            containerClassName="w-full min-w-0"
                            inputWrapperClassName="h-10 w-full min-w-0"
                            inputClassName="text-sm tracking-normal"
                          />
                        </>
                      )}
                      <button type="button" title="Excluir conexão" aria-label="Excluir conexão" onClick={() => removeConnection(connection.id)} className="action-icon-button action-icon-delete justify-self-end md:justify-self-center">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <ServerPortsPanel server={{ ...server, connections }} onChange={setServer} protocols={protocolOptions} draft={portDraft} setDraft={setPortDraft} disabled={isSaving} />


        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          {onDelete && (
            <DeleteConfirmationControl value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} onDelete={onDelete} disabled={isSaving} />
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={requestClose} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
            <button type="button" disabled={isSaving || hasInvalidConnections} onClick={saveIncludingPortDraft} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}

function SshCredentialModal({ title, credential, setCredential, servers, getServerLabel, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  const { requestClose, dialog } = useServerFormGuard(credential, onCancel, onSave, isSaving);
  const updateAttachment = async (field, files) => {
    try {
      const [attachment] = await readFilesAsAttachments(files);
      if (!attachment) return;
      setCredential({ ...credential, [field]: attachment });
    } catch (error) {
      window.alert(error.message || 'Não foi possível adicionar o arquivo.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={requestClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          {onDelete && (
            <DeleteConfirmationControl value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} onDelete={onDelete} disabled={isSaving} />
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={requestClose} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
            <button type="button" disabled={isSaving} onClick={onSave} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}
