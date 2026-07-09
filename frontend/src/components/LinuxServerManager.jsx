import { useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Server, ShieldCheck, EthernetPort } from 'lucide-react';

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
const protocolOptions = ['TCP', 'UDP', 'TCP/UDP', 'HTTPS', 'HTTP', 'ICMP', 'SMB', 'FTP', 'SSH', 'SMTP', 'RPD', 'ANY'];
const directionOptions = ['Entrada', 'Saída'];

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

const emptyLinuxServer = () => ({
  id: makeId(),
  name: '',
  systemType: 'Ubuntu',
  notes: '',
  connections: [],
  portRules: []
});

const normalizeConnections = (server = {}) => {
  if (Array.isArray(server.connections)) {
    return server.connections.map((connection) => ({
      id: connection.id || makeId(),
      type: connection.type || 'Eth1',
      ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')
    }));
  }

  if (server.ip) return [{ id: makeId(), type: 'Eth1', ipv4: sanitizeIpv4MaskInput(server.ip) }];
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
  portRules: normalizePortRules(server)
});

const normalizeLinuxForm = (data = {}) => {
  if (Array.isArray(data.servers)) {
    return {
      servers: data.servers.map((server) => normalizeLinuxServer(server))
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

  return { servers: legacyServer };
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

export default function LinuxServerManager({ serverForm, setServerForm, handleSaveData, isSaving }) {
  const normalizedForm = useMemo(() => normalizeLinuxForm(serverForm), [serverForm]);
  const [serverDraft, setServerDraft] = useState(emptyLinuxServer());
  const [editingServer, setEditingServer] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showServerCreateModal, setShowServerCreateModal] = useState(false);

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
      servers: normalizedForm.servers.filter((server) => server.id !== editingServer.id)
    };

    const saved = await persistLinuxForm(nextForm, 'Servidor Linux excluído e cofre atualizado.');
    if (saved) {
      setEditingServer(null);
      setDeleteConfirmation('');
    }
  };

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
            <div key={server.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
              <div className="space-y-1">
                <p className="font-medium text-slate-900 flex items-center gap-2"><Server className="h-5 w-5 shrink-0 text-slate-500" />{server.name || 'Servidor sem nome'}</p>
                <p className="text-sm text-slate-500">Sistema: {server.systemType || '-'} | Conexões: {server.connections?.length || 0} | Portas: {server.portRules?.length || 0}</p>
              </div>
              <button type="button" onClick={() => { setEditingServer(normalizeLinuxServer(server)); setDeleteConfirmation(''); }} className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
                <Edit2 className="w-4 h-4 mr-2" /> Detalhes
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
    </div>
  );
}

function LinuxServerModal({ title, server, setServer, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation }) {
  const connections = normalizeConnections(server);
  const portRules = normalizePortRules(server);

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
                    <div className="rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 flex items-center gap-2"><ConnectionIcon type={connection.type} />{getConnectionLabel(connection, connections)}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IPv4</label>
                    <input type="text" inputMode="decimal" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={connection.ipv4} onChange={(e) => updateConnection(connection.id, e.target.value)} placeholder="Ex: 192.168.1.10 ou 192.168.1.0/24" />
                  </div>
                  <button type="button" onClick={() => removeConnection(connection.id)} className="inline-flex items-center justify-center px-3 py-2 border border-red-200 rounded-md text-sm text-red-600 bg-white hover:bg-red-50">
                    Remover
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
                <div key={rule.id} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.2fr_120px_130px_130px_auto] gap-3 items-end rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={rule.name} onChange={(e) => updatePortRule(rule.id, 'name', e.target.value)} placeholder="Ex: SSH" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Porta</label>
                    <input type="text" inputMode="numeric" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={rule.portNumber} onChange={(e) => updatePortRule(rule.id, 'portNumber', e.target.value)} placeholder="22" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Entrada/Saída</label>
                    <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={rule.direction} onChange={(e) => updatePortRule(rule.id, 'direction', e.target.value)}>
                      {directionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Protocolo</label>
                    <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={rule.protocol} onChange={(e) => updatePortRule(rule.id, 'protocol', e.target.value)}>
                      {protocolOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <button type="button" onClick={() => removePortRule(rule.id)} className="inline-flex items-center justify-center px-3 py-2 border border-red-200 rounded-md text-sm text-red-600 bg-white hover:bg-red-50">
                    Remover
                  </button>
                </div>
              ))}
            </div>
          </div>

          {onDelete && (
            <div className="border-t border-slate-200 pt-4">
              <label className="block text-sm font-medium text-red-700 mb-1">Para excluir este servidor Linux, escreva EXCLUIR</label>
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
