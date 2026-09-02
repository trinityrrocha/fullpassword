import { useMemo, useState } from 'react';
import { Cctv, Edit2, EthernetPort, Eye, Phone, Plus, Printer, Router, ServerPlus, ShieldCheck, Trash2, UserRound, UserStar, WifiCog, X } from 'lucide-react';
import CopyButton from './CopyButton';
import DeleteConfirmationControl from './DeleteConfirmationControl';
import IpCidrInput from './IpCidrInput';
import Ipv4Input from './Ipv4Input';
import ReadOnlyDetailsModal, { ReadOnlyAttachments } from './ReadOnlyDetailsModal';
import SecurePasswordInput from './SecurePasswordInput';
import VaultAttachmentsField from './VaultAttachmentsField';
import { sanitizeIpv4Input, validateIpv4, validateIpv4Cidr } from '../utils/ipCidr';
import { normalizeVaultAttachments } from '../utils/vaultAttachments';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';

const DEVICE_FILE_EXTENSIONS = ['.txt', '.conf', '.json', '.xml', '.log', '.zip', '.rar', '.pdf', '.png', '.jpg', '.jpeg'];
const DEVICE_TYPE_WIFI_CONTROLLER = 'WIFI/CONTROLLER';
const DEVICE_TYPE_ROUTER_GATEWAY = 'ROTEADOR/GATEWAY';
const DEVICE_TYPE_NAS_STORAGE = 'NAS STORAGE';
const PABX_DEVICE_TYPE = 'PABX-IP/VOIP';
const DEVICE_TYPE_ALIASES = {
  NAS: DEVICE_TYPE_WIFI_CONTROLLER,
  ROTEADOR: DEVICE_TYPE_ROUTER_GATEWAY,
  PABX: PABX_DEVICE_TYPE,
  VOIP: PABX_DEVICE_TYPE
};
const DEVICE_TYPES = [DEVICE_TYPE_WIFI_CONTROLLER, 'DVR', 'IMPRESSORA', DEVICE_TYPE_NAS_STORAGE, PABX_DEVICE_TYPE, DEVICE_TYPE_ROUTER_GATEWAY];
const DEVICE_TYPE_ICONS = {
  [DEVICE_TYPE_WIFI_CONTROLLER]: WifiCog,
  DVR: Cctv,
  IMPRESSORA: Printer,
  [DEVICE_TYPE_NAS_STORAGE]: ServerPlus,
  [PABX_DEVICE_TYPE]: Phone,
  [DEVICE_TYPE_ROUTER_GATEWAY]: Router
};
const CONNECTION_OPTIONS = ['Eth1', 'Eth2', 'Eth3', 'Eth4', 'Eth5', 'VPN'];
const VPN_OPTIONS = ['OpenVPN', 'WireGuard', 'ZeroTier', 'Tailscale', 'Outro'];
const DIRECTION_OPTIONS = ['Entrada', 'Saída', 'Entrada/Saída'];
const PROTOCOL_OPTIONS = ['TCP', 'UDP', 'TCP/UDP'];
const DEVICE_LOGIN_PERMISSIONS = ['Admin', 'User'];
const RADIO_24_BANDWIDTH_OPTIONS = ['20', '40'];
const RADIO_5_BANDWIDTH_OPTIONS = ['20', '40', '80', '160'];
const RADIO_6_BANDWIDTH_OPTIONS = ['20', '40', '80', '160', '320'];
const WIFI_NETWORK_TYPES = ['Padrão', 'Hotspot', 'IoT'];
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
const sanitizeContractedExtensions = (value = '') => String(value).replace(/\D/g, '').slice(0, 3);
const sanitizeVlanInput = (value = '') => String(value).replace(/\D/g, '').slice(0, 4);
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
  pppoeAccounts: [],
  pabxPortal: { url: '', login: '', password: '' },
  contractedExtensions: '',
  extensions: [],
  nasAccess: { url: '', login: '', password: '' },
  nasUsers: [],
  wifiControllerAccess: { url: '', login: '', password: '' },
  wifiNetworks: [],
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

const normalizePppoeAccounts = (device = {}) => {
  const accounts = Array.isArray(device.pppoeAccounts) ? device.pppoeAccounts : [];
  return accounts.map((account) => ({
    id: account?.id || makeId(),
    operatorName: String(account?.operatorName || ''),
    login: String(account?.login || ''),
    password: String(account?.password || ''),
    supportPhone: String(account?.supportPhone || '')
  }));
};

const normalizePabxPortal = (device = {}) => ({
  url: String(device.pabxPortal?.url ?? ''),
  login: String(device.pabxPortal?.login ?? ''),
  password: String(device.pabxPortal?.password ?? '')
});

const normalizeExtensions = (device = {}) => {
  const extensions = Array.isArray(device.extensions) ? device.extensions : [];
  return extensions.map((extension) => ({
    id: extension?.id || makeId(),
    extension: String(extension?.extension ?? ''),
    login: String(extension?.login ?? ''),
    password: String(extension?.password ?? ''),
    department: DEPARTMENT_OPTIONS.includes(extension?.department) ? extension.department : 'Geral',
    collaborator: String(extension?.collaborator ?? '')
  }));
};

const normalizeAccessCredentials = (access = {}) => ({
  url: String(access?.url ?? ''),
  login: String(access?.login ?? ''),
  password: String(access?.password ?? '')
});

const normalizeNasUsers = (device = {}) => {
  const users = Array.isArray(device.nasUsers) ? device.nasUsers : [];
  return users.map((user) => ({
    id: user?.id || makeId(),
    login: String(user?.login ?? ''),
    password: String(user?.password ?? ''),
    department: DEPARTMENT_OPTIONS.includes(user?.department) ? user.department : 'Geral',
    collaborator: String(user?.collaborator ?? '')
  }));
};

const normalizeWifiNetworks = (device = {}) => {
  const networks = Array.isArray(device.wifiNetworks) ? device.wifiNetworks : [];
  return networks.map((network) => ({
    id: network?.id || makeId(),
    ssid: String(network?.ssid ?? ''),
    password: String(network?.password ?? ''),
    radio24Bandwidth: RADIO_24_BANDWIDTH_OPTIONS.includes(String(network?.radio24Bandwidth)) ? String(network.radio24Bandwidth) : '20',
    radio5Bandwidth: RADIO_5_BANDWIDTH_OPTIONS.includes(String(network?.radio5Bandwidth)) ? String(network.radio5Bandwidth) : '40',
    radio6Bandwidth: RADIO_6_BANDWIDTH_OPTIONS.includes(String(network?.radio6Bandwidth)) ? String(network.radio6Bandwidth) : '160',
    vlan: sanitizeVlanInput(network?.vlan),
    networkType: WIFI_NETWORK_TYPES.includes(network?.networkType) ? network.networkType : 'Padrão'
  }));
};

const normalizeDeviceType = (deviceType) => {
  const aliasedType = DEVICE_TYPE_ALIASES[deviceType] || deviceType;
  return DEVICE_TYPES.includes(aliasedType) ? aliasedType : DEVICE_TYPES[0];
};

const getDuplicateExtensions = (extensions = []) => {
  const counts = new Map();
  extensions.forEach((item) => {
    const normalizedExtension = String(item?.extension ?? '').trim().toLowerCase();
    if (!normalizedExtension) return;
    counts.set(normalizedExtension, (counts.get(normalizedExtension) || 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([extension]) => extension));
};

const normalizeDevice = (device = {}) => {
  const deviceType = normalizeDeviceType(device.deviceType || device.type);
  const isPabx = deviceType === PABX_DEVICE_TYPE;
  const isNasStorage = deviceType === DEVICE_TYPE_NAS_STORAGE;
  const isWifiController = deviceType === DEVICE_TYPE_WIFI_CONTROLLER;

  return {
    id: device.id || makeId(),
    name: device.name || device.deviceName || '',
    deviceType,
    notes: device.notes || device.observations || '',
    connections: normalizeConnections(device),
    pppoeAccounts: deviceType === DEVICE_TYPE_ROUTER_GATEWAY ? normalizePppoeAccounts(device) : [],
    pabxPortal: isPabx ? normalizePabxPortal(device) : { url: '', login: '', password: '' },
    contractedExtensions: isPabx
      ? sanitizeContractedExtensions(device.contractedExtensions ?? device.extensionContractedQuantity ?? '')
      : '',
    extensions: isPabx ? normalizeExtensions(device) : [],
    nasAccess: isNasStorage ? normalizeAccessCredentials(device.nasAccess) : { url: '', login: '', password: '' },
    nasUsers: isNasStorage ? normalizeNasUsers(device) : [],
    wifiControllerAccess: isWifiController ? normalizeAccessCredentials(device.wifiControllerAccess) : { url: '', login: '', password: '' },
    wifiNetworks: isWifiController ? normalizeWifiNetworks(device) : [],
    portRules: normalizePortRules(device),
    attachments: normalizeVaultAttachments(device)
  };
};

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
  const type = normalizeDeviceType(device?.deviceType || device?.type);
  return `${name} (${type})`;
};

const formatPppoeSummary = (device) => {
  if (device?.deviceType !== DEVICE_TYPE_ROUTER_GATEWAY) return '';
  const accounts = normalizePppoeAccounts(device);
  if (accounts.length === 0) return '';
  const operators = [...new Set(accounts.map((account) => account.operatorName.trim()).filter(Boolean))];
  return `PPPoE: ${accounts.length}${operators.length ? ` - ${operators.join(', ')}` : ''}`;
};

const formatWifiNetworksSummary = (device) => device?.deviceType === DEVICE_TYPE_WIFI_CONTROLLER
  ? `Redes Wi-Fi: ${normalizeWifiNetworks(device).length}`
  : '';

const formatNasUsersSummary = (device) => device?.deviceType === DEVICE_TYPE_NAS_STORAGE
  ? `Usuários NAS: ${normalizeNasUsers(device).length}`
  : '';

const formatPabxExtensionsSummary = (device) => {
  if (device?.deviceType !== PABX_DEVICE_TYPE) return '';
  const usedExtensions = normalizeExtensions(device).length;
  const contractedExtensions = sanitizeContractedExtensions(device.contractedExtensions);
  return `Ramais: ${usedExtensions}${contractedExtensions ? `/${contractedExtensions}` : ''}`;
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

function DeviceTypeIcon({ type }) {
  const normalizedType = normalizeDeviceType(type);
  const Icon = DEVICE_TYPE_ICONS[normalizedType] || Router;
  return <Icon className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-label={normalizedType} />;
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
  const [loginDeviceFilter, setLoginDeviceFilter] = useState('');

  useClearOnVaultLock(() => {
    setDeviceDraft(emptyDevice());
    setEditingDevice(null);
    setViewingDevice(null);
    setDeleteConfirmation('');
    setShowCreateModal(false);
    setLoginDraft(emptyDeviceLogin());
    setEditingLogin(null);
    setViewingLogin(null);
    setLoginDeleteConfirmation('');
    setShowLoginCreateModal(false);
    setLoginSearch('');
    setLoginDeviceFilter('');
  });

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
    const invalidPppoe = device.deviceType === DEVICE_TYPE_ROUTER_GATEWAY
      ? normalizePppoeAccounts(device).find((account) => !account.operatorName.trim() && !account.login.trim())
      : null;
    if (invalidPppoe) {
      alert('Informe pelo menos a operadora ou o login em cada conta PPPoE adicionada.');
      return false;
    }
    return true;
  };

  const closeCreateDeviceModal = () => {
    setDeviceDraft(emptyDevice());
    setShowCreateModal(false);
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

  const closeCreateLoginModal = () => {
    setLoginDraft(emptyDeviceLogin(normalizedForm.devices[0]?.id || ''));
    setShowLoginCreateModal(false);
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
    if (loginDeviceFilter && deviceLogin.deviceId !== loginDeviceFilter) return false;

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
    <div className="space-y-4 animate-fadeIn">
      <div className="flex min-h-10 w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1 shadow-sm sm:h-10 sm:flex-nowrap sm:py-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <button type="button" disabled={isSaving} onClick={() => { setDeviceDraft(emptyDevice()); setShowCreateModal(true); }} className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="mr-2 h-4 w-4" /> Adicionar dispositivo
          </button>
          <button
            type="button"
            disabled={isSaving || normalizedForm.devices.length === 0}
            title={normalizedForm.devices.length === 0 ? 'Cadastre um dispositivo antes de adicionar logins.' : 'Adicionar login'}
            onClick={openCreateLoginModal}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="mr-2 h-4 w-4" /> Adicionar login
          </button>
        </div>
        {onDeleteModule && <button type="button" title="Excluir dispositivos" aria-label="Excluir dispositivos" onClick={onDeleteModule} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 pb-4 pt-3">
        <h3 className="mb-2 text-lg font-medium text-slate-900">Dispositivos cadastrados</h3>
        <div className="space-y-2">
          {normalizedForm.devices.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum dispositivo cadastrado.</p>
          ) : normalizedForm.devices.map((device) => (
            <div key={device.id} className="flex flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 lg:flex-nowrap">
                <strong className="flex min-w-0 items-center gap-2 truncate font-medium text-slate-900"><DeviceTypeIcon type={device.deviceType} />{device.name || 'Dispositivo sem nome'} ({device.deviceType || '-'})</strong>
                <span className="whitespace-nowrap">Conexões: {device.connections.length}</span>
                <span className="whitespace-nowrap">Portas: {device.portRules.length}</span>
                {formatPppoeSummary(device) && <span className="whitespace-nowrap">{formatPppoeSummary(device)}</span>}
                {formatWifiNetworksSummary(device) && <span className="whitespace-nowrap">{formatWifiNetworksSummary(device)}</span>}
                {formatNasUsersSummary(device) && <span className="whitespace-nowrap">{formatNasUsersSummary(device)}</span>}
                {formatPabxExtensionsSummary(device) && <span className="whitespace-nowrap">{formatPabxExtensionsSummary(device)}</span>}
                <span className="whitespace-nowrap">Logins: {normalizedForm.deviceLogins.filter((deviceLogin) => deviceLogin.deviceId === device.id).length}</span>
              </div>
              <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                <button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingDevice(device)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Eye className="h-4 w-4" /></button>
                <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingDevice({ ...device }); setDeleteConfirmation(''); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Edit2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Pesquisar login</label>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="Buscar por login, departamento, permissão ou dispositivo..."
            value={loginSearch}
            onChange={(event) => setLoginSearch(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Filtrar por dispositivo</label>
          <select className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" value={loginDeviceFilter} onChange={(event) => setLoginDeviceFilter(event.target.value)}>
            <option value="">Todos os dispositivos</option>
            {normalizedForm.devices.map((device) => <option key={device.id} value={device.id}>{getDeviceLabel(device.id)}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 pb-5 pt-3">
        <h3 className="mb-2 text-lg font-medium text-slate-900">Logins cadastrados</h3>
        <div className="space-y-2">
          {filteredLogins.length === 0 ? (
            <p className="text-sm text-slate-500">
              {loginSearch.trim() || loginDeviceFilter ? 'Nenhum login encontrado.' : 'Nenhum login de dispositivo cadastrado.'}
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

      {showCreateModal && <DeviceModal title="Cadastrar dispositivo" device={deviceDraft} setDevice={setDeviceDraft} isSaving={isSaving} onCancel={closeCreateDeviceModal} onSave={addDevice} />}
      {viewingDevice && <DeviceReadOnlyModal device={viewingDevice} onClose={() => setViewingDevice(null)} />}
      {showLoginCreateModal && (
        <DeviceLoginModal
          title="Adicionar login"
          deviceLogin={loginDraft}
          setDeviceLogin={setLoginDraft}
          devices={normalizedForm.devices}
          isSaving={isSaving}
          onCancel={closeCreateLoginModal}
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

function DeviceAccessReadOnly({ title, access }) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
      <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-3">
        <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">URL</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span className="min-w-0 truncate" title={access.url}>{access.url || '-'}</span>{access.url && <CopyButton value={access.url} label="Copiar URL" />}</div></div>
        <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Login</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span className="min-w-0 truncate">{access.login || '-'}</span>{access.login && <CopyButton value={access.login} label="Copiar login" />}</div></div>
        <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Senha</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span>****</span>{access.password && <CopyButton value={access.password} label="Copiar senha" />}</div></div>
      </div>
    </section>
  );
}

function DeviceAccessFields({ access, onChange, passwordName }) {
  return (
    <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">URL</label>
        <input type="text" inputMode="url" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={access.url} onChange={(event) => onChange('url', event.target.value)} placeholder="https://exemplo.com.br" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Login</label>
        <input type="text" autoComplete="off" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={access.login} onChange={(event) => onChange('login', event.target.value)} placeholder="Login" />
      </div>
      <SecurePasswordInput name={passwordName} label="Senha" value={access.password} onChange={(event) => onChange('password', event.target.value)} enableGenerator={false} autoComplete="new-password" />
    </div>
  );
}

function DeviceReadOnlyModal({ device, onClose }) {
  const normalized = normalizeDevice(device);
  return (
    <ReadOnlyDetailsModal title="Visualizar dispositivo" onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nome do dispositivo</p><p className="mt-1 text-sm text-slate-900">{normalized.name || '-'}</p></div>
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tipo do dispositivo</p><div className="mt-1 flex items-center gap-2 text-sm text-slate-900"><DeviceTypeIcon type={normalized.deviceType} /><span>{normalized.deviceType || '-'}</span></div></div>
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

      {normalized.deviceType === DEVICE_TYPE_WIFI_CONTROLLER && (
        <>
          <DeviceAccessReadOnly title="Acesso WIFI/CONTROLLER" access={normalized.wifiControllerAccess} />
          <section>
            <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Redes Wi-Fi</h4>
            {normalized.wifiNetworks.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma rede Wi-Fi cadastrada.</p> : (
              <div className="space-y-2">
                {normalized.wifiNetworks.map((network) => (
                  <div key={network.id} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-4">
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Rede</span><p className="mt-1 text-slate-900 dark:text-slate-100">{network.ssid || '-'}</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Senha</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span>****</span>{network.password && <CopyButton value={network.password} label={`Copiar senha da rede ${network.ssid || ''}`.trim()} />}</div></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">2.4 GHz</span><p className="mt-1 text-slate-900 dark:text-slate-100">{network.radio24Bandwidth} MHz</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">5 GHz</span><p className="mt-1 text-slate-900 dark:text-slate-100">{network.radio5Bandwidth} MHz</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">6 GHz</span><p className="mt-1 text-slate-900 dark:text-slate-100">{network.radio6Bandwidth} MHz</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">VLAN</span><p className="mt-1 text-slate-900 dark:text-slate-100">{network.vlan || '-'}</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Tipo</span><p className="mt-1 text-slate-900 dark:text-slate-100">{network.networkType}</p></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {normalized.deviceType === DEVICE_TYPE_NAS_STORAGE && (
        <>
          <DeviceAccessReadOnly title="Acesso NAS STORAGE" access={normalized.nasAccess} />
          <section>
            <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Usuários NAS</h4>
            {normalized.nasUsers.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum usuário NAS cadastrado.</p> : (
              <div className="space-y-2">
                {normalized.nasUsers.map((user) => (
                  <div key={user.id} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-4">
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Login</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span className="min-w-0 truncate">{user.login || '-'}</span>{user.login && <CopyButton value={user.login} label="Copiar login do usuário NAS" />}</div></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Senha</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span>****</span>{user.password && <CopyButton value={user.password} label="Copiar senha do usuário NAS" />}</div></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Departamento</span><p className="mt-1 text-slate-900 dark:text-slate-100">{user.department}</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Colaborador</span><p className="mt-1 text-slate-900 dark:text-slate-100">{user.collaborator || '-'}</p></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {normalized.deviceType === DEVICE_TYPE_ROUTER_GATEWAY && normalized.pppoeAccounts.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">PPPoE</h4>
          <div className="space-y-2">
            {normalized.pppoeAccounts.map((account) => (
              <div key={account.id} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2">
                <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Operadora</span><p className="mt-1 text-slate-900 dark:text-slate-100">{account.operatorName || '-'}</p></div>
                <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Login PPPoE</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span>{account.login || '-'}</span>{account.login && <CopyButton value={account.login} label="Copiar login PPPoE" />}</div></div>
                <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Senha PPPoE</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span>****</span>{account.password && <CopyButton value={account.password} label="Copiar senha PPPoE" />}</div></div>
                <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Telefone suporte</span><p className="mt-1 text-slate-900 dark:text-slate-100">{account.supportPhone || '-'}</p></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {normalized.deviceType === PABX_DEVICE_TYPE && (
        <>
          <DeviceAccessReadOnly title="Acesso PABX-IP/VOIP" access={normalized.pabxPortal} />

          <section>
            <h4 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Ramais</h4>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Ramais contratados: {normalized.contractedExtensions || 'não informado'} · Ramais em uso: {normalized.extensions.length}</p>
            {normalized.extensions.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum ramal cadastrado.</p> : (
              <div className="space-y-2">
                {normalized.extensions.map((extension) => (
                  <div key={extension.id} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-3">
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Ramal</span><p className="mt-1 text-slate-900 dark:text-slate-100">{extension.extension || '-'}</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Login</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span className="min-w-0 truncate">{extension.login || '-'}</span>{extension.login && <CopyButton value={extension.login} label={`Copiar login do ramal ${extension.extension || ''}`.trim()} />}</div></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Senha</span><div className="mt-1 flex items-center gap-2 text-slate-900 dark:text-slate-100"><span>****</span>{extension.password && <CopyButton value={extension.password} label={`Copiar senha do ramal ${extension.extension || ''}`.trim()} />}</div></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Departamento</span><p className="mt-1 text-slate-900 dark:text-slate-100">{extension.department}</p></div>
                    <div><span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Colaborador</span><p className="mt-1 text-slate-900 dark:text-slate-100">{extension.collaborator || '-'}</p></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

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
  const pppoeAccounts = normalizePppoeAccounts(device);
  const pabxPortal = normalizePabxPortal(device);
  const extensions = normalizeExtensions(device);
  const duplicateExtensions = getDuplicateExtensions(extensions);
  const contractedExtensions = sanitizeContractedExtensions(device.contractedExtensions);
  const hasExtensionOverage = Boolean(contractedExtensions) && extensions.length > Number(contractedExtensions);
  const nasAccess = normalizeAccessCredentials(device.nasAccess);
  const nasUsers = normalizeNasUsers(device);
  const wifiControllerAccess = normalizeAccessCredentials(device.wifiControllerAccess);
  const wifiNetworks = normalizeWifiNetworks(device);
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

  const handleDeviceTypeChange = (nextDeviceType) => {
    if (device.deviceType === DEVICE_TYPE_ROUTER_GATEWAY && nextDeviceType !== DEVICE_TYPE_ROUTER_GATEWAY && pppoeAccounts.length > 0) {
      const confirmed = window.confirm('Este dispositivo possui PPPoE cadastrados. Ao alterar o tipo para outro dispositivo, os dados PPPoE serão removidos. Deseja continuar?');
      if (!confirmed) return;
    }

    const hasPabxData = Object.values(pabxPortal).some((value) => value.trim())
      || extensions.length > 0
      || Boolean(sanitizeContractedExtensions(device.contractedExtensions));
    if (device.deviceType === PABX_DEVICE_TYPE && nextDeviceType !== PABX_DEVICE_TYPE && hasPabxData) {
      const confirmed = window.confirm('Este dispositivo possui dados de PABX-IP/VOIP cadastrados. Ao alterar o tipo, portal e ramais serão removidos. Deseja continuar?');
      if (!confirmed) return;
    }

    const hasNasData = Object.values(nasAccess).some((value) => value.trim()) || nasUsers.length > 0;
    if (device.deviceType === DEVICE_TYPE_NAS_STORAGE && nextDeviceType !== DEVICE_TYPE_NAS_STORAGE && hasNasData) {
      const confirmed = window.confirm('Este dispositivo possui dados de NAS STORAGE cadastrados. Ao alterar o tipo, acesso e usuários serão removidos. Deseja continuar?');
      if (!confirmed) return;
    }

    const hasWifiData = Object.values(wifiControllerAccess).some((value) => value.trim()) || wifiNetworks.length > 0;
    if (device.deviceType === DEVICE_TYPE_WIFI_CONTROLLER && nextDeviceType !== DEVICE_TYPE_WIFI_CONTROLLER && hasWifiData) {
      const confirmed = window.confirm('Este dispositivo possui dados de WIFI/CONTROLLER cadastrados. Ao alterar o tipo, acesso e redes Wi-Fi serão removidos. Deseja continuar?');
      if (!confirmed) return;
    }

    setDevice({
      ...device,
      deviceType: nextDeviceType,
      pppoeAccounts: nextDeviceType === DEVICE_TYPE_ROUTER_GATEWAY ? pppoeAccounts : [],
      pabxPortal: nextDeviceType === PABX_DEVICE_TYPE ? pabxPortal : { url: '', login: '', password: '' },
      contractedExtensions: nextDeviceType === PABX_DEVICE_TYPE
        ? sanitizeContractedExtensions(device.contractedExtensions)
        : '',
      extensions: nextDeviceType === PABX_DEVICE_TYPE ? extensions : [],
      nasAccess: nextDeviceType === DEVICE_TYPE_NAS_STORAGE ? nasAccess : { url: '', login: '', password: '' },
      nasUsers: nextDeviceType === DEVICE_TYPE_NAS_STORAGE ? nasUsers : [],
      wifiControllerAccess: nextDeviceType === DEVICE_TYPE_WIFI_CONTROLLER ? wifiControllerAccess : { url: '', login: '', password: '' },
      wifiNetworks: nextDeviceType === DEVICE_TYPE_WIFI_CONTROLLER ? wifiNetworks : []
    });
  };

  const addPppoeAccount = () => {
    setDevice({
      ...device,
      pppoeAccounts: [...pppoeAccounts, { id: makeId(), operatorName: '', login: '', password: '', supportPhone: '' }]
    });
  };

  const updatePppoeAccount = (accountId, field, value) => {
    setDevice({
      ...device,
      pppoeAccounts: pppoeAccounts.map((account) => account.id === accountId ? { ...account, [field]: value } : account)
    });
  };

  const removePppoeAccount = (accountId) => {
    setDevice({
      ...device,
      pppoeAccounts: pppoeAccounts.filter((account) => account.id !== accountId)
    });
  };

  const updatePabxPortal = (field, value) => {
    setDevice({ ...device, pabxPortal: { ...pabxPortal, [field]: value } });
  };

  const addExtension = () => {
    setDevice({
      ...device,
      extensions: [{ id: makeId(), extension: '', login: '', password: '', department: 'Geral', collaborator: '' }, ...extensions]
    });
  };

  const updateExtension = (extensionId, field, value) => {
    setDevice({
      ...device,
      extensions: extensions.map((extension) => extension.id === extensionId ? { ...extension, [field]: value } : extension)
    });
  };

  const removeExtension = (extensionId) => {
    setDevice({ ...device, extensions: extensions.filter((extension) => extension.id !== extensionId) });
  };

  const updateNasAccess = (field, value) => {
    setDevice({ ...device, nasAccess: { ...nasAccess, [field]: value } });
  };

  const addNasUser = () => {
    setDevice({
      ...device,
      nasUsers: [{ id: makeId(), login: '', password: '', department: 'Geral', collaborator: '' }, ...nasUsers]
    });
  };

  const updateNasUser = (userId, field, value) => {
    setDevice({ ...device, nasUsers: nasUsers.map((user) => user.id === userId ? { ...user, [field]: value } : user) });
  };

  const removeNasUser = (userId) => {
    setDevice({ ...device, nasUsers: nasUsers.filter((user) => user.id !== userId) });
  };

  const updateWifiControllerAccess = (field, value) => {
    setDevice({ ...device, wifiControllerAccess: { ...wifiControllerAccess, [field]: value } });
  };

  const addWifiNetwork = () => {
    setDevice({
      ...device,
      wifiNetworks: [{ id: makeId(), ssid: '', password: '', radio24Bandwidth: '20', radio5Bandwidth: '40', radio6Bandwidth: '160', vlan: '', networkType: 'Padrão' }, ...wifiNetworks]
    });
  };

  const updateWifiNetwork = (networkId, field, value) => {
    const nextValue = field === 'vlan' ? sanitizeVlanInput(value) : value;
    setDevice({ ...device, wifiNetworks: wifiNetworks.map((network) => network.id === networkId ? { ...network, [field]: nextValue } : network) });
  };

  const removeWifiNetwork = (networkId) => {
    setDevice({ ...device, wifiNetworks: wifiNetworks.filter((network) => network.id !== networkId) });
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

        <div className={device.deviceType === PABX_DEVICE_TYPE ? 'space-y-3 p-5' : 'space-y-6 p-6'}>
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${device.deviceType === PABX_DEVICE_TYPE ? 'gap-3' : 'gap-4'}`}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome do dispositivo</label>
              <input type="text" className="w-full rounded-md border border-slate-300 p-2 shadow-sm" value={device.name} onChange={(event) => setDevice({ ...device, name: event.target.value })} placeholder="Ex: DVR Loja" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo do dispositivo</label>
              <select className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm" value={device.deviceType} onChange={(event) => handleDeviceTypeChange(event.target.value)}>
                {DEVICE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Observações</label>
              <textarea rows={3} className="w-full rounded-md border border-slate-300 p-2 shadow-sm" value={device.notes} onChange={(event) => setDevice({ ...device, notes: event.target.value })} placeholder="Observações sobre o dispositivo"></textarea>
            </div>
          </div>

          {device.deviceType === DEVICE_TYPE_WIFI_CONTROLLER && (
            <>
              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Acesso WIFI/CONTROLLER</h4>
                <DeviceAccessFields access={wifiControllerAccess} onChange={updateWifiControllerAccess} passwordName={`device_wifi_controller_password_${device.id}`} />
              </div>
              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div><h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Redes Wi-Fi</h4><p className="text-xs text-slate-500 dark:text-slate-400">Redes cadastradas: {wifiNetworks.length}</p></div>
                  <button type="button" onClick={addWifiNetwork} className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><Plus className="mr-2 h-4 w-4" /> Adicionar rede Wi-Fi</button>
                </div>
                <div className="space-y-1.5">
                  {wifiNetworks.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma rede Wi-Fi adicionada.</p> : wifiNetworks.map((network) => (
                    <div key={network.id} className="grid w-full grid-cols-1 items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-800 md:grid-cols-2 xl:grid-cols-4">
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Nome Wi-Fi</label><input type="text" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={network.ssid} onChange={(event) => updateWifiNetwork(network.id, 'ssid', event.target.value)} placeholder="SSID" /></div>
                      <SecurePasswordInput name={`device_wifi_network_password_${network.id}`} label="Senha" value={network.password} onChange={(event) => updateWifiNetwork(network.id, 'password', event.target.value)} enableGenerator={false} autoComplete="new-password" />
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Rádio 2.4 GHz</label><select className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={network.radio24Bandwidth} onChange={(event) => updateWifiNetwork(network.id, 'radio24Bandwidth', event.target.value)}>{RADIO_24_BANDWIDTH_OPTIONS.map((option) => <option key={option} value={option}>{option} MHz</option>)}</select></div>
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Rádio 5 GHz</label><select className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={network.radio5Bandwidth} onChange={(event) => updateWifiNetwork(network.id, 'radio5Bandwidth', event.target.value)}>{RADIO_5_BANDWIDTH_OPTIONS.map((option) => <option key={option} value={option}>{option} MHz</option>)}</select></div>
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Rádio 6 GHz</label><select className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={network.radio6Bandwidth} onChange={(event) => updateWifiNetwork(network.id, 'radio6Bandwidth', event.target.value)}>{RADIO_6_BANDWIDTH_OPTIONS.map((option) => <option key={option} value={option}>{option} MHz</option>)}</select></div>
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">VLAN</label><input type="text" inputMode="numeric" maxLength={4} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={network.vlan} onChange={(event) => updateWifiNetwork(network.id, 'vlan', event.target.value)} placeholder="100" /></div>
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Tipo</label><select className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={network.networkType} onChange={(event) => updateWifiNetwork(network.id, 'networkType', event.target.value)}>{WIFI_NETWORK_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                      <button type="button" title="Excluir rede Wi-Fi" aria-label="Excluir rede Wi-Fi" onClick={() => removeWifiNetwork(network.id)} className="inline-flex shrink-0 items-center justify-center justify-self-end p-0 text-red-500 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:text-red-400 dark:hover:text-red-300 dark:focus-visible:ring-offset-slate-800 xl:mb-3"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {device.deviceType === DEVICE_TYPE_NAS_STORAGE && (
            <>
              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Acesso NAS STORAGE</h4>
                <DeviceAccessFields access={nasAccess} onChange={updateNasAccess} passwordName={`device_nas_access_password_${device.id}`} />
              </div>
              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div><h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Usuários</h4><p className="text-xs text-slate-500 dark:text-slate-400">Usuários NAS: {nasUsers.length}</p></div>
                  <button type="button" onClick={addNasUser} className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><Plus className="mr-2 h-4 w-4" /> Adicionar usuário</button>
                </div>
                <div className="space-y-1.5">
                  {nasUsers.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum usuário NAS adicionado.</p> : nasUsers.map((user) => (
                    <div key={user.id} className="grid w-full grid-cols-1 items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-800 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_minmax(0,1fr)_24px]">
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Login</label><input type="text" autoComplete="off" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={user.login} onChange={(event) => updateNasUser(user.id, 'login', event.target.value)} placeholder="Login" /></div>
                      <SecurePasswordInput name={`device_nas_user_password_${user.id}`} label="Senha" value={user.password} onChange={(event) => updateNasUser(user.id, 'password', event.target.value)} enableGenerator={false} autoComplete="new-password" />
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Departamento</label><select className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={user.department} onChange={(event) => updateNasUser(user.id, 'department', event.target.value)}>{DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}</select></div>
                      <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Colaborador</label><input type="text" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={user.collaborator} onChange={(event) => updateNasUser(user.id, 'collaborator', event.target.value)} placeholder="Nome do colaborador" /></div>
                      <button type="button" title="Excluir usuário NAS" aria-label="Excluir usuário NAS" onClick={() => removeNasUser(user.id)} className="inline-flex shrink-0 items-center justify-center justify-self-end p-0 text-red-500 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:text-red-400 dark:hover:text-red-300 dark:focus-visible:ring-offset-slate-800 xl:mb-3 xl:justify-self-center"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {device.deviceType === PABX_DEVICE_TYPE && (
            <>
              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <DeviceAccessFields access={pabxPortal} onChange={updatePabxPortal} passwordName={`device_pabx_portal_password_${device.id}`} />
              </div>

              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <div className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-2">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ramais</h4>
                      <p className={`text-xs ${hasExtensionOverage ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                        Ramais contratados: {contractedExtensions || 'não informado'} · Ramais em uso: {extensions.length}
                      </p>
                    </div>
                    {duplicateExtensions.size > 0 && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Ramal duplicado</p>}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Quantidade de ramal</label>
                      <input type="text" inputMode="numeric" maxLength={3} className="h-9 w-20 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={contractedExtensions} onChange={(event) => setDevice({ ...device, contractedExtensions: sanitizeContractedExtensions(event.target.value) })} placeholder="20" />
                    </div>
                    <button type="button" onClick={addExtension} className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                      <Plus className="mr-2 h-4 w-4" /> Adicionar ramal
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {extensions.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum ramal adicionado.</p>
                  ) : extensions.map((extension) => {
                    const normalizedExtension = extension.extension.trim().toLowerCase();
                    const isDuplicate = Boolean(normalizedExtension) && duplicateExtensions.has(normalizedExtension);
                    return (
                      <div key={extension.id} className={`grid w-full grid-cols-1 items-end gap-2 rounded-md border p-2 dark:bg-slate-800 md:grid-cols-2 xl:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_150px_minmax(0,1fr)_24px] ${isDuplicate ? 'border-amber-400 bg-amber-50 dark:border-amber-500' : 'border-slate-200 bg-slate-50 dark:border-slate-800'}`}>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Ramal</label>
                          <input type="text" inputMode="numeric" className={`h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm shadow-sm dark:bg-slate-900 dark:text-slate-100 ${isDuplicate ? 'border-amber-400 dark:border-amber-500' : 'border-slate-300 dark:border-slate-700'}`} value={extension.extension} onChange={(event) => updateExtension(extension.id, 'extension', event.target.value)} placeholder="1001" />
                          {isDuplicate && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Ramal duplicado</p>}
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Login</label>
                          <input type="text" autoComplete="off" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={extension.login} onChange={(event) => updateExtension(extension.id, 'login', event.target.value)} placeholder="Login do ramal" />
                        </div>
                        <SecurePasswordInput name={`device_extension_password_${extension.id}`} label="Senha" value={extension.password} onChange={(event) => updateExtension(extension.id, 'password', event.target.value)} enableGenerator={false} autoComplete="new-password" />
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Departamento</label>
                          <select className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={extension.department} onChange={(event) => updateExtension(extension.id, 'department', event.target.value)}>
                            {DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Colaborador</label>
                          <input type="text" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={extension.collaborator} onChange={(event) => updateExtension(extension.id, 'collaborator', event.target.value)} placeholder="Nome do colaborador" />
                        </div>
                        <button type="button" title="Excluir ramal" aria-label="Excluir ramal" onClick={() => removeExtension(extension.id)} className="inline-flex shrink-0 items-center justify-center justify-self-end p-0 text-red-500 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:text-red-400 dark:hover:text-red-300 dark:focus-visible:ring-offset-slate-800 xl:mb-3 xl:justify-self-center"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {device.deviceType === DEVICE_TYPE_ROUTER_GATEWAY && (
            <div className="border-t border-slate-200 pt-5 dark:border-slate-700">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">PPPoE</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Cadastre uma ou mais contas de acesso do roteador.</p>
                </div>
                <button type="button" onClick={addPppoeAccount} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Plus className="mr-2 h-4 w-4" /> Adicionar PPPoE
                </button>
              </div>
              <div className="space-y-1.5">
                {pppoeAccounts.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma conta PPPoE adicionada.</p>
                ) : pppoeAccounts.map((account) => (
                  <div key={account.id} className="grid w-full grid-cols-1 items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-800 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_24px]">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Operadora</label>
                      <input type="text" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={account.operatorName} onChange={(event) => updatePppoeAccount(account.id, 'operatorName', event.target.value)} placeholder="Ex: Vivo" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Login PPPoE</label>
                      <input type="text" autoComplete="off" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={account.login} onChange={(event) => updatePppoeAccount(account.id, 'login', event.target.value)} placeholder="Login PPPoE" />
                    </div>
                    <SecurePasswordInput name={`device_pppoe_password_${account.id}`} label="Senha PPPoE" value={account.password} onChange={(event) => updatePppoeAccount(account.id, 'password', event.target.value)} enableGenerator={false} autoComplete="new-password" />
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Telefone suporte</label>
                      <input type="text" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={account.supportPhone} onChange={(event) => updatePppoeAccount(account.id, 'supportPhone', event.target.value)} placeholder="0800, WhatsApp ou ramal" />
                    </div>
                    <button type="button" title="Excluir PPPoE" aria-label="Excluir PPPoE" onClick={() => removePppoeAccount(account.id)} className="inline-flex shrink-0 items-center justify-center justify-self-end p-0 text-red-500 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:text-red-400 dark:hover:text-red-300 dark:focus-visible:ring-offset-slate-800 xl:mb-3 xl:justify-self-center"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-slate-200 pt-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h4 className="text-sm font-semibold text-slate-900">Conexões</h4><p className="text-xs text-slate-500">Eth1 até Eth5 apenas uma vez. VPN pode ser adicionada até 5 vezes.</p></div>
              <select value="" onChange={(event) => { addConnection(event.target.value); event.target.value = ''; }} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm sm:w-56">
                <option value="">Adicionar conexão...</option>
                {CONNECTION_OPTIONS.map((option) => <option key={option} value={option} disabled={!canAddConnection(option)}>{option}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              {connections.length === 0 ? <p className="text-sm text-slate-500">Nenhuma conexão adicionada.</p> : connections.map((connection) => {
                const ipv4Validation = validateIpv4Cidr(connection.ipv4);
                const gatewayValidation = validateIpv4(connection.gateway);
                const isVpn = connection.type === 'VPN';
                return (
                  <div key={connection.id} className="w-full rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
                    <div className="grid w-full grid-cols-1 items-center gap-2 p-2 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(0,1fr)_24px]">
                      <div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <ConnectionIcon type={connection.type} />
                        <span className="shrink-0">{getConnectionLabel(connection, connections)}</span>
                        <input type="text" aria-label="Nome da conexão" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:ring-0 dark:text-slate-200 dark:placeholder-slate-500" value={connection.name} onChange={(event) => updateConnection(connection.id, 'name', event.target.value)} placeholder="Nome" />
                      </div>
                      {isVpn ? (
                        <>
                          <select aria-label="Tipo de VPN" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={connection.vpn || VPN_OPTIONS[0]} onChange={(event) => updateConnection(connection.id, 'vpn', event.target.value)}>
                            {VPN_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <IpCidrInput value={connection.ipv4} onChange={(value) => updateConnection(connection.id, 'ipv4', value)} state={ipv4Validation.state} error={ipv4Validation.error} label="" ariaLabel="IPV4/CIDR da VPN" placeholder="192.168.1.10/24" prefix="IPV4/" required={false} showHelperText={false} containerClassName="w-full min-w-0" inputWrapperClassName="h-10 w-full min-w-0" inputClassName="text-sm tracking-normal" />
                        </>
                      ) : (
                        <>
                          <IpCidrInput value={connection.ipv4} onChange={(value) => updateConnection(connection.id, 'ipv4', value)} state={ipv4Validation.state} error={ipv4Validation.error} label="" ariaLabel="IPV4/CIDR" placeholder="192.168.1.10/24" prefix="IPV4/" required={false} showHelperText={false} containerClassName="w-full min-w-0" inputWrapperClassName="h-10 w-full min-w-0" inputClassName="text-sm tracking-normal" />
                          <Ipv4Input value={connection.gateway} onChange={(value) => updateConnection(connection.id, 'gateway', value)} state={gatewayValidation.state} error={gatewayValidation.error} label="" ariaLabel="Gateway(IPV4)" placeholder="192.168.1.1" prefix="Gateway/" required={false} showHelperText={false} containerClassName="w-full min-w-0" inputWrapperClassName="h-10 w-full min-w-0" inputClassName="text-sm tracking-normal" />
                        </>
                      )}
                      <button type="button" title="Excluir conexão" aria-label="Excluir conexão" onClick={() => setDevice({ ...device, connections: connections.filter((item) => item.id !== connection.id) })} className="inline-flex shrink-0 items-center justify-center justify-self-end p-0 text-red-500 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:text-red-400 dark:hover:text-red-300 dark:focus-visible:ring-offset-slate-800 md:justify-self-center"><Trash2 className="h-4 w-4" /></button>
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
