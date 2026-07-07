import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Download } from 'lucide-react';
import SecurePasswordInput from './SecurePasswordInput';

const vpnTypes = [
  'Peer to Peer (SSL/TLS)',
  'Peer to Peer (Shared Key)',
  'Remote Access (SSL/TLS)',
  'Remote Access (User Auth)',
  'Remote Access SSL/TLS+(User Auth)'
];

const defaultVpnType = 'Remote Access SSL/TLS+(User Auth)';

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const emptyVpnServer = () => ({
  id: makeId(),
  type: defaultVpnType,
  ipv4Local: '',
  ipv4Tunnel: '',
  vlan: '',
  port: '',
  notes: '',
  attachment: null
});

const emptyVpnUser = (serverId = '') => ({
  id: makeId(),
  serverId,
  personName: '',
  username: '',
  password: '',
  notes: ''
});

const normalizeVpnForm = (data = {}) => {
  if (Array.isArray(data.servers) || Array.isArray(data.users)) {
    return {
      servers: Array.isArray(data.servers)
        ? data.servers.map((server) => ({
            id: server.id || makeId(),
            type: server.type || defaultVpnType,
            ipv4Local: server.ipv4Local || server.localIpv4 || '',
            ipv4Tunnel: server.ipv4Tunnel || server.tunnelIpv4 || '',
            vlan: server.vlan || '',
            port: server.port || '',
            notes: server.notes || server.observations || '',
            attachment: server.attachment || null
          }))
        : [],
      users: Array.isArray(data.users)
        ? data.users.map((user) => ({
            id: user.id || makeId(),
            serverId: user.serverId || '',
            personName: user.personName || user.name || '',
            username: user.username || user.login || '',
            password: user.password || '',
            notes: user.notes || user.observations || ''
          }))
        : []
    };
  }

  const legacyServerId = data.type || data.port || data.vlan ? `legacy-vpn-${makeId()}` : '';
  const legacyServer = legacyServerId
    ? [{
        id: legacyServerId,
        type: data.type || defaultVpnType,
        ipv4Local: data.ipv4Local || '',
        ipv4Tunnel: data.ipv4Tunnel || '',
        vlan: data.vlan || '',
        port: data.port || '',
        notes: data.notes || '',
        attachment: null
      }]
    : [];

  const legacyUser = data.username || data.personName || data.password
    ? [{
        id: `legacy-vpn-user-${makeId()}`,
        serverId: legacyServerId,
        personName: data.personName || '',
        username: data.username || '',
        password: data.password || '',
        notes: ''
      }]
    : [];

  return {
    servers: legacyServer,
    users: legacyUser
  };
};

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
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      data
    });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const downloadAttachment = (attachment) => {
  if (!attachment?.data) return;

  const binary = atob(attachment.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: attachment.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name || 'vpn-anexo';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function VpnManager({ vpnForm, setVpnForm, handleSaveData, isSaving }) {
  const normalizedForm = useMemo(() => normalizeVpnForm(vpnForm), [vpnForm]);
  const [serverDraft, setServerDraft] = useState(emptyVpnServer());
  const [userDraft, setUserDraft] = useState(emptyVpnUser());
  const [editingServer, setEditingServer] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteServerConfirmation, setDeleteServerConfirmation] = useState('');
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [showServerCreateModal, setShowServerCreateModal] = useState(false);
  const [showUserCreateModal, setShowUserCreateModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [serverFile, setServerFile] = useState(null);

  const getServerById = (serverId) => normalizedForm.servers.find((item) => item.id === serverId);

  const getServerLabel = (serverId) => {
    const server = getServerById(serverId);
    if (!server) return 'Servidor VPN não informado';
    const main = server.type || 'Servidor VPN';
    const detail = server.ipv4Tunnel || server.ipv4Local || server.vlan || server.port;
    return detail ? `${main} - ${detail}` : main;
  };

  const persistVpnForm = async (nextForm, successMessage) => {
    const saved = await handleSaveData('VPN', nextForm, { successMessage });
    if (saved) setVpnForm(nextForm);
    return saved;
  };

  const openCreateServerModal = () => {
    setServerDraft(emptyVpnServer());
    setServerFile(null);
    setShowServerCreateModal(true);
  };

  const openCreateUserModal = () => {
    setUserDraft(emptyVpnUser(normalizedForm.servers[0]?.id || ''));
    setShowUserCreateModal(true);
  };

  const addVpnServer = async () => {
    if (!serverDraft.type) {
      alert('Selecione o tipo de VPN.');
      return;
    }

    const attachment = serverFile ? await readFileAsAttachment(serverFile) : null;
    const newServer = { ...serverDraft, id: makeId(), attachment };
    const nextForm = {
      ...normalizedForm,
      servers: [newServer, ...normalizedForm.servers]
    };

    const saved = await persistVpnForm(nextForm, 'Servidor VPN cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setServerDraft(emptyVpnServer());
      setServerFile(null);
      setUserDraft((current) => ({ ...current, serverId: current.serverId || newServer.id }));
      setShowServerCreateModal(false);
    }
  };

  const saveEditedServer = async () => {
    if (!editingServer.type) {
      alert('Selecione o tipo de VPN.');
      return;
    }

    const attachment = serverFile ? await readFileAsAttachment(serverFile) : editingServer.attachment;
    const updatedServer = { ...editingServer, attachment };
    const nextForm = {
      ...normalizedForm,
      servers: normalizedForm.servers.map((server) => server.id === updatedServer.id ? updatedServer : server)
    };

    const saved = await persistVpnForm(nextForm, 'Servidor VPN atualizado e salvo no cofre.');
    if (saved) {
      setEditingServer(null);
      setServerFile(null);
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
      setServerFile(null);
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
            <h3 className="text-lg font-medium text-slate-900">Servidores VPN</h3>
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
                <p className="font-medium text-slate-900">{server.type || 'Servidor VPN'}</p>
                <p className="text-sm text-slate-500">IPv4 local: {server.ipv4Local || '-'} | IPv4 túnel: {server.ipv4Tunnel || '-'}</p>
                <p className="text-xs text-slate-500">VLAN: {server.vlan || '-'} | Porta: {server.port || '-'}{server.attachment?.name ? ` | Anexo: ${server.attachment.name}` : ''}</p>
              </div>
              <button type="button" onClick={() => { setEditingServer({ ...server }); setServerFile(null); setDeleteServerConfirmation(''); }} className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
                <Edit2 className="w-4 h-4 mr-2" /> Detalhes
              </button>
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
            <div key={user.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
              <div className="space-y-1">
                <p className="font-medium text-slate-900">{user.personName || 'Pessoa não informada'}</p>
                <p className="text-sm text-slate-500">Usuário VPN: {user.username || '-'}</p>
                <p className="text-xs text-slate-500">Servidor: {getServerLabel(user.serverId)}</p>
              </div>
              <button type="button" onClick={() => { setEditingUser({ ...user }); setDeleteUserConfirmation(''); }} className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
                <Edit2 className="w-4 h-4 mr-2" /> Detalhes
              </button>
            </div>
          ))}
        </div>
      </div>

      {showServerCreateModal && (
        <VpnServerModal
          title="Adicionar Servidor"
          server={serverDraft}
          setServer={setServerDraft}
          serverFile={serverFile}
          setServerFile={setServerFile}
          isSaving={isSaving}
          onCancel={() => { setShowServerCreateModal(false); setServerFile(null); }}
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

      {editingServer && (
        <VpnServerModal
          title="Detalhes do servidor VPN"
          server={editingServer}
          setServer={setEditingServer}
          serverFile={serverFile}
          setServerFile={setServerFile}
          isSaving={isSaving}
          deleteConfirmation={deleteServerConfirmation}
          setDeleteConfirmation={setDeleteServerConfirmation}
          onCancel={() => { setEditingServer(null); setServerFile(null); }}
          onSave={saveEditedServer}
          onDelete={deleteEditedServer}
          onDownload={() => downloadAttachment(editingServer.attachment)}
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

function VpnServerModal({ title, server, setServer, serverFile, setServerFile, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation, onDownload }) {
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de VPN</label>
              <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={server.type} onChange={(e) => setServer({ ...server, type: e.target.value })}>
                {vpnTypes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">IPV4 local</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.ipv4Local} onChange={(e) => setServer({ ...server, ipv4Local: e.target.value })} placeholder="Ex: 192.168.1.1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">IPV4 Tunel</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.ipv4Tunnel} onChange={(e) => setServer({ ...server, ipv4Tunnel: e.target.value })} placeholder="Ex: 10.8.0.1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">VLAN</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.vlan} onChange={(e) => setServer({ ...server, vlan: e.target.value })} placeholder="Ex: 10.8.0.0/24" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Porta</label>
              <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.port} onChange={(e) => setServer({ ...server, port: e.target.value })} placeholder="Ex: 1194" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Observação</label>
              <textarea rows={3} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={server.notes} onChange={(e) => setServer({ ...server, notes: e.target.value })} placeholder="Observações do servidor VPN"></textarea>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Anexo VPN</label>
              <input type="file" className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" accept=".txt,.ovpn,.conf,.crt,.cer,.key,.pem" onChange={(e) => setServerFile(e.target.files?.[0] || null)} />
              <p className="mt-1 text-xs text-slate-500">Aceita arquivos de texto e certificados da VPN.</p>
              {serverFile && <p className="mt-1 text-xs text-indigo-600">Novo anexo selecionado: {serverFile.name}</p>}
              {server.attachment?.name && !serverFile && (
                <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-slate-600">
                  <span>Anexo atual: {server.attachment.name}</span>
                  {onDownload && (
                    <button type="button" onClick={onDownload} className="inline-flex items-center px-3 py-1.5 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
                      <Download className="w-4 h-4 mr-2" /> Download
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {onDelete && (
            <div className="border-t border-slate-200 pt-4">
              <label className="block text-sm font-medium text-red-700 mb-1">Para excluir este servidor VPN, escreva EXCLUIR</label>
              <input type="text" className="w-full border-red-200 rounded-md shadow-sm p-2 border" value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} placeholder="EXCLUIR" />
            </div>
          )}
        </div>
        <div className={`flex flex-col sm:flex-row ${onDelete ? 'justify-between' : 'justify-end'} gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50`}>
          {onDelete && (
            <button type="button" disabled={isSaving} onClick={onDelete} className="inline-flex items-center justify-center px-4 py-2 border border-red-200 rounded-md text-sm font-medium text-red-600 bg-white hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-4 h-4 mr-2" /> Excluir</button>
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
          </div>

          {onDelete && (
            <div className="border-t border-slate-200 pt-4">
              <label className="block text-sm font-medium text-red-700 mb-1">Para excluir este usuário VPN, escreva EXCLUIR</label>
              <input type="text" className="w-full border-red-200 rounded-md shadow-sm p-2 border" value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} placeholder="EXCLUIR" />
            </div>
          )}
        </div>
        <div className={`flex flex-col sm:flex-row ${onDelete ? 'justify-between' : 'justify-end'} gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50`}>
          {onDelete && (
            <button type="button" disabled={isSaving} onClick={onDelete} className="inline-flex items-center justify-center px-4 py-2 border border-red-200 rounded-md text-sm font-medium text-red-600 bg-white hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-4 h-4 mr-2" /> Excluir</button>
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
