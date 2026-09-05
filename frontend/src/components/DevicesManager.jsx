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
const DEVICE_LOGIN_EXCLUDED_TYPES = new Set([DEVICE_TYPE_WIFI_CONTROLLER, DEVICE_TYPE_ROUTER_GATEWAY]);
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
const DVR_PORT_FIELDS = [
  ['tcpPort', 'PORTA TCP'],
  ['httpsPort', 'PORTA HTTPS'],
  ['httpPort', 'PORTA HTTP'],
  ['rtspPort', 'PORTA RTSP'],
  ['ntpPort', 'PORTA NTP'],
  ['posPort', 'PORTA POS']
];
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
  dvrAccess: { ip: '', tcpPort: '', httpsPort: '', httpPort: '', rtspPort: '', ntpPort: '', posPort: '', deviceId: '', mac: '', ddns: '' },
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
  extension: '',
  login: '',
  password: '',
  department: 'Geral',
  collaborator: '',
  permission: 'User'
});

const emptyNasUserDraft = () => ({
  login: '',
  password: '',
  department: 'Geral',
  collaborator: ''
});

const emptyPabxExtensionDraft = () => ({
  extension: '',
  login: '',
  password: '',
  department: 'Geral',
  collaborator: ''
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

const normalizeDvrAccess = (device = {}) => {
  const access = device.dvrAccess || {};
  return {
    ip: sanitizeIpv4Input(access.ip ?? ''),
    tcpPort: sanitizePortInput(access.tcpPort ?? ''),
    httpsPort: sanitizePortInput(access.httpsPort ?? ''),
    httpPort: sanitizePortInput(access.httpPort ?? ''),
    rtspPort: sanitizePortInput(access.rtspPort ?? ''),
    ntpPort: sanitizePortInput(access.ntpPort ?? ''),
    posPort: sanitizePortInput(access.posPort ?? ''),
    deviceId: String(access.deviceId ?? ''),
    mac: String(access.mac ?? ''),
    ddns: String(access.ddns ?? '')
  };
};

const isOptionalValidPort = (value) => !value || isValidPort(value);

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
    const normalizedExtension = String(item?.extension ?? '').trim();
    if (!normalizedExtension) return;
    counts.set(normalizedExtension, (counts.get(normalizedExtension) || 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([extension]) => extension));
};

const getDuplicateLogins = (items = []) => {
  const counts = new Map();
  items.forEach((item) => {
    const normalizedLogin = String(item?.login ?? '').trim().toLowerCase();
    if (!normalizedLogin) return;
    counts.set(normalizedLogin, (counts.get(normalizedLogin) || 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([login]) => login));
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
    dvrAccess: normalizeDvrAccess(device),
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

const canReceiveDeviceLogin = (device = {}) => !DEVICE_LOGIN_EXCLUDED_TYPES.has(normalizeDeviceType(device.deviceType || device.type));

const getUnifiedDeviceAccessItems = (normalizedForm) => {
  const devicesById = new Map(normalizedForm.devices.map((device) => [device.id, device]));
  const withDevice = (item, device, source) => ({
    ...item,
    source,
    deviceId: device?.id || item.deviceId || '',
    deviceName: device?.name || 'Dispositivo não encontrado',
    deviceType: device?.deviceType || '',
    iconType: device?.deviceType || ''
  });

  const genericItems = normalizedForm.deviceLogins.map((login) => withDevice({
    ...login,
    collaborator: '',
    extension: ''
  }, devicesById.get(login.deviceId), 'generic'));

  const embeddedItems = normalizedForm.devices.flatMap((device) => [
    ...normalizeNasUsers(device).map((user) => withDevice({
      ...user,
      permission: '',
      extension: ''
    }, device, 'nasUser')),
    ...normalizeExtensions(device).map((extension) => withDevice({
      ...extension,
      permission: ''
    }, device, 'pabxExtension'))
  ]);

  return [...genericItems, ...embeddedItems];
};

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

const formatDvrSummary = (device) => {
  if (device?.deviceType !== 'DVR') return '';
  const access = normalizeDvrAccess(device);
  return [
    access.ip && `IP: ${access.ip}`,
    access.tcpPort && `TCP: ${access.tcpPort}`,
    access.httpPort && `HTTP: ${access.httpPort}`,
    access.ddns && 'DDNS configurado'
  ].filter(Boolean).join(' · ');
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
  const eligibleLoginDevices = useMemo(() => normalizedForm.devices.filter(canReceiveDeviceLogin), [normalizedForm.devices]);
  const unifiedAccessItems = useMemo(() => getUnifiedDeviceAccessItems(normalizedForm), [normalizedForm]);
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
    const connectionError = device.deviceType === 'DVR' ? '' : getDeviceConnectionError(device);
    if (connectionError) {
      alert(connectionError);
      return false;
    }
    const invalidPort = device.deviceType === 'DVR' ? null : findInvalidPort(device);
    if (invalidPort) {
      alert(`A porta "${invalidPort.portNumber || 'vazia'}" em "${invalidPort.name || 'Porta'}" é inválida. Informe uma porta entre 1 e 65535.`);
      return false;
    }
    const dvrAccess = normalizeDvrAccess(device);
    const invalidDvrPort = device.deviceType === 'DVR'
      ? DVR_PORT_FIELDS.find(([field]) => !isOptionalValidPort(dvrAccess[field]))
      : null;
    if (invalidDvrPort) {
      alert(`A ${invalidDvrPort[1]} do DVR é inválida. Informe uma porta entre 1 e 65535.`);
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

  const addDevice = async (deviceToSave = deviceDraft) => {
    if (!validateDevice(deviceToSave)) return false;
    const newDevice = normalizeDevice({ ...deviceToSave, id: makeId() });
    const nextForm = { ...normalizedForm, devices: [newDevice, ...normalizedForm.devices] };
    const saved = await persistDevices(nextForm, 'Dispositivo cadastrado e salvo automaticamente no cofre.');
    if (saved) {
      setDeviceDraft(emptyDevice());
      setShowCreateModal(false);
    }
    return saved;
  };

  const saveEditedDevice = async (deviceToSave = editingDevice) => {
    if (!validateDevice(deviceToSave)) return false;
    const normalizedDevice = normalizeDevice(deviceToSave);
    const nextForm = {
      ...normalizedForm,
      devices: normalizedForm.devices.map((device) => device.id === normalizedDevice.id ? normalizedDevice : device)
    };
    const saved = await persistDevices(nextForm, 'Dispositivo atualizado e salvo no cofre.');
    if (saved) {
      setEditingDevice(null);
      setDeleteConfirmation('');
    }
    return saved;
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

  const validateDeviceLogin = (deviceLogin, forceGeneric = false) => {
    const selectedDevice = normalizedForm.devices.find((device) => device.id === deviceLogin.deviceId);
    if (!selectedDevice || (!forceGeneric && !canReceiveDeviceLogin(selectedDevice))) {
      alert('Selecione um dispositivo válido.');
      return false;
    }
    if (!DEPARTMENT_OPTIONS.includes(deviceLogin.department)) {
      alert('Selecione um departamento válido.');
      return false;
    }

    if (!forceGeneric && selectedDevice.deviceType === DEVICE_TYPE_NAS_STORAGE) {
      if (!deviceLogin.login.trim() && !deviceLogin.collaborator.trim()) {
        alert('Informe pelo menos o login ou o colaborador.');
        return false;
      }
      return true;
    }

    if (!forceGeneric && selectedDevice.deviceType === PABX_DEVICE_TYPE) {
      if (!deviceLogin.extension.trim() && !deviceLogin.login.trim() && !deviceLogin.collaborator.trim()) {
        alert('Informe pelo menos o ramal, o login ou o colaborador.');
        return false;
      }
      return true;
    }

    if (!deviceLogin.login.trim()) {
      alert('Informe o login.');
      return false;
    }
    if (!deviceLogin.password) {
      alert('Informe a senha.');
      return false;
    }
    if (!DEVICE_LOGIN_PERMISSIONS.includes(deviceLogin.permission)) {
      alert('Selecione a permissão Admin ou User.');
      return false;
    }
    return true;
  };

  const openCreateLoginModal = () => {
    if (isSaving || eligibleLoginDevices.length === 0) return;
    setLoginDraft(emptyDeviceLogin(eligibleLoginDevices[0]?.id || ''));
    setShowLoginCreateModal(true);
  };

  const closeCreateLoginModal = () => {
    setLoginDraft(emptyDeviceLogin(eligibleLoginDevices[0]?.id || ''));
    setShowLoginCreateModal(false);
  };

  const addDeviceLogin = async () => {
    if (!validateDeviceLogin(loginDraft)) return;
    const selectedDevice = normalizedForm.devices.find((device) => device.id === loginDraft.deviceId);
    const nextId = makeId();
    let nextForm;

    if (selectedDevice.deviceType === DEVICE_TYPE_NAS_STORAGE) {
      const newUser = normalizeNasUsers({ nasUsers: [{ ...loginDraft, id: nextId }] })[0];
      nextForm = {
        ...normalizedForm,
        devices: normalizedForm.devices.map((device) => device.id === selectedDevice.id
          ? { ...device, nasUsers: [newUser, ...normalizeNasUsers(device)] }
          : device)
      };
    } else if (selectedDevice.deviceType === PABX_DEVICE_TYPE) {
      const newExtension = normalizeExtensions({ extensions: [{ ...loginDraft, id: nextId }] })[0];
      nextForm = {
        ...normalizedForm,
        devices: normalizedForm.devices.map((device) => device.id === selectedDevice.id
          ? { ...device, extensions: [newExtension, ...normalizeExtensions(device)] }
          : device)
      };
    } else {
      const newLogin = normalizeDeviceLogin({ ...loginDraft, id: nextId });
      nextForm = {
        ...normalizedForm,
        deviceLogins: [newLogin, ...normalizedForm.deviceLogins]
      };
    }

    const saved = await persistDevices(nextForm, 'Login do dispositivo cadastrado e salvo no cofre.');
    if (saved) {
      setLoginDraft(emptyDeviceLogin(eligibleLoginDevices[0]?.id || ''));
      setShowLoginCreateModal(false);
    }
  };

  const saveEditedLogin = async () => {
    const isGeneric = editingLogin.source === 'generic' || !editingLogin.source;
    if (!validateDeviceLogin(editingLogin, isGeneric)) return;
    let nextForm;
    if (editingLogin.source === 'nasUser') {
      const normalizedUser = normalizeNasUsers({ nasUsers: [editingLogin] })[0];
      nextForm = {
        ...normalizedForm,
        devices: normalizedForm.devices.map((device) => device.id === editingLogin.deviceId
          ? { ...device, nasUsers: normalizeNasUsers(device).map((user) => user.id === normalizedUser.id ? normalizedUser : user) }
          : device)
      };
    } else if (editingLogin.source === 'pabxExtension') {
      const normalizedExtension = normalizeExtensions({ extensions: [editingLogin] })[0];
      nextForm = {
        ...normalizedForm,
        devices: normalizedForm.devices.map((device) => device.id === editingLogin.deviceId
          ? { ...device, extensions: normalizeExtensions(device).map((extension) => extension.id === normalizedExtension.id ? normalizedExtension : extension) }
          : device)
      };
    } else {
      const normalizedLogin = normalizeDeviceLogin(editingLogin);
      nextForm = {
        ...normalizedForm,
        deviceLogins: normalizedForm.deviceLogins.map((deviceLogin) => (
          deviceLogin.id === normalizedLogin.id ? normalizedLogin : deviceLogin
        ))
      };
    }
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
    let nextForm;
    if (editingLogin.source === 'nasUser') {
      nextForm = {
        ...normalizedForm,
        devices: normalizedForm.devices.map((device) => device.id === editingLogin.deviceId
          ? { ...device, nasUsers: normalizeNasUsers(device).filter((user) => user.id !== editingLogin.id) }
          : device)
      };
    } else if (editingLogin.source === 'pabxExtension') {
      nextForm = {
        ...normalizedForm,
        devices: normalizedForm.devices.map((device) => device.id === editingLogin.deviceId
          ? { ...device, extensions: normalizeExtensions(device).filter((extension) => extension.id !== editingLogin.id) }
          : device)
      };
    } else {
      nextForm = {
        ...normalizedForm,
        deviceLogins: normalizedForm.deviceLogins.filter((deviceLogin) => deviceLogin.id !== editingLogin.id)
      };
    }
    const saved = await persistDevices(nextForm, 'Login do dispositivo excluído e cofre atualizado.');
    if (saved) {
      setEditingLogin(null);
      setLoginDeleteConfirmation('');
    }
  };

  const filteredAccessItems = unifiedAccessItems.filter((accessItem) => {
    if (loginDeviceFilter && accessItem.deviceId !== loginDeviceFilter) return false;

    const search = loginSearch.trim().toLowerCase();
    if (!search) return true;
    return [
      accessItem.deviceName,
      accessItem.deviceType,
      accessItem.login,
      accessItem.department,
      accessItem.collaborator,
      accessItem.permission,
      accessItem.extension,
      accessItem.source
    ].join(' ').toLowerCase().includes(search);
  });

  const filteredAccessGroups = normalizedForm.devices.map((device) => ({
    device,
    items: filteredAccessItems.filter((item) => item.deviceId === device.id)
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex min-h-10 w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1 shadow-sm sm:h-10 sm:flex-nowrap sm:py-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <button type="button" disabled={isSaving} onClick={() => { setDeviceDraft(emptyDevice()); setShowCreateModal(true); }} className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="mr-2 h-4 w-4" /> Adicionar dispositivo
          </button>
          <button
            type="button"
            disabled={isSaving || eligibleLoginDevices.length === 0}
            title={eligibleLoginDevices.length === 0 ? 'Cadastre um dispositivo compatível antes de adicionar logins. ROTEADOR/GATEWAY e WIFI/CONTROLLER não recebem logins por este fluxo.' : 'Adicionar login'}
            onClick={openCreateLoginModal}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="mr-2 h-4 w-4" /> Adicionar login
          </button>
        </div>
        {onDeleteModule && <button type="button" title="Excluir dispositivos" aria-label="Excluir dispositivos" onClick={onDeleteModule} className="action-icon-button action-icon-delete"><Trash2 className="h-4 w-4" /></button>}
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
                {device.deviceType === 'DVR' ? (
                  formatDvrSummary(device) && <span className="min-w-0 break-words">{formatDvrSummary(device)}</span>
                ) : (
                  <><span className="whitespace-nowrap">Conexões: {device.connections.length}</span><span className="whitespace-nowrap">Portas: {device.portRules.length}</span></>
                )}
                {formatPppoeSummary(device) && <span className="whitespace-nowrap">{formatPppoeSummary(device)}</span>}
                {formatWifiNetworksSummary(device) && <span className="whitespace-nowrap">{formatWifiNetworksSummary(device)}</span>}
                {formatNasUsersSummary(device) && <span className="whitespace-nowrap">{formatNasUsersSummary(device)}</span>}
                {formatPabxExtensionsSummary(device) && <span className="whitespace-nowrap">{formatPabxExtensionsSummary(device)}</span>}
                <span className="whitespace-nowrap">Logins: {unifiedAccessItems.filter((accessItem) => accessItem.deviceId === device.id).length}</span>
              </div>
              <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                <button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingDevice(device)} className="action-icon-button action-icon-view"><Eye className="h-4 w-4" /></button>
                <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingDevice({ ...device }); setDeleteConfirmation(''); }} className="action-icon-button action-icon-edit"><Edit2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Pesquisar login</label>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            placeholder="Buscar por dispositivo, login, colaborador, departamento ou ramal..."
            value={loginSearch}
            onChange={(event) => setLoginSearch(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Filtrar por dispositivo</label>
          <select className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={loginDeviceFilter} onChange={(event) => setLoginDeviceFilter(event.target.value)}>
            <option value="">Todos os dispositivos</option>
            {normalizedForm.devices.map((device) => <option key={device.id} value={device.id}>{getDeviceLabel(device.id)}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 pb-5 pt-3 dark:border-slate-700 dark:bg-slate-800/60">
        <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">Logins cadastrados</h3>
        <div className="space-y-3">
          {filteredAccessGroups.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {loginSearch.trim() || loginDeviceFilter ? 'Nenhum login encontrado.' : 'Nenhum login de dispositivo cadastrado.'}
            </p>
          ) : filteredAccessGroups.map(({ device, items }) => (
            <section key={device.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                <DeviceTypeIcon type={device.deviceType} />
                <h4 className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{formatDeviceOptionLabel(device)}</h4>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((accessItem) => (
                  <div key={`${accessItem.source}-${accessItem.deviceId}-${accessItem.id}`} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <DeviceLoginIcon permission={accessItem.permission} />
                      {accessItem.extension && <span className="font-medium text-slate-900 dark:text-slate-100">Ramal: {accessItem.extension}</span>}
                      <span className="inline-flex items-center gap-1 font-medium text-slate-900 dark:text-slate-100">
                        <span>{accessItem.login || 'Login não informado'}</span>
                        {accessItem.login && <CopyButton value={accessItem.login} label="Copiar login" />}
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                        <span>· Senha: ****</span>
                        {accessItem.password && <CopyButton value={accessItem.password} label="Copiar senha" />}
                      </span>
                      {accessItem.permission && <span className="text-slate-600 dark:text-slate-300">· Permissão: {accessItem.permission}</span>}
                      <span className="text-slate-600 dark:text-slate-300">· Departamento: {accessItem.department}</span>
                      {accessItem.collaborator && <span className="text-slate-600 dark:text-slate-300">· Colaborador: {accessItem.collaborator}</span>}
                    </div>
                    <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                      <button type="button" title="Visualizar" aria-label="Visualizar" onClick={() => setViewingLogin(accessItem)} className="action-icon-button action-icon-view"><Eye className="h-4 w-4" /></button>
                      <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => { setEditingLogin({ ...accessItem }); setLoginDeleteConfirmation(''); }} className="action-icon-button action-icon-edit"><Edit2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {showCreateModal && <DeviceModal title="Cadastrar dispositivo" device={deviceDraft} setDevice={setDeviceDraft} isSaving={isSaving} onCancel={closeCreateDeviceModal} onSave={addDevice} />}
      {viewingDevice && <DeviceReadOnlyModal device={viewingDevice} accessItems={unifiedAccessItems.filter((item) => item.deviceId === viewingDevice.id)} onClose={() => setViewingDevice(null)} />}
      {showLoginCreateModal && (
        <DeviceLoginModal
          title="Adicionar login"
          deviceLogin={loginDraft}
          setDeviceLogin={setLoginDraft}
          devices={eligibleLoginDevices}
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
          linkedAccessItems={unifiedAccessItems.filter((item) => item.deviceId === editingDevice.id)}
          onEditLinkedLogin={(accessItem) => { setEditingLogin({ ...accessItem }); setLoginDeleteConfirmation(''); }}
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
          forceGeneric={editingLogin.source === 'generic' || !editingLogin.source}
          lockDeviceSelection={editingLogin.source === 'nasUser' || editingLogin.source === 'pabxExtension'}
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

function UnsavedChangesDialog({ isSaving, onContinue, onDiscard, onSave }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="unsaved-changes-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
        <h3 id="unsaved-changes-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Alterações não salvas</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Existem alterações que ainda não foram salvas. Deseja salvar antes de fechar?</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onContinue} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Continuar editando</button>
          <button type="button" onClick={onDiscard} className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30">Descartar</button>
          <button type="button" disabled={isSaving} onClick={onSave} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar e fechar'}</button>
        </div>
      </div>
    </div>
  );
}

function DeviceAccessListModal({ device, items, kind, onClose, onRemove, onEdit, readOnly = false }) {
  const [search, setSearch] = useState('');
  const isPabx = kind === 'pabxExtension';
  const duplicateExtensions = isPabx ? getDuplicateExtensions(items) : new Set();
  const duplicateLogins = isPabx ? getDuplicateLogins(items) : new Set();
  const filteredItems = items.filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [item.extension, item.login, item.department, item.collaborator].join(' ').toLowerCase().includes(term);
  });

  useClearOnVaultLock(() => setSearch(''));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Logins e usuários do dispositivo</h3>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><DeviceTypeIcon type={device.deviceType} />{formatDeviceOptionLabel(device)}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar lista de logins e usuários" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-5 w-5" /></button>
          </div>
          {!readOnly && <input type="search" aria-label="Pesquisar logins e usuários" className="mt-3 w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isPabx ? 'Pesquisar por ramal, login, departamento ou colaborador...' : 'Pesquisar por login, departamento ou colaborador...'} />}
        </div>
        <div className="space-y-2 p-5">
          {filteredItems.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{search.trim() ? 'Nenhum login ou usuário encontrado.' : 'Nenhum login ou usuário cadastrado.'}</p>
          ) : filteredItems.map((item) => {
            const normalizedExtension = String(item.extension || '').trim();
            const normalizedLogin = String(item.login || '').trim().toLowerCase();
            const isDuplicateExtension = isPabx && Boolean(normalizedExtension) && duplicateExtensions.has(normalizedExtension);
            const isDuplicateLogin = isPabx && Boolean(normalizedLogin) && duplicateLogins.has(normalizedLogin);
            const isDuplicate = isDuplicateExtension || isDuplicateLogin;
            return (
              <div key={item.id} className={`flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${isDuplicate ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/30' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {kind === 'generic' && <DeviceLoginIcon permission={item.permission} />}
                  {isPabx && <span className="font-medium text-slate-900 dark:text-slate-100">Ramal: {item.extension || '-'}</span>}
                  <span className="inline-flex items-center gap-1 text-slate-900 dark:text-slate-100">Login: {item.login || '-'}{item.login && <CopyButton value={item.login} label={isPabx ? 'Copiar login do ramal' : 'Copiar login do usuário NAS'} />}</span>
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">· Senha: ****{item.password && <CopyButton value={item.password} label={isPabx ? 'Copiar senha do ramal' : 'Copiar senha do usuário NAS'} />}</span>
                  <span className="text-slate-600 dark:text-slate-300">· {item.department}</span>
                  {item.collaborator && <span className="text-slate-600 dark:text-slate-300">· {item.collaborator}</span>}
                  {item.permission && <span className="text-slate-600 dark:text-slate-300">· Permissão: {item.permission}</span>}
                  {isDuplicateExtension && <span className="font-medium text-amber-700 dark:text-amber-300">· Ramal duplicado</span>}
                  {isDuplicateLogin && <span className="font-medium text-amber-700 dark:text-amber-300">· Login duplicado</span>}
                </div>
                {(onEdit || onRemove) && <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                  {onEdit && <button type="button" title="Detalhes" aria-label="Detalhes" onClick={() => onEdit(item)} className="action-icon-button action-icon-edit"><Edit2 className="h-4 w-4" /></button>}
                  {onRemove && <button type="button" title={isPabx ? 'Excluir ramal' : kind === 'nasUser' ? 'Excluir usuário NAS' : 'Excluir login'} aria-label={isPabx ? 'Excluir ramal' : kind === 'nasUser' ? 'Excluir usuário NAS' : 'Excluir login'} onClick={() => onRemove(item.id)} className="action-icon-button action-icon-delete"><Trash2 className="h-4 w-4" /></button>}
                </div>}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700">Fechar</button>
        </div>
      </div>
    </div>
  );
}

function DeviceReadOnlyModal({ device, accessItems = [], onClose }) {
  const normalized = normalizeDevice(device);
  const [showAccessList, setShowAccessList] = useState(false);
  useClearOnVaultLock(() => setShowAccessList(false));
  return (
    <ReadOnlyDetailsModal title="Visualizar dispositivo" onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nome do dispositivo</p><p className="mt-1 text-sm text-slate-900">{normalized.name || '-'}</p></div>
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tipo do dispositivo</p><div className="mt-1 flex items-center gap-2 text-sm text-slate-900"><DeviceTypeIcon type={normalized.deviceType} /><span>{normalized.deviceType || '-'}</span></div></div>
        <div className="sm:col-span-2"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Observações</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{normalized.notes || '-'}</p></div>
      </div>

      {normalized.deviceType === 'DVR' && <DvrAccessReadOnly access={normalized.dvrAccess} />}

      {normalized.deviceType !== 'DVR' && <section>
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
      </section>}

      {['DVR', 'IMPRESSORA'].includes(normalized.deviceType) && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Logins e usuários</h4><p className="text-xs text-slate-500 dark:text-slate-400">Logins cadastrados: {accessItems.length}</p></div>
            <button type="button" onClick={() => setShowAccessList(true)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Exibir lista de logins e usuários</button>
          </div>
        </section>
      )}

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
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Usuários NAS</h4><p className="text-xs text-slate-500 dark:text-slate-400">Usuários cadastrados: {normalized.nasUsers.length}</p></div><button type="button" onClick={() => setShowAccessList(true)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Exibir lista de logins e usuários</button></div>
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
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ramais</h4><p className="text-xs text-slate-500 dark:text-slate-400">Ramais contratados: {normalized.contractedExtensions || 'não informado'} · Ramais em uso: {normalized.extensions.length}</p></div><button type="button" onClick={() => setShowAccessList(true)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Exibir lista de logins e usuários</button></div>
          </section>
        </>
      )}

      {normalized.deviceType !== 'DVR' && <section>
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
      </section>}

      <ReadOnlyAttachments files={normalized.attachments} />
      {showAccessList && normalized.deviceType === DEVICE_TYPE_NAS_STORAGE && <DeviceAccessListModal device={normalized} items={normalized.nasUsers} kind="nasUser" readOnly onClose={() => setShowAccessList(false)} />}
      {showAccessList && normalized.deviceType === PABX_DEVICE_TYPE && <DeviceAccessListModal device={normalized} items={normalized.extensions} kind="pabxExtension" readOnly onClose={() => setShowAccessList(false)} />}
      {showAccessList && ['DVR', 'IMPRESSORA'].includes(normalized.deviceType) && <DeviceAccessListModal device={normalized} items={accessItems} kind="generic" readOnly onClose={() => setShowAccessList(false)} />}
    </ReadOnlyDetailsModal>
  );
}

function DvrAccessReadOnly({ access }) {
  const fields = [
    ['IP', 'ip'], ...DVR_PORT_FIELDS.map(([field, label]) => [label, field]),
    ['ID', 'deviceId'], ['MAC', 'mac'], ['DDNS', 'ddns']
  ];
  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Acesso DVR</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(([label, field]) => (
          <div key={field}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-900 dark:text-slate-100">
              <span className="min-w-0 break-all">{access[field] || '-'}</span>
              {['ip', 'deviceId', 'mac', 'ddns'].includes(field) && access[field] && <CopyButton value={access[field]} label={`Copiar ${label}`} />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeviceLoginReadOnlyModal({ deviceLogin, deviceLabel, onClose }) {
  const normalized = deviceLogin.source ? deviceLogin : { ...normalizeDeviceLogin(deviceLogin), source: 'generic', extension: '', collaborator: '' };
  return (
    <ReadOnlyDetailsModal title="Visualizar login do dispositivo" onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dispositivo</p>
          <p className="mt-1 text-sm text-slate-900">{deviceLabel}</p>
        </div>
        {normalized.extension && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ramal</p>
            <p className="mt-1 text-sm text-slate-900">{normalized.extension}</p>
          </div>
        )}
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
            {normalized.password && <CopyButton value={normalized.password} label="Copiar senha" />}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Departamento</p>
          <p className="mt-1 text-sm text-slate-900">{normalized.department}</p>
        </div>
        {normalized.permission && <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Permissão</p>
          <p className="mt-1 text-sm text-slate-900">{normalized.permission}</p>
        </div>}
        {normalized.collaborator && <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Colaborador</p>
          <p className="mt-1 text-sm text-slate-900">{normalized.collaborator}</p>
        </div>}
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
  setDeleteConfirmation,
  forceGeneric = false,
  lockDeviceSelection = false
}) {
  const [initialDeviceLoginSnapshot] = useState(() => JSON.stringify(deviceLogin));
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const linkedDeviceExists = devices.some((device) => device.id === deviceLogin.deviceId);
  const selectedDevice = devices.find((device) => device.id === deviceLogin.deviceId);
  const selectedType = forceGeneric ? '' : selectedDevice?.deviceType;
  const isNasStorage = selectedType === DEVICE_TYPE_NAS_STORAGE;
  const isPabx = selectedType === PABX_DEVICE_TYPE;
  const normalizedDraftExtension = deviceLogin.extension.trim();
  const extensionIsDuplicate = isPabx && Boolean(normalizedDraftExtension)
    && normalizeExtensions(selectedDevice).some((item) => item.id !== deviceLogin.id && item.extension.trim() === normalizedDraftExtension);
  const normalizedDraftLogin = deviceLogin.login.trim().toLowerCase();
  const loginIsDuplicate = isPabx && Boolean(normalizedDraftLogin)
    && normalizeExtensions(selectedDevice).some((item) => item.id !== deviceLogin.id && item.login.trim().toLowerCase() === normalizedDraftLogin);
  const hasUnsavedChanges = JSON.stringify(deviceLogin) !== initialDeviceLoginSnapshot;

  useClearOnVaultLock(() => setShowUnsavedDialog(false));

  const changeDevice = (deviceId) => {
    setDeviceLogin({ ...emptyDeviceLogin(deviceId), id: deviceLogin.id });
  };

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
      return;
    }
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <button type="button" onClick={requestClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Dispositivo</label>
            <select
              required
              disabled={lockDeviceSelection}
              className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={deviceLogin.deviceId}
              onChange={(event) => changeDevice(event.target.value)}
            >
              <option value="">Selecione o dispositivo</option>
              {!linkedDeviceExists && deviceLogin.deviceId && <option value={deviceLogin.deviceId}>Dispositivo não encontrado</option>}
              {devices.map((device) => <option key={device.id} value={device.id}>{formatDeviceOptionLabel(device)}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isPabx && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Ramal</label>
                <input type="text" inputMode="numeric" className={`w-full rounded-md border bg-white p-2 shadow-sm dark:bg-slate-900 dark:text-slate-100 ${extensionIsDuplicate ? 'border-amber-400 dark:border-amber-500' : 'border-slate-300 dark:border-slate-700'}`} value={deviceLogin.extension} onChange={(event) => setDeviceLogin({ ...deviceLogin, extension: event.target.value })} placeholder="1001" />
                {extensionIsDuplicate && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Ramal duplicado</p>}
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Login</label>
              <input
                type="text"
                required={!isNasStorage && !isPabx}
                autoComplete="username"
                className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={deviceLogin.login}
                onChange={(event) => setDeviceLogin({ ...deviceLogin, login: event.target.value })}
                placeholder="login"
              />
              {loginIsDuplicate && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Login duplicado</p>}
            </div>
            {(isNasStorage || isPabx) && <SecurePasswordInput
              name={`device_login_password_${deviceLogin.id}`}
              label="Senha"
              value={deviceLogin.password}
              onChange={(event) => setDeviceLogin({ ...deviceLogin, password: event.target.value })}
              enableGenerator={false}
              autoComplete="new-password"
            />}
            {!isNasStorage && !isPabx && <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Permissão</label>
              <select
                required
                className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={deviceLogin.permission}
                onChange={(event) => setDeviceLogin({ ...deviceLogin, permission: event.target.value })}
              >
                {DEVICE_LOGIN_PERMISSIONS.map((permission) => <option key={permission} value={permission}>{permission}</option>)}
              </select>
            </div>}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Departamento</label>
              <select
                required
                className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={deviceLogin.department}
                onChange={(event) => setDeviceLogin({ ...deviceLogin, department: event.target.value })}
              >
                {DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </div>
            {!isNasStorage && !isPabx && <SecurePasswordInput
              name={`device_login_password_${deviceLogin.id}`}
              label="Senha"
              required
              value={deviceLogin.password}
              onChange={(event) => setDeviceLogin({ ...deviceLogin, password: event.target.value })}
            />}
            {(isNasStorage || isPabx) && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Colaborador</label>
                <input type="text" className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={deviceLogin.collaborator} onChange={(event) => setDeviceLogin({ ...deviceLogin, collaborator: event.target.value })} placeholder="Nome do colaborador" />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
          {onDelete && (
            <DeleteConfirmationControl
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              onDelete={onDelete}
              disabled={isSaving}
            />
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={requestClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Cancelar</button>
            <button type="button" disabled={isSaving} onClick={onSave} className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
        {showUnsavedDialog && <UnsavedChangesDialog isSaving={isSaving} onContinue={() => setShowUnsavedDialog(false)} onDiscard={onCancel} onSave={onSave} />}
      </div>
    </div>
  );
}

function DeviceModal({ title, device, setDevice, isSaving, onCancel, onSave, onDelete, deleteConfirmation, setDeleteConfirmation, linkedLoginCount = 0, linkedAccessItems = [], onEditLinkedLogin }) {
  const [initialDeviceSnapshot] = useState(() => JSON.stringify(device));
  const [nasUserDraft, setNasUserDraft] = useState(emptyNasUserDraft());
  const [pabxExtensionDraft, setPabxExtensionDraft] = useState(emptyPabxExtensionDraft());
  const [showAccessList, setShowAccessList] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const connections = normalizeConnections(device);
  const pppoeAccounts = normalizePppoeAccounts(device);
  const pabxPortal = normalizePabxPortal(device);
  const extensions = normalizeExtensions(device);
  const duplicateExtensions = getDuplicateExtensions(extensions);
  const duplicateLogins = getDuplicateLogins(extensions);
  const normalizedDraftExtension = pabxExtensionDraft.extension.trim();
  const draftExtensionIsDuplicate = Boolean(normalizedDraftExtension) && extensions.some((item) => item.extension.trim() === normalizedDraftExtension);
  const normalizedDraftLogin = pabxExtensionDraft.login.trim().toLowerCase();
  const draftLoginIsDuplicate = Boolean(normalizedDraftLogin) && extensions.some((item) => item.login.trim().toLowerCase() === normalizedDraftLogin);
  const contractedExtensions = sanitizeContractedExtensions(device.contractedExtensions);
  const hasExtensionOverage = Boolean(contractedExtensions) && extensions.length > Number(contractedExtensions);
  const nasAccess = normalizeAccessCredentials(device.nasAccess);
  const nasUsers = normalizeNasUsers(device);
  const wifiControllerAccess = normalizeAccessCredentials(device.wifiControllerAccess);
  const wifiNetworks = normalizeWifiNetworks(device);
  const portRules = normalizePortRules(device);
  const dvrAccess = normalizeDvrAccess(device);
  const isExistingDevice = Boolean(onDelete);
  const hasInvalidConnections = device.deviceType !== 'DVR' && connections.some((connection) => (
    validateIpv4Cidr(connection.ipv4).state === 'invalid'
    || (connection.type !== 'VPN' && validateIpv4(connection.gateway).state === 'invalid')
  ));
  const hasInvalidPorts = device.deviceType !== 'DVR' && portRules.some((rule) => !isValidPort(rule.portNumber));
  const hasInvalidDvrPorts = device.deviceType === 'DVR' && DVR_PORT_FIELDS.some(([field]) => !isOptionalValidPort(dvrAccess[field]));
  const hasNasUserDraft = Object.values(nasUserDraft).some((value) => value && value !== 'Geral');
  const hasPabxExtensionDraft = Object.values(pabxExtensionDraft).some((value) => value && value !== 'Geral');
  const hasUnsavedChanges = JSON.stringify(device) !== initialDeviceSnapshot || hasNasUserDraft || hasPabxExtensionDraft;

  useClearOnVaultLock(() => {
    setNasUserDraft(emptyNasUserDraft());
    setPabxExtensionDraft(emptyPabxExtensionDraft());
    setShowAccessList(false);
    setShowUnsavedDialog(false);
  });

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
      return;
    }
    onCancel();
  };

  const saveDeviceIncludingDrafts = async () => {
    let deviceToSave = device;
    if (device.deviceType === DEVICE_TYPE_NAS_STORAGE && hasNasUserDraft) {
      if (!nasUserDraft.login.trim() && !nasUserDraft.collaborator.trim()) {
        alert('Informe pelo menos o login ou o colaborador do usuário NAS antes de salvar.');
        return false;
      }
      if (!DEPARTMENT_OPTIONS.includes(nasUserDraft.department)) {
        alert('Selecione um departamento válido para o usuário NAS.');
        return false;
      }
      deviceToSave = { ...deviceToSave, nasUsers: [{ id: makeId(), ...nasUserDraft }, ...nasUsers] };
    }
    if (device.deviceType === PABX_DEVICE_TYPE && hasPabxExtensionDraft) {
      if (!pabxExtensionDraft.extension.trim() && !pabxExtensionDraft.login.trim() && !pabxExtensionDraft.collaborator.trim()) {
        alert('Informe pelo menos o ramal, o login ou o colaborador antes de salvar.');
        return false;
      }
      if (!DEPARTMENT_OPTIONS.includes(pabxExtensionDraft.department)) {
        alert('Selecione um departamento válido para o ramal.');
        return false;
      }
      deviceToSave = { ...deviceToSave, extensions: [{ id: makeId(), ...pabxExtensionDraft }, ...extensions] };
    }
    return onSave(deviceToSave);
  };

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
    if (isExistingDevice) return;
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

    setNasUserDraft(emptyNasUserDraft());
    setPabxExtensionDraft(emptyPabxExtensionDraft());
    setShowAccessList(false);
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
      wifiNetworks: nextDeviceType === DEVICE_TYPE_WIFI_CONTROLLER ? wifiNetworks : [],
      dvrAccess: nextDeviceType === 'DVR' ? dvrAccess : normalizeDvrAccess()
    });
  };

  const updateDvrAccess = (field, value) => {
    const nextValue = field === 'ip'
      ? sanitizeIpv4Input(value)
      : DVR_PORT_FIELDS.some(([portField]) => portField === field)
        ? sanitizePortInput(value)
        : value;
    setDevice({ ...device, dvrAccess: { ...dvrAccess, [field]: nextValue } });
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
    if (!pabxExtensionDraft.extension.trim() && !pabxExtensionDraft.login.trim() && !pabxExtensionDraft.collaborator.trim()) {
      alert('Informe pelo menos o ramal, o login ou o colaborador.');
      return;
    }
    if (!DEPARTMENT_OPTIONS.includes(pabxExtensionDraft.department)) {
      alert('Selecione um departamento válido.');
      return;
    }
    setDevice({
      ...device,
      extensions: [{ id: makeId(), ...pabxExtensionDraft }, ...extensions]
    });
    setPabxExtensionDraft(emptyPabxExtensionDraft());
  };

  const removeExtension = (extensionId) => {
    setDevice({ ...device, extensions: extensions.filter((extension) => extension.id !== extensionId) });
  };

  const updateNasAccess = (field, value) => {
    setDevice({ ...device, nasAccess: { ...nasAccess, [field]: value } });
  };

  const addNasUser = () => {
    if (!nasUserDraft.login.trim() && !nasUserDraft.collaborator.trim()) {
      alert('Informe pelo menos o login ou o colaborador.');
      return;
    }
    if (!DEPARTMENT_OPTIONS.includes(nasUserDraft.department)) {
      alert('Selecione um departamento válido.');
      return;
    }
    setDevice({
      ...device,
      nasUsers: [{ id: makeId(), ...nasUserDraft }, ...nasUsers]
    });
    setNasUserDraft(emptyNasUserDraft());
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
          <button type="button" onClick={requestClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className={device.deviceType === PABX_DEVICE_TYPE ? 'space-y-3 p-5' : 'space-y-6 p-6'}>
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${device.deviceType === PABX_DEVICE_TYPE ? 'gap-3' : 'gap-4'}`}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome do dispositivo</label>
              <input type="text" className="w-full rounded-md border border-slate-300 p-2 shadow-sm" value={device.name} onChange={(event) => setDevice({ ...device, name: event.target.value })} placeholder="Ex: DVR Loja" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo do dispositivo</label>
              <select disabled={isExistingDevice} title={isExistingDevice ? 'O tipo do dispositivo não pode ser alterado após o cadastro.' : 'Selecione o tipo do dispositivo'} className="w-full rounded-md border border-slate-300 bg-white p-2 shadow-sm disabled:cursor-not-allowed disabled:opacity-60" value={device.deviceType} onChange={(event) => handleDeviceTypeChange(event.target.value)}>
                {DEVICE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Observações</label>
              <textarea rows={3} className="h-[45px] min-h-[45px] max-h-[45px] w-full resize-none overflow-y-auto rounded-md border border-slate-300 p-2 shadow-sm" value={device.notes} onChange={(event) => setDevice({ ...device, notes: event.target.value })} placeholder="Observações sobre o dispositivo"></textarea>
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
                      <button type="button" title="Excluir rede Wi-Fi" aria-label="Excluir rede Wi-Fi" onClick={() => removeWifiNetwork(network.id)} className="action-icon-button action-icon-delete justify-self-end xl:mb-3"><Trash2 className="h-4 w-4" /></button>
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
                <div className="mb-2"><h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Usuários</h4><p className="text-xs text-slate-500 dark:text-slate-400">Usuários NAS: {nasUsers.length}</p></div>
                <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_minmax(0,1fr)_auto]">
                  <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Login</label><input type="text" autoComplete="off" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={nasUserDraft.login} onChange={(event) => setNasUserDraft({ ...nasUserDraft, login: event.target.value })} placeholder="Login" /></div>
                  <SecurePasswordInput name={`device_nas_user_draft_password_${device.id}`} label="Senha" value={nasUserDraft.password} onChange={(event) => setNasUserDraft({ ...nasUserDraft, password: event.target.value })} enableGenerator={false} autoComplete="new-password" />
                  <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Departamento</label><select className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={nasUserDraft.department} onChange={(event) => setNasUserDraft({ ...nasUserDraft, department: event.target.value })}>{DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}</select></div>
                  <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Colaborador</label><input type="text" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={nasUserDraft.collaborator} onChange={(event) => setNasUserDraft({ ...nasUserDraft, collaborator: event.target.value })} placeholder="Nome do colaborador" /></div>
                  <button type="button" onClick={addNasUser} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><Plus className="mr-2 h-4 w-4" /> Adicionar</button>
                </div>
                <button type="button" onClick={() => setShowAccessList(true)} className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Exibir lista de logins e usuários</button>
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
                    {(duplicateExtensions.size > 0 || duplicateLogins.size > 0) && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{duplicateExtensions.size > 0 && 'Ramal duplicado'}{duplicateExtensions.size > 0 && duplicateLogins.size > 0 && ' · '}{duplicateLogins.size > 0 && 'Login duplicado'}</p>}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Quantidade de ramal</label>
                      <input type="text" inputMode="numeric" maxLength={3} className="h-9 w-20 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={contractedExtensions} onChange={(event) => setDevice({ ...device, contractedExtensions: sanitizeContractedExtensions(event.target.value) })} placeholder="20" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-2 xl:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_150px_minmax(0,1fr)_auto]">
                  <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Ramal</label><input type="text" inputMode="numeric" className={`h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm shadow-sm dark:bg-slate-900 dark:text-slate-100 ${draftExtensionIsDuplicate ? 'border-amber-400 dark:border-amber-500' : 'border-slate-300 dark:border-slate-700'}`} value={pabxExtensionDraft.extension} onChange={(event) => setPabxExtensionDraft({ ...pabxExtensionDraft, extension: event.target.value })} placeholder="1001" />{draftExtensionIsDuplicate && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Ramal duplicado</p>}</div>
                  <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Login</label><input type="text" autoComplete="off" className={`h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm shadow-sm dark:bg-slate-900 dark:text-slate-100 ${draftLoginIsDuplicate ? 'border-amber-400 dark:border-amber-500' : 'border-slate-300 dark:border-slate-700'}`} value={pabxExtensionDraft.login} onChange={(event) => setPabxExtensionDraft({ ...pabxExtensionDraft, login: event.target.value })} placeholder="Login do ramal" />{draftLoginIsDuplicate && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Login duplicado</p>}</div>
                  <SecurePasswordInput name={`device_extension_draft_password_${device.id}`} label="Senha" value={pabxExtensionDraft.password} onChange={(event) => setPabxExtensionDraft({ ...pabxExtensionDraft, password: event.target.value })} enableGenerator={false} autoComplete="new-password" />
                  <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Departamento</label><select className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={pabxExtensionDraft.department} onChange={(event) => setPabxExtensionDraft({ ...pabxExtensionDraft, department: event.target.value })}>{DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}</select></div>
                  <div><label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Colaborador</label><input type="text" className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={pabxExtensionDraft.collaborator} onChange={(event) => setPabxExtensionDraft({ ...pabxExtensionDraft, collaborator: event.target.value })} placeholder="Nome do colaborador" /></div>
                  <button type="button" onClick={addExtension} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><Plus className="mr-2 h-4 w-4" /> Adicionar</button>
                </div>
                <button type="button" onClick={() => setShowAccessList(true)} className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Exibir lista de logins e usuários</button>
              </div>
            </>
          )}

          {['DVR', 'IMPRESSORA'].includes(device.deviceType) && (
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Logins e usuários</h4><p className="text-xs text-slate-500 dark:text-slate-400">Logins cadastrados: {linkedAccessItems.length}</p></div>
                <button type="button" onClick={() => setShowAccessList(true)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Exibir lista de logins e usuários</button>
              </div>
            </div>
          )}

          {device.deviceType === 'DVR' && (
            <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Acesso DVR</h4>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">IP</span>
                  <input type="text" inputMode="decimal" aria-label="IP do DVR" className={`h-[32px] w-[120px] rounded-md border bg-white px-2 text-[13px] shadow-sm outline-none dark:bg-slate-900 dark:text-slate-100 ${validateIpv4(dvrAccess.ip).state === 'invalid' ? 'border-red-400 dark:border-red-500' : 'border-slate-300 dark:border-slate-700'}`} value={dvrAccess.ip} onChange={(event) => updateDvrAccess('ip', event.target.value)} placeholder="192.168.1.10" />
                </label>
                {DVR_PORT_FIELDS.map(([field, label]) => {
                  const invalid = !isOptionalValidPort(dvrAccess[field]);
                  return <label key={field} className="block"><span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span><input type="text" inputMode="numeric" aria-label={label} className={`h-[32px] w-[77px] rounded-md border bg-white px-2 text-[13px] shadow-sm outline-none dark:bg-slate-900 dark:text-slate-100 ${invalid ? 'border-red-400 dark:border-red-500' : 'border-slate-300 dark:border-slate-700'}`} value={dvrAccess[field]} onChange={(event) => updateDvrAccess(field, event.target.value)} /></label>;
                })}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {[['deviceId', 'ID'], ['mac', 'MAC'], ['ddns', 'DDNS']].map(([field, label]) => <label key={field} className="block"><span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span><input type="text" aria-label={label} className="h-[32px] w-[250px] max-w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] shadow-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={dvrAccess[field]} onChange={(event) => updateDvrAccess(field, event.target.value)} /></label>)}
              </div>
            </section>
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
                    <button type="button" title="Excluir PPPoE" aria-label="Excluir PPPoE" onClick={() => removePppoeAccount(account.id)} className="action-icon-button action-icon-delete justify-self-end xl:mb-3 xl:justify-self-center"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {device.deviceType !== 'DVR' && <div className="border-t border-slate-200 pt-5">
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
                      <button type="button" title="Excluir conexão" aria-label="Excluir conexão" onClick={() => setDevice({ ...device, connections: connections.filter((item) => item.id !== connection.id) })} className="action-icon-button action-icon-delete justify-self-end md:justify-self-center"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>}

          {device.deviceType !== 'DVR' && <div className="border-t border-slate-200 pt-5">
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
                    <button type="button" title="Remover" aria-label="Remover" onClick={() => setDevice({ ...device, portRules: portRules.filter((item) => item.id !== rule.id) })} className="action-icon-button action-icon-delete justify-self-end"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>}

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
            <button type="button" onClick={requestClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="button" disabled={isSaving || hasInvalidConnections || hasInvalidPorts || hasInvalidDvrPorts} onClick={saveDeviceIncludingDrafts} className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
        {showAccessList && device.deviceType === DEVICE_TYPE_NAS_STORAGE && <DeviceAccessListModal device={device} items={nasUsers} kind="nasUser" onClose={() => setShowAccessList(false)} onRemove={removeNasUser} />}
        {showAccessList && device.deviceType === PABX_DEVICE_TYPE && <DeviceAccessListModal device={device} items={extensions} kind="pabxExtension" onClose={() => setShowAccessList(false)} onRemove={removeExtension} />}
        {showAccessList && ['DVR', 'IMPRESSORA'].includes(device.deviceType) && <DeviceAccessListModal device={device} items={linkedAccessItems} kind="generic" onClose={() => setShowAccessList(false)} onEdit={(item) => { setShowAccessList(false); onEditLinkedLogin?.(item); }} />}
        {showUnsavedDialog && <UnsavedChangesDialog isSaving={isSaving} onContinue={() => setShowUnsavedDialog(false)} onDiscard={onCancel} onSave={saveDeviceIncludingDrafts} />}
      </div>
    </div>
  );
}
