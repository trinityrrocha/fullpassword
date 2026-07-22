import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Eye } from 'lucide-react';
import SecurePasswordInput from './SecurePasswordInput';
import DeleteConfirmationControl from './DeleteConfirmationControl';
import InlineField from './InlineField';
import VaultAttachmentsField from './VaultAttachmentsField';
import ReadOnlyDetailsModal, { ReadOnlyAttachments, ReadOnlyField } from './ReadOnlyDetailsModal';
import CopyButton from './CopyButton';
import { normalizeVaultAttachments } from '../utils/vaultAttachments';

const VPN_SERVER_FILE_EXTENSIONS = ['.txt', '.ovpn', '.conf', '.crt', '.cer', '.key', '.pem', '.zip', '.rar'];
const VPN_USER_FILE_EXTENSIONS = ['.zip', '.rar', '.txt'];

const serverModes = [
  'Peer to Peer (SSL/TLS)',
  'Peer to Peer (Shared Key)',
  'Remote Access (SSL/TLS)',
  'Remote Access (User Auth)',
  'Remote Access SSL/TLS+(User Auth)'
];

const vpnOptions = [
  'OpenVPN',
  'WireGuard',
  'ZeroTier',
  'Tailscale'
];

const defaultServerMode = 'Remote Access SSL/TLS+(User Auth)';
const defaultVpn = 'OpenVPN';

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

const emptyVpnServer = () => ({
  id: makeId(),
  name: '',
  type: defaultServerMode,
  vpn: defaultVpn,
  ipv4Local: '',
  ipv4Tunnel: '',
  vlan: '',
  port: '',
  notes: '',
  attachments: []
});

const emptyVpnUser = (serverId = '') => ({
  id: makeId(),
  serverId,
  personName: '',
  username: '',
  password: '',
  notes: '',
  attachments: []
});

const normalizeAttachments = normalizeVaultAttachments;

const normalizeVpnForm = (data = {}) => {
  if (Array.isArray(data.servers) || Array.isArray(data.users)) {
    return {
      servers: Array.isArray(data.servers)
        ? data.servers.map((server) => ({
            id: server.id || makeId(),
            name: server.name || server.serverName || '',
            type: server.type || server.mode || defaultServerMode,
            vpn: server.vpn || server.vpnType || defaultVpn,
            ipv4Local: sanitizeIpv4MaskInput(server.ipv4Local || server.localIpv4 || ''),
            ipv4Tunnel: sanitizeIpv4MaskInput(server.ipv4Tunnel || server.tunnelIpv4 || ''),
            vlan: sanitizeIpv4MaskInput(server.vlan || ''),
            port: sanitizePortInput(server.port || ''),
            notes: server.notes || server.observations || '',
            attachments: normalizeAttachments(server)
          }))
        : [],
      users: Array.isArray(data.users)
        ? data.users.map((user) => ({
            id: user.id || makeId(),
            serverId: user.serverId || '',
            personName: user.personName || user.name || '',
            username: user.username || user.login || '',
            password: user.password || '',
            notes: user.notes || user.observations || '',
            attachments: normalizeAttachments(user)
          }))
        : []
    };
  }

  const legacyServerId = data.type || data.port || data.vlan ? `legacy-vpn-${makeId()}` : '';
  const legacyServer = legacyServerId
    ? [{
        id: legacyServerId,
        name: data.name || 'Servidor VPN principal',
        type: data.type || defaultServerMode,
        vpn: data.vpn || defaultVpn,
        ipv4Local: sanitizeIpv4MaskInput(data.ipv4Local || ''),
        ipv4Tunnel: sanitizeIpv4MaskInput(data.ipv4Tunnel || ''),
        vlan: sanitizeIpv4MaskInput(data.vlan || ''),
        port: sanitizePortInput(data.port || ''),
        notes: data.notes || '',
        attachments: []
      }]
    : [];

  const legacyUser = data.username || data.personName || data.password
    ? [{
        id: `legacy-vpn-user-${makeId()}`,
        serverId: legacyServerId,
        personName: data.personName || '',
        username: data.username || '',
        password: data.password || '',
        notes: '',
        attachments: []
      }]
    : [];

  return {
    servers: legacyServer,
    users: legacyUser
  };
};

export default function VpnManager({ vpnForm, setVpnForm, handleSaveData, isSaving, onHideModule }) {
  const normalizedForm = useMemo(() => normalizeVpnForm(vpnForm), [vpnForm]);
  const [serverDraft, setServerDraft] = useState(emptyVpnServer());
  const [userDraft, setUserDraft] = useState(emptyVpnUser());
  const [editingServer, setEditingServer] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [viewingServer, setViewingServer] = useState(null);
  const [viewingUser, setViewingUser] = useState(null);
  const [deleteServerConfirmation, setDeleteServerConfirmation] = useState('');
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [showServerCreateModal, setShowServerCreateModal] = useState(false);
  const [showUserCreateModal, setShowUserCreateModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const getServerById = (serverId) => normalizedForm.servers.find((item) => item.id === serverId);

  const getServerLabel = (serverId) => {
    const server = getServerById(serverId);
    if (!server) return 'Servidor VPN não informado';
    const name = server.name || 'Servidor VPN';
    const vpn = server.vpn ? ` - ${server.vpn}` : '';
    const detail = server.ipv4Tunnel || server.ipv4Local || server.vlan || server.port;
    return detail ? `${name}${vpn} - ${detail}` : `${name}${vpn}`;
  };

  const getServerAccessSummary = (serverId) => {
    const server = getServerById(serverId);
    return `${server?.ipv4Local || 'não informado'} - ${server?.vpn || 'VPN'}`;
  };

  const persistVpnForm = async (nextForm, successMessage) => {
    const saved = await handleSaveData('VPN', nextForm, { successMessage });
    if (saved) setVpnForm(nextForm);
    return saved;
  };

  const openCreateServerModal = () => {
    setServerDraft(emptyVpnServer());
    setShowServerCreateModal(true);
  };

  const openCreateUserModal = () => {
    setUserDraft(emptyVpnUser(normalizedForm.servers[0]?.id || ''));
    setShowUserCreateModal(true);
  };

  const addVpnServer = async () => {
    if (!serverDraft.name.trim()) {
      alert('Informe o nome do servidor VPN.');
      return;
    }
    if (!serverDraft.type) {
      alert('Selecione o modo de servidor.');
      return;
    }
    if (!serverDraft.vpn) {
      alert('Selecione a VPN.');
      return;
    }

    const newServer = { ...serverDraft, id: makeId(), attachments: normalizeAttachments(serverDraft) };
    const nextForm = {
      ...normalizedForm,
      servers: [newServer, ...normalizedForm.servers]
    };

    const saved = await persistVpnForm(nextForm, 'Servidor VPN cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setServerDraft(emptyVpnServer());
      setUserDraft((current) => ({ ...current, serverId: current.serverId || newServer.id }));
      setShowServerCreateModal(false);
    }
  };

  const saveEditedServer = async () => {
    if (!editingServer.name.trim()) {
      alert('Informe o nome do servidor VPN.');
      return;
    }
    if (!editingServer.type) {
      alert('Selecione o modo de servidor.');
      return;
    }
    if (!editingServer.vpn) {
      alert('Selecione a VPN.');
      return;
    }

    const updatedServer = { ...editingServer, attachments: normalizeAttachments(editingServer) };
    const nextForm = {
      ...normalizedForm,
      servers: normalizedForm.servers.map((server) => server.id === updatedServer.id ? updatedServer : server)
    };

    const saved = await persistVpnForm(nextForm, 'Servidor VPN atualizado e salvo no cofre.');
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

    const saved = await persistVpnForm(nextForm, 'Servidor VPN excluído e cofre atualizado.');
    if (saved) {
      setEditingServer(null);
      setDeleteServerConfirmation('');
    }
  };

  const addVpnUser = async () => {
    if (!userDraft.serverId) {
      alert('Selecione o servidor VPN ao qual este usuário pertence.');
      return;
    }
    if (!userDraft.personName.trim() || !userDraft.username.trim()) {
      alert('Informe a pessoa vinculada e o usuário VPN.');
      return;
    }

    const newUser = { ...userDraft, id: makeId() };
    const nextForm = {
      ...normalizedForm,
      users: [newUser, ...normalizedForm.users]
    };

    const saved = await persistVpnForm(nextForm, 'Usuário VPN cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setUserDraft(emptyVpnUser(userDraft.serverId));
      setShowUserCreateModal(false);
    }
  };

  const saveEditedUser = async () => {
    if (!editingUser.serverId) {
      alert('Selecione o servidor VPN ao qual este usuário pertence.');
      return;
    }
    if (!editingUser.personName.trim() || !editingUser.username.trim()) {
      alert('Informe a pessoa vinculada e o usuário VPN.');
      return;
    }

    const nextForm = {
      ...normalizedForm,
      users: normalizedForm.users.map((user) => user.id === editingUser.id ? editingUser : user)
    };

    const saved = await persistVpnForm(nextForm, 'Usuário VPN atualizado e salvo no cofre.');
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

    const saved = await persistVpnForm(nextForm, 'Usuário VPN excluído e cofre atualizado.');
    if (saved) {
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const filteredUsers = normalizedForm.users.filter((user) => {
    const search = userSearch.trim().toLowerCase();
    if (!search) return true;

    return [
      user.personName,
      user.username,
      user.notes,
      getServerLabel(user.serverId)
    ].join(' ').toLowerCase().includes(search);
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-medium text-slate-900">{onHideModule && <button type="button" title="Ocultar aba" aria-label="Ocultar aba" onClick={onHideModule} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}Servidores VPN</h3>
            <p className="text-sm text-slate-500">Cadastre e gerencie servidores VPN do cliente.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={openCreateServerModal} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> Adicionar Servidor
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {normalizedForm.servers.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum servidor VPN cadastrado.</p>
          ) : normalizedForm.servers.map((server) => (
            <div key={server.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
              <div className="space-y-1">
                <p className="font-medium text-slate-900">{server.name || 'Servidor VPN sem nome'} - {server.vpn || '-'}</p>
                <p className="text-sm text-slate-500">Modo: {server.type || '-'} | IPv4 túnel: {server.ipv4Tunnel || '-'}</p>
                <p className="text-xs text-slate-500">IPv4 local: {server.ipv4Local || '-'} | VLAN: {server.vlan || '-'} | Porta: {server.port || '-'} | Anexos: {normalizeAttachments(server).length}</p>
              </div>
              <div className="flex shrink-0 gap-2"><button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingServer(server)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Eye className="h-4 w-4" /></button><button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingServer({ ...server, attachments: normalizeAttachments(server) }); setDeleteServerConfirmation(''); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Edit2 className="h-4 w-4" /></button></div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium text-slate-900">Usuários VPN</h3>
            <p className="text-sm text-slate-500">Cadastre usuários e logins vinculados aos servidores VPN.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={openCreateUserModal} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-4 h-4 mr-2" /> Adicionar usuário
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Pesquisar usuários ou logins</label>
        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" placeholder="Buscar por pessoa, usuário VPN, observação ou servidor..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4">Usuários cadastrados</h3>
        <div className="space-y-3">
          {filteredUsers.length === 0 ? (
            <p className="text-sm text-slate-500">{userSearch.trim() ? 'Nenhum usuário encontrado.' : 'Nenhum usuário VPN cadastrado.'}</p>
          ) : filteredUsers.map((user) => (
            <div key={user.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <p className="font-medium text-slate-900">{user.personName || 'Pessoa não informada'}</p>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <span>· Login VPN: {user.username || '-'}</span>
                  <CopyButton value={user.username} label="Copiar login VPN" />
                </span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <span>· Senha: ****</span>
                  <CopyButton value={user.password} label="Copiar senha VPN" />
                </span>
                <span className="text-slate-600">· IPv4 Local: {getServerAccessSummary(user.serverId)}</span>
              </div>
              <div className="flex shrink-0 gap-2 self-start sm:self-auto"><button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingUser(user)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Eye className="h-4 w-4" /></button><button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingUser({ ...user }); setDeleteUserConfirmation(''); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Edit2 className="h-4 w-4" /></button></div>
            </div>
          ))}
        </div>
      </div>

      {showServerCreateModal && (
        <VpnServerModal
          title="Adicionar Servidor"
          server={serverDraft}
          setServer={setServerDraft}
          isSaving={isSaving}
          onCancel={() => setShowServerCreateModal(false)}
          onSave={addVpnServer}
        />
      )}

      {showUserCreateModal && (
        <VpnUserModal
          title="Adicionar usuário"
          user={userDraft}
          setUser={setUserDraft}
          servers={normalizedForm.servers}
          getServerLabel={getServerLabel}
          isSaving={isSaving}
          onCancel={() => setShowUserCreateModal(false)}
          onSave={addVpnUser}
        />
      )}

      {viewingServer && <VpnServerReadOnlyModal server={viewingServer} onClose={() => setViewingServer(null)} />}
      {viewingUser && <VpnUserReadOnlyModal user={viewingUser} server={getServerById(viewingUser.serverId)} onClose={() => setViewingUser(null)} />}

      {editingServer && (
        <VpnServerModal
          title="Detalhes do servidor VPN"
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
        <VpnUserModal
          title="Detalhes do usuário VPN"
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

function VpnServerReadOnlyModal({ server, onClose }) {
  return <ReadOnlyDetailsModal title="Visualizar servidor VPN" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField label="Nome" value={server.name} /><ReadOnlyField label="VPN" value={server.vpn} /><ReadOnlyField label="Tipo" value={server.type} /><ReadOnlyField label="IPv4 local" value={server.ipv4Local} /><ReadOnlyField label="VLAN" value={server.vlan} /><ReadOnlyField label="IPv4 túnel" value={server.ipv4Tunnel} /><ReadOnlyField label="Porta" value={server.port} /><ReadOnlyField label="Observações" value={server.notes} /></div><ReadOnlyAttachments files={normalizeAttachments(server)} /></ReadOnlyDetailsModal>;
}

function VpnUserReadOnlyModal({ user, server, onClose }) {
  return <ReadOnlyDetailsModal title="Visualizar usuário VPN" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField label="Nome" value={user.personName} /><ReadOnlyField label="Usuário">{user.username || '-'} <CopyButton value={user.username} label="Copiar usuário" /></ReadOnlyField><ReadOnlyField label="Senha">**** <CopyButton value={user.password} label="Copiar senha" /></ReadOnlyField><ReadOnlyField label="Servidor" value={server?.name || 'Servidor VPN não informado'} /><ReadOnlyField label="Observações" value={user.notes} /></div><ReadOnlyAttachments files={normalizeAttachments(user)} /></ReadOnlyDetailsModal>;
}

function VpnServerModal({ title, server, setServer, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome do servidor</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.name} onChange={(e) => setServer({ ...server, name: e.target.value })} placeholder="Ex: VPN Matriz" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">VPN</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={server.vpn} onChange={(e) => setServer({ ...server, vpn: e.target.value })}>
                {vpnOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Modo de servidor</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={server.type} onChange={(e) => setServer({ ...server, type: e.target.value })}>
                {serverModes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <InlineField label="IPV4 Local"><input type="text" aria-label="IPV4 Local" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={server.ipv4Local} onChange={(e) => setServer({ ...server, ipv4Local: sanitizeIpv4MaskInput(e.target.value) })} placeholder="Ex: 192.168.1.1" /></InlineField>
            <InlineField label="VLAN"><input type="text" aria-label="VLAN" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={server.vlan} onChange={(e) => setServer({ ...server, vlan: sanitizeIpv4MaskInput(e.target.value) })} placeholder="Ex: 10.8.0.0/24" /></InlineField>
            <InlineField label="IPV4 Túnel"><input type="text" aria-label="IPV4 Túnel" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={server.ipv4Tunnel} onChange={(e) => setServer({ ...server, ipv4Tunnel: sanitizeIpv4MaskInput(e.target.value) })} placeholder="Ex: 10.8.0.1" /></InlineField>
            <InlineField label="Porta"><input type="text" aria-label="Porta" className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm" value={server.port} onChange={(e) => setServer({ ...server, port: sanitizePortInput(e.target.value) })} placeholder="Ex: 1194" /></InlineField>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Observação</label>
              <textarea rows={3} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.notes} onChange={(e) => setServer({ ...server, notes: e.target.value })} placeholder="Observações do servidor VPN"></textarea>
            </div>
            <VaultAttachmentsField
              title="Arquivos da VPN"
              helpText="Arquivos de texto, configuração, certificados, ZIP e RAR."
              attachments={server.attachments}
              allowedExtensions={VPN_SERVER_FILE_EXTENSIONS}
              onChange={(attachments) => setServer({ ...server, attachments })}
            />
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

function VpnUserModal({ title, user, setUser, servers, getServerLabel, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Servidor VPN</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={user.serverId} onChange={(e) => setUser({ ...user, serverId: e.target.value })}>
                <option value="">Selecione o servidor VPN</option>
                {servers.map((server) => <option key={server.id} value={server.id}>{getServerLabel(server.id)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pessoa vinculada</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={user.personName} onChange={(e) => setUser({ ...user, personName: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Usuário VPN</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={user.username} onChange={(e) => setUser({ ...user, username: e.target.value })} />
            </div>
            <div className="sm:col-span-2 max-w-md">
              <SecurePasswordInput name={`vpn_user_password_${user.id}`} label="Senha VPN" value={user.password} onChange={(e) => setUser({ ...user, password: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
              <textarea rows={2} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={user.notes} onChange={(e) => setUser({ ...user, notes: e.target.value })} placeholder="Pequenas observações do usuário VPN"></textarea>
            </div>
            <VaultAttachmentsField
              title="Arquivos do usuário VPN"
              helpText="Arquivos TXT, ZIP e RAR vinculados somente a este usuário."
              attachments={user.attachments}
              allowedExtensions={VPN_USER_FILE_EXTENSIONS}
              onChange={(attachments) => setUser({ ...user, attachments })}
            />
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
