import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Cloud,
  Edit3,
  Eye,
  EyeOff,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  UploadCloud
} from 'lucide-react';
import api from '../services/api';
import SettingsAccordionCard from './SettingsAccordionCard';
import GoogleDriveProviderPanel from './GoogleDriveProviderPanel';
import {
  CloudStatusBadge,
  ConnectionTestModal,
  EndpointEditorModal,
  MonitoringModal
} from './CloudBackupModals';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';
import { safeLogError } from '../utils/safeLogger';
import {
  getCloudBackupPassphraseFieldValue,
  getCloudStatus,
  withCloudBackupPassphrase
} from '../utils/cloudBackupUiState';

const PROVIDERS = Object.freeze([
  ['google_drive', 'Google Drive'],
  ['backblaze_b2', 'Backblaze B2'],
  ['mega_s3', 'Mega S3'],
  ['ftp', 'FTP']
]);
const BACKBLAZE_REGIONS = Object.freeze([
  ['us-east-005', 'US East', 'https://s3.us-east-005.backblazeb2.com'],
  ['us-west-004', 'US West', 'https://s3.us-west-004.backblazeb2.com'],
  ['eu-central-003', 'EU Central', 'https://s3.eu-central-003.backblazeb2.com'],
  ['ca-east-005', 'CA East', 'https://s3.ca-east-005.backblazeb2.com']
]);
const MEGA_REGIONS = Object.freeze([
  ['eu-amsterdam', 'Europa - Amsterdam', 'https://s3.eu-amsterdam.megas4.com'],
  ['eu-luxembourg', 'Europa - Luxembourg', 'https://s3.eu-luxembourg.megas4.com'],
  ['eu-paris', 'Europa - Paris', 'https://s3.eu-paris.megas4.com'],
  ['eu-barcelona', 'Europa - Barcelona', 'https://s3.eu-barcelona.megas4.com'],
  ['ca-montreal', 'Canadá - Montreal', 'https://s3.ca-montreal.megas4.com'],
  ['ca-vancouver', 'Canadá - Vancouver', 'https://s3.ca-vancouver.megas4.com'],
  ['ap-tokyo', 'APAC - Tokyo', 'https://s3.ap-tokyo.megas4.com']
]);
const WEEKDAYS = Object.freeze([[0, 'Dom'], [1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']]);
const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const MASKED_SECRET = '••••••••••••••••';
const EMPTY_STATUS = Object.freeze({
  active_provider: 'none',
  enabled: false,
  schedule_enabled: false,
  schedule_days: [0, 1, 2, 3, 4, 5, 6],
  schedule_times: ['02:00'],
  retention_days: 30,
  backup_format: 'v2',
  failure_email_enabled: false,
  failure_email_recipients: [],
  failure_email_on_recovery: false,
  has_backup_passphrase: false,
  providers: {},
  recent_runs: [],
  recent_runs_pagination: {
    page: 1,
    page_size: 10,
    total: 0,
    total_pages: 0
  }
});

const findRegion = (provider, region) => {
  const regions = provider === 'backblaze_b2' ? BACKBLAZE_REGIONS : MEGA_REGIONS;
  return regions.find(([value]) => value === region);
};

const createProviderForm = (provider, config = {}) => {
  if (provider === 'ftp') {
    return {
      host: config.host || '',
      port: config.port || 21,
      username: '',
      password: '',
      remote_path: config.remote_path || '/fullpassword/backups',
      secure: config.secure === true
    };
  }
  const defaultRegion = provider === 'backblaze_b2' ? 'us-east-005' : 'eu-amsterdam';
  const region = config.region || defaultRegion;
  const knownRegion = findRegion(provider, region);
  return {
    endpoint: config.endpoint || knownRegion?.[2] || '',
    region,
    bucket: config.bucket || '',
    access_key: '',
    secret_key: '',
    prefix: config.prefix || 'fullpassword/backups/'
  };
};

const CompactField = ({ label, hint, children, className = '' }) => (
  <div className={className}>
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
    {children}
    {hint && <span className="mt-1 block truncate text-[11px] text-slate-500" title={hint}>{hint}</span>}
  </div>
);

const HeaderBadge = ({ activeProvider, providerConfigured, cloudStatus, enabled }) => {
  if (!activeProvider || activeProvider === 'none') {
    return <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">Inativo</span>;
  }
  if (!providerConfigured) {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Configuração pendente</span>;
  }
  if (cloudStatus === 'offline' || cloudStatus === 'permission_error') {
    return <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">Erro</span>;
  }
  if (cloudStatus === 'degraded') {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Instável</span>;
  }
  if (cloudStatus === 'online') {
    return <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">Online</span>;
  }
  return <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-700">{enabled ? 'Ativo' : 'Configurado'}</span>;
};

const ProviderSwitch = ({ provider, label, active, configured, failed, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={active}
    disabled={disabled}
    onClick={() => onChange(provider)}
    className={`flex min-w-[135px] flex-1 items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
      active ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`}
  >
    <span className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${failed ? 'bg-red-500' : active ? 'bg-indigo-600' : configured ? 'bg-green-500' : 'bg-slate-300'}`} />
      {label}
    </span>
    <span className={`relative h-4 w-7 rounded-full ${active ? 'bg-indigo-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-[13px]' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

const SecretField = ({ label, value, configured, editing, visible, onVisible, onChange, className = '' }) => (
  <CompactField label={label} className={className}>
    <span className="relative block">
      <input
        type={visible ? 'text' : 'password'}
        required={!configured}
        disabled={configured && !editing}
        autoComplete="new-password"
        className={`${fieldClass} pr-9`}
        value={value}
        placeholder={configured ? MASKED_SECRET : ''}
        onChange={onChange}
      />
      {editing && (
        <button type="button" onClick={onVisible} aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`} className="absolute inset-y-0 right-0 px-2.5 text-slate-500">
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
    </span>
  </CompactField>
);

const CollapsibleSection = ({ title, description, children }) => (
  <details className="group rounded-lg border border-slate-200 bg-white">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
      <span>
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
      <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-slate-200 p-4">{children}</div>
  </details>
);

export default function CloudBackupCard({ isSuperAdmin }) {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [smtpStatus, setSmtpStatus] = useState({ enabled: false, loaded: false });
  const [providerForm, setProviderForm] = useState(createProviderForm('backblaze_b2'));
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [isEditingBackupPassphrase, setIsEditingBackupPassphrase] = useState(false);
  const [failureEmailRecipients, setFailureEmailRecipients] = useState('');
  const [communication, setCommunication] = useState(null);
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const [googleExpanded, setGoogleExpanded] = useState(false);
  const [endpointModalOpen, setEndpointModalOpen] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [monitorModalOpen, setMonitorModalOpen] = useState(false);
  const [providerChangeLoading, setProviderChangeLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const providerChangeLockRef = useRef(false);
  const lastProviderChangeAtRef = useRef(0);

  useClearOnVaultLock(() => {
    setBackupPassphrase('');
    setIsEditingBackupPassphrase(false);
    setProviderForm((current) => ({ ...current, access_key: '', secret_key: '', username: '', password: '' }));
    setSecretVisible(false);
  });

  const loadStatus = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const [cloudResponse, smtpResponse] = await Promise.all([
        api.get('/cloud-backup/status'),
        api.get('/system/smtp').catch(() => ({ data: { enabled: false } }))
      ]);
      const data = cloudResponse.data;
      setStatus({ ...EMPTY_STATUS, ...data });
      setBackupPassphrase('');
      setIsEditingBackupPassphrase(false);
      setSmtpStatus({ ...smtpResponse.data, loaded: true });
      const recipients = data.failure_email_recipients?.length
        ? data.failure_email_recipients
        : data.suggested_failure_email ? [data.suggested_failure_email] : [];
      setFailureEmailRecipients(recipients.join(', '));
      if (!['none', 'google_drive'].includes(data.active_provider)) {
        setProviderForm(createProviderForm(data.active_provider, data.providers?.[data.active_provider]?.public_config));
      }
      setEditingCredentials(false);
      setSecretVisible(false);
      setProviderDirty(false);
    } catch (error) {
      safeLogError('Falha sanitizada ao carregar Backup Nuvem.', error);
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível carregar o Backup Nuvem.' });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  const loadHistory = useCallback(async (page) => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get('/cloud-backup/runs', {
        params: { page, page_size: 10 }
      });
      setStatus((current) => ({
        ...current,
        recent_runs: data.items || [],
        recent_runs_pagination: data.pagination || EMPTY_STATUS.recent_runs_pagination
      }));
    } catch (error) {
      safeLogError('Falha sanitizada ao carregar histórico do Backup Nuvem.', error);
      setFeedback({
        type: 'error',
        text: error.response?.data?.error || 'Não foi possível carregar o histórico do Backup Nuvem.'
      });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadStatus, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  const perform = async (name, operation, successMessage) => {
    setBusy(name);
    setFeedback({ type: '', text: '' });
    try {
      const response = await operation();
      setFeedback({ type: 'success', text: successMessage });
      await loadStatus();
      return response;
    } catch (error) {
      safeLogError('Falha sanitizada na ação de Backup Nuvem.', error);
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível concluir a operação.' });
      return null;
    } finally {
      setBusy('');
    }
  };

  const updateProviderForm = (values) => {
    setProviderForm((current) => ({ ...current, ...values }));
    setProviderDirty(true);
  };

  const selectProvider = async (provider) => {
    const now = Date.now();
    if (
      providerChangeLockRef.current
      || providerChangeLoading
      || Boolean(busy)
      || now - lastProviderChangeAtRef.current < 500
    ) return;
    const targetProvider = provider === status.active_provider ? 'none' : provider;
    if (
      targetProvider !== 'none'
      && status.active_provider !== 'none'
      && !window.confirm('Ao ativar este provedor, os próximos backups serão enviados somente por ele. As credenciais atuais serão preservadas. Deseja continuar?')
    ) return;
    providerChangeLockRef.current = true;
    lastProviderChangeAtRef.current = now;
    setProviderChangeLoading(true);
    setCommunication(null);
    setGoogleExpanded(false);
    try {
      await perform(
        'provider-change',
        () => api.put('/cloud-backup/provider', { provider: targetProvider }),
        targetProvider === 'none' ? 'Backup Nuvem desativado. As credenciais foram preservadas.' : 'Provedor ativo alterado.'
      );
    } finally {
      providerChangeLockRef.current = false;
      setProviderChangeLoading(false);
    }
  };

  const saveProvider = async () => {
    if (
      (providerDirty || status.providers?.[status.active_provider]?.last_test_status !== 'success')
      && !window.confirm('A conexão ainda não foi testada com sucesso. Deseja salvar mesmo assim?')
    ) return;
    const response = await perform('provider-save', () => api.put('/cloud-backup/provider', {
      provider: status.active_provider,
      config: providerForm
    }), 'Configuração do provedor salva com segurança.');
    if (response) {
      setEditingCredentials(false);
      setSecretVisible(false);
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const payload = withCloudBackupPassphrase({
      enabled: status.active_provider === 'none' ? false : status.enabled,
      schedule_enabled: status.active_provider === 'none' ? false : status.schedule_enabled,
      schedule_days: status.schedule_days,
      schedule_times: status.schedule_times,
      retention_days: Number(status.retention_days),
      backup_format: status.backup_format || 'v2',
      failure_email_enabled: status.failure_email_enabled,
      failure_email_recipients: failureEmailRecipients.split(',').map((email) => email.trim()).filter(Boolean),
      failure_email_on_recovery: status.failure_email_on_recovery
    }, {
      isEditing: isEditingBackupPassphrase || !status.has_backup_passphrase,
      value: backupPassphrase
    });
    const response = await perform(
      'settings-save',
      () => api.put('/cloud-backup/settings', payload),
      'Configurações do Backup Nuvem salvas.'
    );
    if (response) {
      setBackupPassphrase('');
      setIsEditingBackupPassphrase(false);
    }
  };

  const editBackupPassphrase = () => {
    setBackupPassphrase('');
    setIsEditingBackupPassphrase(true);
  };

  const cancelBackupPassphraseEdit = () => {
    setBackupPassphrase('');
    setIsEditingBackupPassphrase(false);
  };

  const removeProvider = () => {
    if (status.active_provider === 'none') return;
    if (!window.confirm('Limpar a configuração do provedor ativo? Os backups remotos serão preservados.')) return;
    perform('provider-remove', () => api.post('/cloud-backup/disconnect', { provider: status.active_provider }), 'Configuração do provedor removida.');
  };

  const runProviderTest = async () => {
    const startedAt = window.performance.now();
    setBusy('provider-test');
    setCommunication({ state: 'testing', tested_at: new Date().toISOString() });
    setFeedback({ type: '', text: '' });
    try {
      const { data } = await api.post('/cloud-backup/test');
      setCommunication({
        state: 'success',
        latency_ms: Math.round(window.performance.now() - startedAt),
        message: data.message || 'Comunicação validada.',
        stage: 'connection_test',
        tested_at: new Date().toISOString()
      });
      setFeedback({ type: 'success', text: 'Comunicação com o provedor validada.' });
    } catch (error) {
      safeLogError('Falha sanitizada no teste de Backup Nuvem.', error);
      const code = String(error.response?.data?.code || 'connection_test');
      setCommunication({
        state: 'failed',
        latency_ms: Math.round(window.performance.now() - startedAt),
        message: error.response?.data?.error || 'Não foi possível validar o destino remoto.',
        stage: code,
        tested_at: new Date().toISOString()
      });
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível validar o provedor.' });
    } finally {
      setBusy('');
    }
  };

  const openAndTestProvider = () => {
    setTestModalOpen(true);
    runProviderTest();
  };

  const toggleDay = (day) => {
    const selected = status.schedule_days.includes(day);
    const days = selected ? status.schedule_days.filter((item) => item !== day) : [...status.schedule_days, day].sort();
    if (days.length) setStatus((current) => ({ ...current, schedule_days: days }));
  };

  const setExecutionCount = (count) => {
    const defaults = ['02:00', '10:00', '18:00'];
    setStatus((current) => ({ ...current, schedule_times: Array.from({ length: count }, (_, index) => current.schedule_times[index] || defaults[index]) }));
  };

  const changeRegion = (provider, region) => {
    const known = findRegion(provider, region);
    updateProviderForm({
      region,
      endpoint: known?.[2] || providerForm.endpoint
    });
  };

  const activeProvider = status.providers?.[status.active_provider];
  const providerConfigured = activeProvider?.configured === true;
  const activeLabel = PROVIDERS.find(([provider]) => provider === status.active_provider)?.[1] || 'Nenhum';
  const cloudStatus = getCloudStatus({ busy, communication, providerStatus: activeProvider, configured: providerConfigured });
  const activationDisabled = !providerConfigured || (!status.has_backup_passphrase && backupPassphrase.length < 16);
  const backupPassphraseFieldValue = getCloudBackupPassphraseFieldValue({
    hasBackupPassphrase: status.has_backup_passphrase,
    isEditing: isEditingBackupPassphrase,
    value: backupPassphrase
  });
  const regionOptions = status.active_provider === 'backblaze_b2' ? BACKBLAZE_REGIONS : MEGA_REGIONS;
  const safeTarget = {
    endpointHost: activeProvider?.public_config?.endpoint || activeProvider?.public_config?.host || null,
    bucketFolder: activeProvider?.public_config?.bucket || activeProvider?.public_config?.remote_path || activeProvider?.drive_folder_name || null,
    region: activeProvider?.public_config?.region || null
  };
  const headerAction = status.active_provider !== 'none' ? (
    <button type="button" onClick={removeProvider} disabled={Boolean(busy)} title="Limpar configuração do provedor ativo" className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
      <Trash2 className="h-4 w-4" />
    </button>
  ) : null;

  if (!isSuperAdmin) return null;

  return (
    <SettingsAccordionCard
      id="cloud-backup"
      title="Backup Nuvem"
      icon={<Cloud className="mr-2 h-5 w-5 text-indigo-500" />}
      badge={<HeaderBadge activeProvider={status.active_provider} providerConfigured={providerConfigured} cloudStatus={cloudStatus} enabled={status.enabled} />}
      headerAction={headerAction}
    >
      {loading ? <p className="text-sm text-slate-500">Carregando Backup Nuvem...</p> : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Configure um destino remoto para armazenar backups criptografados do FullPassword.</p>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {PROVIDERS.map(([provider, label]) => {
              const providerStatus = status.providers?.[provider];
              return <ProviderSwitch key={provider} provider={provider} label={label} active={status.active_provider === provider} configured={providerStatus?.configured === true} failed={providerStatus?.last_test_status === 'failed'} disabled={providerChangeLoading || Boolean(busy)} onChange={selectProvider} />;
            })}
          </div>

          {feedback.text && <div className={`rounded-md border px-3 py-2 text-sm ${feedback.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{feedback.text}</div>}

          {status.active_provider === 'none' ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center">
              <Cloud className="mx-auto h-7 w-7 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-800">Nenhum provedor de backup em nuvem ativo.</p>
              <p className="mt-1 text-xs text-slate-500">Ative um provedor acima para configurar o armazenamento remoto.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2">
                  <strong className="text-sm text-slate-900">{activeLabel}</strong>
                  <CloudStatusBadge status={cloudStatus} />
                </div>
                <span className="text-[11px] text-slate-500">Somente este provedor recebe novas execuções.</span>
              </div>

              <div className="divide-y divide-slate-200 px-4">
                <div data-cloud-row="service-endpoint" className="grid grid-cols-1 gap-3 py-3 md:grid-cols-12">
                  <CompactField label="Serviço" className="md:col-span-3"><div className={`${fieldClass} bg-slate-50 font-medium`}>{status.active_provider === 'ftp' ? 'FTP / FTPS' : activeLabel}</div></CompactField>
                  {status.active_provider === 'google_drive' ? (
                    <>
                      <CompactField label="Conta Google" className="md:col-span-4"><div className={`${fieldClass} truncate bg-slate-50`}>{activeProvider?.google_email || 'Não conectado'}</div></CompactField>
                      <CompactField label="Pasta" className="md:col-span-4"><div className={`${fieldClass} truncate bg-slate-50`}>{activeProvider?.drive_folder_name || 'FullPassword Backups'}</div></CompactField>
                      <div className="flex items-end md:col-span-1"><button type="button" onClick={() => setGoogleExpanded((current) => !current)} title="Configurar OAuth" className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"><Edit3 className="h-4 w-4" /></button></div>
                    </>
                  ) : status.active_provider === 'ftp' ? (
                    <>
                      <CompactField label="Host" className="md:col-span-4"><input className={fieldClass} value={providerForm.host || ''} onChange={(event) => updateProviderForm({ host: event.target.value })} /></CompactField>
                      <CompactField label="Porta" className="md:col-span-2"><input type="number" min="1" max="65535" className={fieldClass} value={providerForm.port || 21} onChange={(event) => updateProviderForm({ port: Number(event.target.value) })} /></CompactField>
                      <label className="flex items-end gap-2 pb-2 text-xs md:col-span-2"><input type="checkbox" checked={providerForm.secure === true} onChange={(event) => updateProviderForm({ secure: event.target.checked })} /> FTPS</label>
                      <div className="flex items-end md:col-span-1"><button type="button" onClick={() => setEndpointModalOpen(true)} title="Editar host avançado" className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"><Edit3 className="h-4 w-4" /></button></div>
                    </>
                  ) : (
                    <>
                      <CompactField label="Região" className="md:col-span-3">
                        <select className={fieldClass} value={findRegion(status.active_provider, providerForm.region) ? providerForm.region : 'custom'} onChange={(event) => changeRegion(status.active_provider, event.target.value)}>
                          {regionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          <option value="custom">Personalizado</option>
                        </select>
                      </CompactField>
                      <CompactField label="Endpoint S3" hint={status.active_provider === 'backblaze_b2' ? 'Use o endpoint S3 informado no painel do bucket Backblaze B2.' : 'Use o endpoint informado no painel Mega Object Storage / S4.'} className="md:col-span-5">
                        <div className="flex gap-2"><input readOnly className={`${fieldClass} truncate bg-slate-50 font-mono text-xs`} value={providerForm.endpoint || ''} /><button type="button" onClick={() => setEndpointModalOpen(true)} title="Editar endpoint" className="rounded-md border border-slate-300 px-2.5 text-slate-600 hover:bg-slate-50"><Edit3 className="h-4 w-4" /></button></div>
                      </CompactField>
                      <div className="hidden md:col-span-1 md:block" />
                    </>
                  )}
                </div>

                <div data-cloud-row="credentials" className="grid grid-cols-1 gap-3 py-3 md:grid-cols-12">
                  {status.active_provider === 'google_drive' ? (
                    <>
                      <CompactField label="OAuth" className="md:col-span-4"><div className={`${fieldClass} bg-slate-50`}>{activeProvider?.oauth_configured ? 'OAuth configurado' : 'OAuth pendente'}</div></CompactField>
                      <CompactField label="Conexão" className="md:col-span-4"><div className={`${fieldClass} bg-slate-50`}>{activeProvider?.connected ? 'Conta conectada' : 'Não conectado'}</div></CompactField>
                      <div className="flex items-end md:col-span-4"><button type="button" onClick={() => setGoogleExpanded((current) => !current)} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700">{googleExpanded ? 'Ocultar configuração OAuth' : 'Configurar OAuth / Conta'}</button></div>
                    </>
                  ) : (
                    <>
                      <CompactField label={status.active_provider === 'ftp' ? 'Usuário' : status.active_provider === 'backblaze_b2' ? 'Access Key / Key ID' : 'Access Key'} className="md:col-span-5">
                        <input
                          required={!providerConfigured}
                          disabled={providerConfigured && !editingCredentials}
                          autoComplete="off"
                          className={fieldClass}
                          value={status.active_provider === 'ftp' ? providerForm.username || '' : providerForm.access_key || ''}
                          placeholder={providerConfigured ? activeProvider?.credential_hint || 'Credencial salva' : ''}
                          onChange={(event) => updateProviderForm(status.active_provider === 'ftp' ? { username: event.target.value } : { access_key: event.target.value })}
                        />
                      </CompactField>
                      <SecretField
                        label={status.active_provider === 'ftp' ? 'Senha' : status.active_provider === 'backblaze_b2' ? 'Secret Key / Application Key' : 'Secret Key'}
                        value={status.active_provider === 'ftp' ? providerForm.password || '' : providerForm.secret_key || ''}
                        configured={providerConfigured}
                        editing={editingCredentials}
                        visible={secretVisible}
                        onVisible={() => setSecretVisible((current) => !current)}
                        onChange={(event) => updateProviderForm(status.active_provider === 'ftp' ? { password: event.target.value } : { secret_key: event.target.value })}
                        className="md:col-span-5"
                      />
                      <div className="flex items-end md:col-span-2">
                        <button type="button" onClick={() => { setEditingCredentials(true); setSecretVisible(false); updateProviderForm(status.active_provider === 'ftp' ? { password: '' } : { secret_key: '' }); }} className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Alterar</button>
                      </div>
                    </>
                  )}
                </div>

                <div data-cloud-row="destination-test" className="grid grid-cols-1 gap-3 py-3 md:grid-cols-12">
                  {status.active_provider === 'google_drive' ? (
                    <>
                      <CompactField label="Pasta destino" className="md:col-span-5"><div className={`${fieldClass} bg-slate-50`}>{activeProvider?.drive_folder_name || 'FullPassword Backups'}</div></CompactField>
                      <CompactField label="Escopo" className="md:col-span-4"><div className={`${fieldClass} bg-slate-50`}>drive.file</div></CompactField>
                    </>
                  ) : status.active_provider === 'ftp' ? (
                    <>
                      <CompactField label="Pasta remota" className="md:col-span-6"><input className={fieldClass} value={providerForm.remote_path || ''} onChange={(event) => updateProviderForm({ remote_path: event.target.value })} /></CompactField>
                      <CompactField label="Formato" className="md:col-span-3"><div className={`${fieldClass} bg-slate-50`}>Backup {String(status.backup_format || 'v2').toUpperCase()}</div></CompactField>
                    </>
                  ) : (
                    <>
                      <CompactField label="Bucket" className="md:col-span-5"><input className={fieldClass} value={providerForm.bucket || ''} onChange={(event) => updateProviderForm({ bucket: event.target.value })} /></CompactField>
                      <CompactField label="Prefixo" className="md:col-span-4"><input className={fieldClass} value={providerForm.prefix || ''} onChange={(event) => updateProviderForm({ prefix: event.target.value })} /></CompactField>
                    </>
                  )}
                  <div className="flex items-end md:col-span-3">
                    <button type="button" onClick={openAndTestProvider} disabled={!providerConfigured || Boolean(busy)} className="inline-flex w-full items-center justify-center rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 disabled:opacity-50"><RefreshCw className={`mr-2 h-4 w-4 ${busy === 'provider-test' ? 'animate-spin' : ''}`} /> Testar</button>
                  </div>
                </div>

                <div data-cloud-row="monitoring-status" className="py-3">
                  <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-5">
                    <CompactField label="Monitoramento Automático"><CloudStatusBadge status={cloudStatus} /></CompactField>
                    <CompactField label="Latência"><strong className="text-sm text-slate-800">{communication?.latency_ms ? `${communication.latency_ms}ms` : '-'}</strong></CompactField>
                    <CompactField label="Média"><strong className="text-sm text-slate-800">{communication?.latency_ms ? `${communication.latency_ms}ms` : '-'}</strong></CompactField>
                    <CompactField label="Último check"><strong className="text-xs text-slate-800">{formatDateTimeShort(communication?.tested_at || activeProvider?.last_test_at)}</strong></CompactField>
                    <button type="button" onClick={() => setMonitorModalOpen(true)} title="Abrir monitoramento completo" className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><Activity className="mr-2 h-4 w-4" /> Detalhes</button>
                  </div>
                </div>
              </div>

              {status.active_provider === 'ftp' && !providerForm.secure && <p className="mx-4 mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">FTP puro não criptografa o tráfego. Use FTPS sempre que o servidor permitir.</p>}
              {status.active_provider === 'google_drive' && googleExpanded && <div className="border-t border-slate-200 bg-slate-50 p-4"><GoogleDriveProviderPanel providerStatus={activeProvider} onChanged={loadStatus} busy={busy} setBusy={setBusy} setFeedback={setFeedback} /></div>}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex gap-2">
                  <button type="button" onClick={loadStatus} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-50"><RotateCcw className="mr-2 h-4 w-4" /> Cancelar</button>
                  {providerConfigured && <button type="button" onClick={removeProvider} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-xs text-red-700 disabled:opacity-50"><Trash2 className="mr-2 h-4 w-4" /> Limpar</button>}
                </div>
                {status.active_provider === 'google_drive' ? (
                  <button type="button" onClick={() => setGoogleExpanded(true)} className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white">Configurar Google Drive</button>
                ) : (
                  <button type="button" onClick={saveProvider} disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar</button>
                )}
              </div>
            </div>
          )}

          <form onSubmit={saveSettings} className="space-y-3">
            <CollapsibleSection title="Configuração do backup" description="Formato, agendamento, retenção e frase de criptografia.">
              <fieldset disabled={status.active_provider === 'none'} className="space-y-4 disabled:opacity-60">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.active_provider !== 'none' && status.enabled} disabled={activationDisabled} onChange={(event) => setStatus((current) => ({ ...current, enabled: event.target.checked }))} /> Backup Nuvem ativo</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.active_provider !== 'none' && status.schedule_enabled} disabled={activationDisabled} onChange={(event) => setStatus((current) => ({ ...current, schedule_enabled: event.target.checked }))} /> Agendamento ativo</label>
                  <CompactField label="Tipo de backup" hint="Backup V2 é o formato recomendado. Use V1 apenas por compatibilidade com processos antigos de restauração.">
                    <select
                      value={status.backup_format || 'v2'}
                      onChange={(event) => setStatus((current) => ({ ...current, backup_format: event.target.value }))}
                      className={fieldClass}
                    >
                      <option value="v2">Backup V2 — recomendado</option>
                      <option value="v1">Backup V1 — compatibilidade</option>
                    </select>
                  </CompactField>
                  <CompactField label="Retenção"><select value={status.retention_days} disabled={!providerConfigured || Boolean(busy)} onChange={(event) => setStatus((current) => ({ ...current, retention_days: Number(event.target.value) }))} className={fieldClass}>{[7, 15, 30, 60].map((days) => <option key={days} value={days}>{days} dias</option>)}</select></CompactField>
                </div>
                <div>
                  <span className="mb-2 block text-xs font-medium">Dias da semana</span>
                  <div className="flex flex-wrap gap-2">{WEEKDAYS.map(([day, label]) => <label key={day} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs"><input type="checkbox" checked={status.schedule_days.includes(day)} onChange={() => toggleDay(day)} /> {label}</label>)}</div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <CompactField label="Execuções por dia"><select value={status.schedule_times.length} onChange={(event) => setExecutionCount(Number(event.target.value))} className={fieldClass}><option value={1}>1 vez</option><option value={2}>2 vezes</option><option value={3}>3 vezes</option></select></CompactField>
                  {status.schedule_times.map((time, index) => <CompactField key={index} label={`Horário ${index + 1}`}><input type="time" value={time} onChange={(event) => setStatus((current) => ({ ...current, schedule_times: current.schedule_times.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} className={fieldClass} /></CompactField>)}
                </div>
                <CompactField label="Frase de criptografia do backup" hint="Guarde essa frase em local seguro. Sem ela, o backup não poderá ser restaurado.">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="password"
                      minLength={16}
                      autoComplete="new-password"
                      value={backupPassphraseFieldValue}
                      readOnly={status.has_backup_passphrase && !isEditingBackupPassphrase}
                      disabled={!providerConfigured || Boolean(busy)}
                      onChange={(event) => setBackupPassphrase(event.target.value)}
                      placeholder="Informe a frase de criptografia"
                      aria-label="Frase de criptografia do backup"
                      className={`${fieldClass} sm:flex-1`}
                    />
                    {status.has_backup_passphrase && (
                      isEditingBackupPassphrase ? (
                        <button type="button" onClick={cancelBackupPassphraseEdit} disabled={Boolean(busy)} className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50">
                          Cancelar alteração
                        </button>
                      ) : (
                        <button type="button" onClick={editBackupPassphrase} disabled={!providerConfigured || Boolean(busy)} className="whitespace-nowrap rounded-md border border-indigo-300 px-3 py-2 text-xs font-medium text-indigo-700 disabled:opacity-50">
                          Alterar frase
                        </button>
                      )
                    )}
                  </div>
                </CompactField>
                <button type="button" onClick={() => { const formatLabel = String(status.backup_format || 'v2').toUpperCase(); if (window.confirm(`Executar agora um Backup ${formatLabel} criptografado no provedor ativo?`)) perform('backup-run', () => api.post('/cloud-backup/run'), `Backup ${formatLabel} enviado ao provedor ativo.`); }} disabled={!providerConfigured || !status.has_backup_passphrase || Boolean(busy)} className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><UploadCloud className="mr-2 h-4 w-4" /> Executar backup agora</button>
              </fieldset>
            </CollapsibleSection>

            <CollapsibleSection title="Notificações por e-mail" description="Alertas de falha enviados pelo SMTP existente.">
              {!smtpStatus.enabled && <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Configure o servidor de e-mail antes de ativar notificações.</p>}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.failure_email_enabled} disabled={!smtpStatus.enabled && !status.failure_email_enabled} onChange={(event) => setStatus((current) => ({ ...current, failure_email_enabled: event.target.checked }))} /> Enviar e-mail em caso de falha no backup</label>
                <CompactField label="Destinatários" hint="Até 10 endereços separados por vírgula."><input type="text" className={fieldClass} value={failureEmailRecipients} disabled={!status.failure_email_enabled} placeholder="admin@example.com, suporte@example.com" onChange={(event) => setFailureEmailRecipients(event.target.value)} /></CompactField>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.failure_email_on_recovery} disabled={!status.failure_email_enabled} onChange={(event) => setStatus((current) => ({ ...current, failure_email_on_recovery: event.target.checked }))} /> Enviar também quando o backup voltar a funcionar</label>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Histórico de backups" description="Últimas execuções registradas.">
              <div className="space-y-2">
                {historyLoading ? <p className="text-sm text-slate-500">Carregando histórico...</p> : !status.recent_runs?.length ? <p className="text-sm text-slate-500">Nenhuma execução registrada.</p> : status.recent_runs.map((run) => (
                  <div key={run.id} className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-3 text-xs sm:grid-cols-5">
                    <span>{formatDateTimeShort(run.started_at)}</span>
                    <span>{PROVIDERS.find(([value]) => value === run.provider)?.[1] || run.provider}</span>
                    <span><span className="rounded-full bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">{String(run.backup_format || 'v2').toUpperCase()}</span></span>
                    <span>{run.trigger_type} · {run.status}</span>
                    <span className="truncate" title={run.file_name || run.error_message || '-'}>{run.file_name || run.error_message || '-'}</span>
                  </div>
                ))}
                {status.recent_runs_pagination.total > 0 && <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => loadHistory(status.recent_runs_pagination.page - 1)}
                    disabled={historyLoading || status.recent_runs_pagination.page <= 1}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-slate-500">
                    Página {status.recent_runs_pagination.page} de {Math.max(status.recent_runs_pagination.total_pages, 1)}
                  </span>
                  <button
                    type="button"
                    onClick={() => loadHistory(status.recent_runs_pagination.page + 1)}
                    disabled={historyLoading || status.recent_runs_pagination.page >= status.recent_runs_pagination.total_pages}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>}
              </div>
            </CollapsibleSection>

            <button type="submit" disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar configurações comuns</button>
          </form>

          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">O backup local/manual permanece disponível. Desligar um provedor não remove credenciais nem arquivos remotos.</p>

          {endpointModalOpen && <EndpointEditorModal open provider={status.active_provider} providerLabel={activeLabel} form={providerForm} onConfirm={(nextForm) => updateProviderForm(nextForm)} onClose={() => setEndpointModalOpen(false)} />}
          <ConnectionTestModal open={testModalOpen} provider={status.active_provider} providerLabel={activeLabel} providerStatus={activeProvider} communication={communication} busy={busy} safeTarget={safeTarget} onTest={runProviderTest} onClose={() => setTestModalOpen(false)} />
          <MonitoringModal open={monitorModalOpen} providerLabel={activeLabel} providerStatus={activeProvider} communication={communication} busy={busy} onRun={runProviderTest} onClose={() => setMonitorModalOpen(false)} />
        </div>
      )}
    </SettingsAccordionCard>
  );
}
