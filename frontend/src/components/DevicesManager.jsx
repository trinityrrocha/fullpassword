import { useMemo, useState } from 'react';
import { Edit2, EthernetPort, Eye, Plus, Router, ShieldCheck, Trash2, UserRound, UserStar, X } from 'lucide-react';
import CopyButton from './CopyButton';
import DeleteConfirmationControl from './DeleteConfirmationControl';
import IpCidrInput from './IpCidrInput';
import Ipv4Input from './Ipv4Input';
import ReadOnlyDetailsModal, { ReadOnlyAttachments } from './ReadOnlyDetailsModal';
import SecurePasswordInput from './SecurePasswordInput';
import VaultAttachmentsField from './VaultAttachmentsField';
import { sanitizeIpv4Input, validateIpv4, validateIpv4Cidr } from '../utils/ipCidr';
import { normalizeVaultAttachments } from '../utils/vaultAttachments';

const DEVICE_FILE_EXTENSIONS = ['.txt', '.conf', '.json', '.xml', '.log', '.zip', '.rar', '.pdf', '.png', '.jpg', '.jpeg'];
const DEVICE_TYPES = ['VOIP', 'NAS', 'DVR', 'IMPRESSORA', 'NAS STORAGE', 'PABX', 'ROTEADOR'];
const CONNECTION_OPTIONS = ['Eth1', 'Eth2', 'Eth3', 'Eth4', 'Eth5', 'VPN'];
const VPN_OPTIONS = ['OpenVPN', 'WireGuard', 'ZeroTier', 'Tailscale', 'Outro'];
const DIRECTION_OPTIONS = ['Entrada', 'Saída', 'Entrada/Saída'];
const PROTOCOL_OPTIONS = ['TCP', 'UDP', 'TCP/UDP'];
const DEVICE_LOGIN_PERMISSIONS = ['Admin', 'User'];
const DEPARTMENT_OPTIONS = [
  'Geral',
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

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const sanitizePortInput = (value = '') => String(value).replace(/\D/g, '').slice(0, 5);
const sanitizeIpv4MaskInput = (value = '') => {
  const cleaned = String(value).replace(/[^0-9./]/g, '');
  const [address, ...maskParts] = cleaned.split('/');
  return maskParts.length ? `${address}/${maskParts.join('').replace(/\D/g, '')}` : address;
};

const isValidPort = (value) => {
  const port = Number(value);
  return String(value).trim() !== '' && Number.isInteger(port) && port >= 1 && port <= 65535;
};

const emptyDevice = () => ({
  id: makeId(),
  name: '',
  deviceType: DEVICE_TYPES[0],
  notes: '',
  connections: [],
  portRules: [],
  attachments: []
});

const emptyDeviceLogin = (deviceId = '') => ({
  id: makeId(),
  deviceId,
  login: '',
  password: '',
  department: 'Geral',
  permission: 'User'
});

const normalizeConnections = (device = {}) => {
  if (!Array.isArray(device.connections)) {
    const legacyIpv4 = device.ipv4Cidr || device.ipv4 || device.ip || device.ipAddress || device.address || '';
    return legacyIpv4
      ? [{
          id: makeId(),
          type: 'Eth1',
          vpn: '',
          name: '',
          ipv4: sanitizeIpv4MaskInput(legacyIpv4),
          gateway: String(device.gateway || device.gatewayIpv4 || '').trim()
        }]
      : [];
  }

  return device.connections.map((connection) => ({
    id: connection.id || makeId(),
    type: connection.type || 'Eth1',
    vpn: connection.type === 'VPN' ? (connection.vpn || connection.vpnType || VPN_OPTIONS[0]) : '',
    name: connection.name || connection.connectionName || '',
    ipv4: sanitizeIpv4MaskInput(connection.ipv4Cidr || connection.ipv4 || connection.ip || connection.ipAddress || connection.address || ''),
    gateway: String(connection.gateway || connection.gatewayIpv4 || '').trim()
  }));
};

const normalizePortRules = (device = {}) => {
  const rules = Array.isArray(device.portRules) ? device.portRules : Array.isArray(device.ports) ? device.ports : [];
  return rules.map((rule) => ({
    id: rule.id || makeId(),
    name: rule.name || '',
    host: rule.host || rule.ip || '',
    portNumber: sanitizePortInput(rule.portNumber || rule.port || ''),
    direction: DIRECTION_OPTIONS.includes(rule.direction) ? rule.direction : DIRECTION_OPTIONS[0],
    protocol: PROTOCOL_OPTIONS.includes(rule.protocol) ? rule.protocol : PROTOCOL_OPTIONS[0]
  }));
};

const normalizeDevice = (device = {}) => ({
  id: device.id || makeId(),
  name: device.name || device.deviceName || '',
  deviceType: DEVICE_TYPES.includes(device.deviceType || device.type)
    ? (device.deviceType || device.type)
    : DEVICE_TYPES[0],
  notes: device.notes || device.observations || '',
  connections: normalizeConnections(device),
  portRules: normalizePortRules(device),
  attachments: normalizeVaultAttachments(device)
});

const normalizeDeviceLogin = (deviceLogin = {}) => ({
  id: deviceLogin.id || makeId(),
  deviceId: deviceLogin.deviceId || '',
  login: deviceLogin.login || deviceLogin.username || '',
  password: deviceLogin.password || '',
  department: DEPARTMENT_OPTIONS.includes(deviceLogin.department) ? deviceLogin.department : 'Geral',
  permission: String(deviceLogin.permission || '').toLowerCase() === 'admin' ? 'Admin' : 'User'
});

const formatDeviceOptionLabel = (device) => {
  const name = device?.name || 'Dispositivo sem nome';
  const type = device?.deviceType || device?.type || 'Sem tipo';
  return `${name} (${type})`;
};

const normalizeDevicesForm = (data = {}) => ({
  devices: Array.isArray(data.devices) ? data.devices.map((device) => normalizeDevice(device)) : [],
  deviceLogins: Array.isArray(data.deviceLogins)
    ? data.deviceLogins.map((deviceLogin) => normalizeDeviceLogin(deviceLogin))
    : []
});

const getConnectionLabel = (connection, allConnections = []) => {
  if (connection.type !== 'VPN') return connection.type;
  const vpnIndex = allConnections
    .filter((item) => item.type === 'VPN')
    .findIndex((item) => item.id === connection.id);
  return `VPN ${vpnIndex + 1}`;
};

const getDeviceConnectionError = (device) => {
  const connections = Array.isArray(device?.connections) ? device.connections : normalizeConnections(device);
  for (const connection of connections) {
    const ipv4 = connection.ipv4Cidr || connection.ipv4 || connection.ip || connection.ipAddress || connection.address || '';
    if (validateIpv4Cidr(ipv4).state === 'invalid') {
      return `Corrija o IPV4/CIDR da conexão ${connection.type === 'VPN' ? 'VPN' : connection.type || 'Eth'} antes de salvar.`;
    }
    if (connection.type !== 'VPN' && validateIpv4(connection.gateway || connection.gatewayIpv4 || '').state === 'invalid') {
      return `Corrija o Gateway(IPV4) da conexão ${connection.type || 'Eth'} antes de salvar.`;
    }
  }
  return '';
};

const findInvalidPort = (device) => (
  normalizePortRules(device).find((rule) => !isValidPort(rule.portNumber))
);

function ConnectionIcon({ type }) {
  const isVpn = String(type || '').toUpperCase() === 'VPN';
  const Icon = isVpn ? ShieldCheck : EthernetPort;
  return <Icon className={isVpn ? 'h-5 w-5 shrink-0 text-indigo-500' : 'h-5 w-5 shrink-0 text-slate-500'} aria-label={isVpn ? 'VPN' : 'Rede'} />;
}

function DeviceLoginIcon({ permission }) {
  const Icon = permission === 'Admin' ? UserStar : UserRound;
  return <Icon className={permission === 'Admin' ? 'h-5 w-5 shrink-0 text-red-400' : 'h-5 w-5 shrink-0 text-slate-500'} aria-label={permission === 'Admin' ? 'Admin' : 'User'} />;
}

function CompactInlineInput({ label, value, onChange, placeholder, widthClass = 'w-[150px]', inputMode = 'text' }) {
  return (
    <div className={`flex h-10 shrink-0 items-center overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm ${widthClass}`}>
      <div className="flex h-full shrink-0 items-center border-r border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600">{label}</div>
      <input type="text" inputMode={inputMode} aria-label={label} className="h-full min-w-0 flex-1 border-0 px-2 text-sm outline-none focus:ring-0" value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

export default function DevicesManager({ devicesForm, setDevicesForm, handleSaveData, isSaving, onDeleteModule }) {
  const normalizedForm = useMemo(() => normalizeDevicesForm(devicesForm), [devicesForm]);
  const [deviceDraft, setDeviceDraft] = useState(emptyDevice());
  const [editingDevice, setEditingDevice] = useState(null);
  const [viewingDevice, setViewingDevice] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loginDraft, setLoginDraft] = useState(emptyDeviceLogin());
  const [editingLogin, setEditingLogin] = useState(null);
  const [viewingLogin, setViewingLogin] = useState(null);
  const [loginDeleteConfirmation, setLoginDeleteConfirmation] = useState('');
  const [showLoginCreateModal, setShowLoginCreateModal] = useState(false);
  const [loginSearch, setLoginSearch] = useState('');

  const persistDevices = async (nextForm, successMessage) => {
    const saved = await handleSaveData('Dispositivos', nextForm, { successMessage });
    if (saved) setDevicesForm(nextForm);
    return saved;
  };

  const validateDevice = (device) => {
    if (!device.name.trim()) {
      alert('Informe o nome do dispositivo.');
      return false;
    }
    if (!DEVICE_TYPES.includes(device.deviceType)) {
      alert('Selecione o tipo do dispositivo.');
      return false;
    }
    const connectionError = getDeviceConnectionError(device);
    if (connectionError) {
      alert(connectionError);
      return false;
    }
    const invalidPort = findInvalidPort(device);
    if (invalidPort) {
      alert(`A porta "${invalidPort.portNumber || 'vazia'}" em "${invalidPort.name || 'Porta'}" é inválida. Informe uma porta entre 1 e 65535.`);
      return false;
    }
    return true;
  };

  const addDevice = async () => {
    if (!validateDevice(deviceDraft)) return;
    const newDevice = normalizeDevice({ ...deviceDraft, id: makeId() });
    const nextForm = { ...normalizedForm, devices: [newDevice, ...normalizedForm.devices] };
    const saved = await persistDevices(nextForm, 'Dispositivo cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setDeviceDraft(emptyDevice());
      setShowCreateModal(false);
    }
  };

  const saveEditedDevice = async () => {
    if (!validateDevice(editingDevice)) return;
    const normalizedDevice = normalizeDevice(editingDevice);
    const nextForm = {
      ...normalizedForm,
      devices: normalizedForm.devices.map((device) => device.id === normalizedDevice.id ? normalizedDevice : device)
    };
    const saved = await persistDevices(nextForm, 'Dispositivo atualizado e salvo no cofre.');
    if (saved) {
      setEditingDevice(null);
      setDeleteConfirmation('');
    }
  };

  const deleteEditedDevice = async () => {
    if (deleteConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }
    const linkedLogins = normalizedForm.deviceLogins.filter((deviceLogin) => deviceLogin.deviceId === editingDevice.id);
    const nextForm = {
      ...normalizedForm,
      devices: normalizedForm.devices.filter((device) => device.id !== editingDevice.id),
      deviceLogins: normalizedForm.deviceLogins.filter((deviceLogin) => deviceLogin.deviceId !== editingDevice.id)
    };
    const successMessage = linkedLogins.length === 1
      ? 'Dispositivo e login vinculado excluídos do cofre.'
      : linkedLogins.length > 1
        ? `Dispositivo e ${linkedLogins.length} logins vinculados excluídos do cofre.`
        : 'Dispositivo excluído e cofre atualizado.';
    const saved = await persistDevices(nextForm, successMessage);
    if (saved) {
      setEditingDevice(null);
      setDeleteConfirmation('');
    }
  };

  const getDeviceLabel = (deviceId) => {
    const device = normalizedForm.devices.find((item) => item.id === deviceId);
    return device ? formatDeviceOptionLabel(device) : 'Dispositivo não encontrado';
  };

  const validateDeviceLogin = (deviceLogin) => {
    if (!normalizedForm.devices.some((device) => device.id === deviceLogin.deviceId)) {
      alert('Selecione um dispositivo válido.');
      return false;
    }
    if (!deviceLogin.login.trim()) {
      alert('Informe o login.');
      return false;
    }
    if (!deviceLogin.password) {
      alert('Informe a senha.');
      return false;
    }
    if (!DEPARTMENT_OPTIONS.includes(deviceLogin.department)) {
      alert('Selecione um departamento válido.');
      return false;
    }
    if (!DEVICE_LOGIN_PERMISSIONS.includes(deviceLogin.permission)) {
      alert('Selecione a permissão Admin ou User.');
      return false;
    }
    return true;
  };

  const openCreateLoginModal = () => {
    setLoginDraft(emptyDeviceLogin(normalizedForm.devices[0]?.id || ''));
    setShowLoginCreateModal(true);
  };

  const addDeviceLogin = async () => {
    if (!validateDeviceLogin(loginDraft)) return;
    const newLogin = normalizeDeviceLogin({ ...loginDraft, id: makeId() });
    const nextForm = {
      ...normalizedForm,
      deviceLogins: [newLogin, ...normalizedForm.deviceLogins]
    };
    const saved = await persistDevices(nextForm, 'Login do dispositivo cadastrado e salvo no cofre.');
    if (saved) {
      setLoginDraft(emptyDeviceLogin(normalizedForm.devices[0]?.id || ''));
      setShowLoginCreateModal(false);
    }
  };

  const saveEditedLogin = async () => {
    if (!validateDeviceLogin(editingLogin)) return;
    const normalizedLogin = normalizeDeviceLogin(editingLogin);
    const nextForm = {
      ...normalizedForm,
      deviceLogins: normalizedForm.deviceLogins.map((deviceLogin) => (
        deviceLogin.id === normalizedLogin.id ? normalizedLogin : deviceLogin
      ))
    };
    const saved = await persistDevices(nextForm, 'Login do dispositivo atualizado e salvo no cofre.');
    if (saved) {
      setEditingLogin(null);
      setLoginDeleteConfirmation('');
    }
  };

  const deleteEditedLogin = async () => {
    if (loginDeleteConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }
    const nextForm = {
      ...normalizedForm,
      deviceLogins: normalizedForm.deviceLogins.filter((deviceLogin) => deviceLogin.id !== editingLogin.id)
    };
    const saved = await persistDevices(nextForm, 'Login do dispositivo excluído e cofre atualizado.');
    if (saved) {
      setEditingLogin(null);
      setLoginDeleteConfirmation('');
    }
  };

  const filteredLogins = normalizedForm.deviceLogins.filter((deviceLogin) => {
    const search = loginSearch.trim().toLowerCase();
    if (!search) return true;
    return [
      deviceLogin.login,
      deviceLogin.permission,
      deviceLogin.department,
      getDeviceLabel(deviceLogin.deviceId)
    ].join(' ').toLowerCase().includes(search);
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-medium text-slate-900">
              {onDeleteModule && <button type="button" title="Excluir dispositivos" aria-label="Excluir dispositivos" onClick={onDeleteModule} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}
              Dispositivos
            </h3>
            <p className="text-sm text-slate-500">Cadastre e gerencie dispositivos de rede e infraestrutura.</p>
          </div>
          <button type="button" disabled={isSaving} onClick={() => { setDeviceDraft(emptyDevice()); setShowCreateModal(true); }} className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="mr-2 h-4 w-4" /> Cadastrar dispositivo
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {normalizedForm.devices.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum dispositivo cadastrado.</p>
          ) : normalizedForm.devices.map((device) => (
            <div key={device.id} className="flex min-h-10 flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium text-slate-900"><Router className="h-5 w-5 shrink-0 text-slate-500" />{device.name || 'Dispositivo sem nome'}</p>
                <p className="truncate text-sm text-slate-500">Tipo: {device.deviceType || '-'} | Conexões: {device.connections.length} | Portas: {device.portRules.length}</p>
              </div>
              <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                <button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingDevice(device)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Eye className="h-4 w-4" /></button>
                <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingDevice({ ...device }); setDeleteConfirmation(''); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Edit2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-medium text-slate-900">Logins dos dispositivos</h3>
            <p className="text-sm text-slate-500">Cadastre acessos vinculados aos dispositivos desta empresa.</p>
          </div>
          <button
            type="button"
            disabled={isSaving || normalizedForm.devices.length === 0}
            title={normalizedForm.devices.length === 0 ? 'Cadastre um dispositivo antes de adicionar logins.' : 'Adicionar login'}
            onClick={openCreateLoginModal}
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="mr-2 h-4 w-4" /> Adicionar login
          </button>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">Pesquisar login</label>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="Buscar por login, departamento, permissão ou dispositivo..."
            value={loginSearch}
            onChange={(event) => setLoginSearch(event.target.value)}
          />
        </div>

        <div className="mt-5 space-y-3">
          {filteredLogins.length === 0 ? (
            <p className="text-sm text-slate-500">
              {loginSearch.trim() ? 'Nenhum login encontrado.' : 'Nenhum login de dispositivo cadastrado.'}
            </p>
          ) : filteredLogins.map((deviceLogin) => (
            <div key={deviceLogin.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                  <DeviceLoginIcon permission={deviceLogin.permission} />
                  <span>{deviceLogin.login || 'Login não informado'}</span>
                  <CopyButton value={deviceLogin.login} label="Copiar login" />
                </span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <span>· Senha: ****</span>
                  <CopyButton value={deviceLogin.password} label="Copiar senha" />
                </span>
                <span className="text-slate-600">· {deviceLogin.permission}</span>
                <span className="text-slate-600">· {deviceLogin.department}</span>
                <span className="text-slate-600">· Dispositivo: {getDeviceLabel(deviceLogin.deviceId)}</span>
              </div>
              <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                <button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingLogin(deviceLogin)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Eye className="h-4 w-4" /></button>
                <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingLogin({ ...deviceLogin }); setLoginDeleteConfirmation(''); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Edit2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreateModal && <DeviceModal title="Cadastrar dispositivo" device={deviceDraft} setDevice={setDeviceDraft} isSaving={isSaving} onCancel={() => setShowCreateModal(false)} onSave={addDevice} />}
      {viewingDevice && <DeviceReadOnlyModal device={viewingDevice} onClose={() => setViewingDevice(null)} />}
      {showLoginCreateModal && (
        <DeviceLoginModal
          title="Adicionar login"
          deviceLogin={loginDraft}
          setDeviceLogin={setLoginDraft}
          devices={normalizedForm.devices}
          isSaving={isSaving}
          onCancel={() => setShowLoginCreateModal(false)}
          onSave={addDeviceLogin}
        />
      )}
      {viewingLogin && (
        <DeviceLoginReadOnlyModal
          deviceLogin={viewingLogin}
          deviceLabel={getDeviceLabel(viewingLogin.deviceId)}
          onClose={() => setViewingLogin(null)}
        />
      )}
      {editingDevice && (
        <DeviceModal
          title="Detalhes do dispositivo"
          device={editingDevice}
          setDevice={setEditingDevice}
          isSaving={isSaving}
          deleteConfirmation={deleteConfirmation}
          setDeleteConfirmation={setDeleteConfirmation}
          linkedLoginCount={normalizedForm.deviceLogins.filter((deviceLogin) => deviceLogin.deviceId === editingDevice.id).length}
          onCancel={() => setEditingDevice(null)}
          onSave={saveEditedDevice}
          onDelete={deleteEditedDevice}
        />
      )}
      {editingLogin && (
        <DeviceLoginModal
          title="Detalhes do login"
          deviceLogin={editingLogin}
          setDeviceLogin={setEditingLogin}
          devices={normalizedForm.devices}
          isSaving={isSaving}
          deleteConfirmation={loginDeleteConfirmation}
          setDeleteConfirmation={setLoginDeleteConfirmation}
          onCancel={() => setEditingLogin(null)}
          onSave={saveEditedLogin}
          onDelete={deleteEditedLogin}
        />
      )}
    </div>
  );
}

function DeviceReadOnlyModal({ device, onClose }) {
  const normalized = normalizeDevice(device);
  return (
    <ReadOnlyDetailsModal title="Visualizar dispositivo" onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nome do dispositivo</p><p className="mt-1 text-sm text-slate-900">{normalized.name || '-'}</p></div>
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tipo do dispositivo</p><p className="mt-1 text-sm text-slate-900">{normalized.deviceType || '-'}</p></div>
        <div className="sm:col-span-2"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Observações</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{normalized.notes || '-'}</p></div>
      </div>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Conexões</h4>
        {normalized.connections.length === 0 ? <p className="text-sm text-slate-500">Nenhuma conexão cadastrada.</p> : (
          <div className="space-y-2">
            {normalized.connections.map((connection) => (
              <div key={connection.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <ConnectionIcon type={connection.type} />
                <span className="font-medium text-slate-700">{getConnectionLabel(connection, normalized.connections)}{connection.name ? ` / ${connection.name}` : ''}{connection.type === 'VPN' ? ` / ${connection.vpn || VPN_OPTIONS[0]}` : ''}</span>
                <span className="text-slate-500">{connection.ipv4 || '-'}{connection.type !== 'VPN' ? ` · Gateway: ${connection.gateway || '-'}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Portas</h4>
        {normalized.portRules.length === 0 ? <p className="text-sm text-slate-500">Nenhuma porta cadastrada.</p> : (
          <div className="space-y-2">
            {normalized.portRules.map((rule) => (
              <div key={rule.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium">{rule.name || 'Porta'}</span> · {[rule.host, rule.portNumber].filter(Boolean).join(':') || '-'} · {rule.direction} · {rule.protocol}
              </div>
            ))}
          </div>
        )}
      </section>

      <ReadOnlyAttachments files={normalized.attachments} />
    </ReadOnlyDetailsModal>
  );
}

function DeviceLoginReadOnlyModal({ deviceLogin, deviceLabel, onClose }) {
  const normalized = normalizeDeviceLogin(deviceLogin);
  return (
    <ReadOnlyDetailsModal title="Visualizar login do dispositivo" onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dispositivo</p>
          <p className="mt-1 text-sm text-slate-900">{deviceLabel}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Login</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-slate-900">{normalized.login || '-'}</span>
            <CopyButton value={normalized.login} label="Copiar login" />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Senha</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-slate-900">****</span>
            <CopyButton value={normalized.password} label="Copiar senha" />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Departamento</p>
          <p className="mt-1 text-sm text-slate-900">{normalized.department}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Permissão</p>
          <p className="mt-1 text-sm text-slate-900">{normalized.permission}</p>
        </div>
      </div>
    </ReadOnlyDetailsModal>
  );
}

function DeviceLoginModal({
  title,
  deviceLogin,
  setDeviceLogin,
  devices,
  isSaving,
  onCancel,
  onSave,
  onDelete,
  deleteConfirmation,
  setDeleteConfirmation
}) {
  const linkedDeviceExists = devices.some((device) => device.id === deviceLogin.deviceId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Dispositivo</label>
            <select
              required
              className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm"
              value={deviceLogin.deviceId}
              onChange={(event) => setDeviceLogin({ ...deviceLogin, deviceId: event.target.value })}
            >
              <option value="">Selecione o dispositivo</option>
              {!linkedDeviceExists && deviceLogin.deviceId && <option value={deviceLogin.deviceId}>Dispositivo não encontrado</option>}
              {devices.map((device) => <option key={device.id} value={device.id}>{formatDeviceOptionLabel(device)}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Login</label>
              <input
                type="text"
                required
                autoComplete="username"
                className="w-full rounded-md border border-slate-300 p-2 shadow-sm"
                value={deviceLogin.login}
                onChange={(event) => setDeviceLogin({ ...deviceLogin, login: event.target.value })}
                placeholder="login"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Permissão</label>
              <select
                required
                className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm"
                value={deviceLogin.permission}
                onChange={(event) => setDeviceLogin({ ...deviceLogin, permission: event.target.value })}
              >
                {DEVICE_LOGIN_PERMISSIONS.map((permission) => <option key={permission} value={permission}>{permission}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Departamento</label>
              <select
                required
                className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm"
                value={deviceLogin.department}
                onChange={(event) => setDeviceLogin({ ...deviceLogin, department: event.target.value })}
              >
                {DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </div>
            <SecurePasswordInput
              name={`device_login_password_${deviceLogin.id}`}
              label="Senha"
              required
              value={deviceLogin.password}
              onChange={(event) => setDeviceLogin({ ...deviceLogin, password: event.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          {onDelete && (
            <DeleteConfirmationControl
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              onDelete={onDelete}
              disabled={isSaving}
            />
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="button" disabled={isSaving} onClick={onSave} className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceModal({ title, device, setDevice, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation, linkedLoginCount = 0 }) {
  const connections = normalizeConnections(device);
  const portRules = normalizePortRules(device);
  const hasInvalidConnections = connections.some((connection) => (
    validateIpv4Cidr(connection.ipv4).state === 'invalid'
    || (connection.type !== 'VPN' && validateIpv4(connection.gateway).state === 'invalid')
  ));
  const hasInvalidPorts = portRules.some((rule) => !isValidPort(rule.portNumber));

  const canAddConnection = (type) => {
    if (!type) return false;
    if (type === 'VPN') return connections.filter((connection) => connection.type === 'VPN').length < 5;
    return !connections.some((connection) => connection.type === type);
  };

  const addConnection = (type) => {
    if (!type) return;
    if (!canAddConnection(type)) {
      alert(type === 'VPN' ? 'A conexão VPN pode ser adicionada no máximo 5 vezes.' : `${type} já foi adicionada neste dispositivo.`);
      return;
    }
    setDevice({
      ...device,
      connections: [...connections, { id: makeId(), type, vpn: type === 'VPN' ? VPN_OPTIONS[0] : '', name: '', ipv4: '', gateway: '' }]
    });
  };

  const updateConnection = (connectionId, field, value) => {
    const nextValue = field === 'ipv4'
      ? sanitizeIpv4MaskInput(value)
      : field === 'gateway'
        ? sanitizeIpv4Input(value)
        : value;
    setDevice({
      ...device,
      connections: connections.map((connection) => connection.id === connectionId ? { ...connection, [field]: nextValue } : connection)
    });
  };

  const addPortRule = () => {
    setDevice({
      ...device,
      portRules: [...portRules, { id: makeId(), name: '', host: '', portNumber: '', direction: DIRECTION_OPTIONS[0], protocol: PROTOCOL_OPTIONS[0] }]
    });
  };

  const updatePortRule = (ruleId, field, value) => {
    setDevice({
      ...device,
      portRules: portRules.map((rule) => rule.id === ruleId ? { ...rule, [field]: field === 'portNumber' ? sanitizePortInput(value) : value } : rule)
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome do dispositivo</label>
              <input type="text" className="w-full rounded-md border border-slate-300 p-2 shadow-sm" value={device.name} onChange={(event) => setDevice({ ...device, name: event.target.value })} placeholder="Ex: DVR Loja" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo do dispositivo</label>
              <select className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm" value={device.deviceType} onChange={(event) => setDevice({ ...device, deviceType: event.target.value })}>
                {DEVICE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Observações</label>
              <textarea rows={3} className="w-full rounded-md border border-slate-300 p-2 shadow-sm" value={device.notes} onChange={(event) => setDevice({ ...device, notes: event.target.value })} placeholder="Observações sobre o dispositivo"></textarea>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h4 className="text-sm font-semibold text-slate-900">Conexões</h4><p className="text-xs text-slate-500">Eth1 até Eth5 apenas uma vez. VPN pode ser adicionada até 5 vezes.</p></div>
              <select value="" onChange={(event) => { addConnection(event.target.value); event.target.value = ''; }} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm sm:w-56">
                <option value="">Adicionar conexão...</option>
                {CONNECTION_OPTIONS.map((option) => <option key={option} value={option} disabled={!canAddConnection(option)}>{option}</option>)}
              </select>
            </div>

            <div className="space-y-3">
              {connections.length === 0 ? <p className="text-sm text-slate-500">Nenhuma conexão adicionada.</p> : connections.map((connection) => {
                const ipv4Validation = validateIpv4Cidr(connection.ipv4);
                const gatewayValidation = validateIpv4(connection.gateway);
                const isVpn = connection.type === 'VPN';
                return (
                  <div key={connection.id} className="w-full overflow-x-auto rounded-md border border-slate-200 bg-slate-50">
                    <div className={`flex items-center gap-2 p-3 ${isVpn ? 'min-w-[800px]' : 'min-w-[844px]'}`}>
                      <div className="flex h-10 w-64 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700">
                        <ConnectionIcon type={connection.type} />
                        <span className="shrink-0">{getConnectionLabel(connection, connections)}</span>
                        <input type="text" aria-label="Nome da conexão" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:ring-0" value={connection.name} onChange={(event) => updateConnection(connection.id, 'name', event.target.value)} placeholder="Nome" />
                      </div>
                      {isVpn ? (
                        <>
                          <select aria-label="Tipo de VPN" className="w-48 shrink-0 rounded-md border border-slate-300 bg-white p-2 shadow-sm" value={connection.vpn || VPN_OPTIONS[0]} onChange={(event) => updateConnection(connection.id, 'vpn', event.target.value)}>
                            {VPN_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <IpCidrInput value={connection.ipv4} onChange={(value) => updateConnection(connection.id, 'ipv4', value)} state={ipv4Validation.state} error={ipv4Validation.error} label="" ariaLabel="IPV4/CIDR da VPN" placeholder="192.168.1.10/24" prefix="IPV4/" required={false} showHelperText={false} containerClassName="w-[250px] shrink-0" inputWrapperClassName="h-[40px] w-[250px]" inputClassName="text-sm tracking-normal" />
                        </>
                      ) : (
                        <>
                          <IpCidrInput value={connection.ipv4} onChange={(value) => updateConnection(connection.id, 'ipv4', value)} state={ipv4Validation.state} error={ipv4Validation.error} label="" ariaLabel="IPV4/CIDR" placeholder="192.168.1.10/24" prefix="IPV4/" required={false} showHelperText={false} containerClassName="w-[250px] shrink-0" inputWrapperClassName="h-[40px] w-[250px]" inputClassName="text-sm tracking-normal" />
                          <Ipv4Input value={connection.gateway} onChange={(value) => updateConnection(connection.id, 'gateway', value)} state={gatewayValidation.state} error={gatewayValidation.error} label="" ariaLabel="Gateway(IPV4)" placeholder="192.168.1.1" prefix="Gateway/" required={false} showHelperText={false} containerClassName="w-[250px] shrink-0" inputWrapperClassName="h-[40px] w-[250px]" inputClassName="text-sm tracking-normal" />
                        </>
                      )}
                      <button type="button" title="Remover" aria-label="Remover" onClick={() => setDevice({ ...device, connections: connections.filter((item) => item.id !== connection.id) })} className={`inline-flex shrink-0 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50 ${isVpn ? 'h-9 w-9' : 'h-10 w-10'}`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h4 className="text-sm font-semibold text-slate-900">Portas</h4><p className="text-xs text-slate-500">Adicione regras de acesso sem limite.</p></div>
              <button type="button" onClick={addPortRule} className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><Plus className="mr-2 h-4 w-4" /> Adicionar porta</button>
            </div>
            <div className="overflow-x-auto">
              <div className="space-y-2">
                {portRules.length === 0 ? <p className="text-sm text-slate-500">Nenhuma porta adicionada.</p> : portRules.map((rule) => (
                  <div key={rule.id} className="grid w-full grid-cols-[180px_minmax(220px,1fr)_120px_128px_96px_36px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <CompactInlineInput label="Nome" widthClass="w-[180px]" value={rule.name} onChange={(event) => updatePortRule(rule.id, 'name', event.target.value)} placeholder="Ex: Administração" />
                    <CompactInlineInput label="IP/HOST" widthClass="w-full" value={rule.host} onChange={(event) => updatePortRule(rule.id, 'host', event.target.value)} placeholder="Ex: 192.168.1.10" />
                    <CompactInlineInput label="Porta" widthClass="w-[120px]" inputMode="numeric" value={rule.portNumber} onChange={(event) => updatePortRule(rule.id, 'portNumber', event.target.value)} placeholder="Ex: 443" />
                    <select aria-label="Entrada/Saída" className="h-10 w-[128px] shrink-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm" value={rule.direction} onChange={(event) => updatePortRule(rule.id, 'direction', event.target.value)}>{DIRECTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    <select aria-label="Protocolo" className="h-10 w-[96px] shrink-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm" value={rule.protocol} onChange={(event) => updatePortRule(rule.id, 'protocol', event.target.value)}>{PROTOCOL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    <button type="button" title="Remover" aria-label="Remover" onClick={() => setDevice({ ...device, portRules: portRules.filter((item) => item.id !== rule.id) })} className="inline-flex h-9 w-9 shrink-0 items-center justify-center justify-self-end rounded-md border border-red-300 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <VaultAttachmentsField title="Arquivos do dispositivo" helpText="Arquivos de texto, configuração, documentos e imagens." attachments={device.attachments} allowedExtensions={DEVICE_FILE_EXTENSIONS} onChange={(attachments) => setDevice({ ...device, attachments })} />
        </div>

        {onDelete && linkedLoginCount > 0 && (
          <p className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">
            {linkedLoginCount === 1
              ? 'O login vinculado a este dispositivo também será excluído.'
              : `Os ${linkedLoginCount} logins vinculados a este dispositivo também serão excluídos.`}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          {onDelete && <DeleteConfirmationControl value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} onDelete={onDelete} disabled={isSaving} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="button" disabled={isSaving || hasInvalidConnections || hasInvalidPorts} onClick={onSave} className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
