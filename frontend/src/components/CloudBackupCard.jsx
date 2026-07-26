import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Mail,
  RefreshCw,
  Save,
  Server,
  Trash2,
  UploadCloud
} from 'lucide-react';
import api from '../services/api';
import SettingsAccordionCard from './SettingsAccordionCard';
import GoogleDriveProviderPanel from './GoogleDriveProviderPanel';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';
import { safeLogError } from '../utils/safeLogger';

const PROVIDERS = Object.freeze([
  ['google_drive', 'Google Drive'],
  ['backblaze_b2', 'Backblaze B2'],
  ['mega_s3', 'Mega S3'],
  ['ftp', 'FTP']
]);
const BACKBLAZE_REGIONS = Object.freeze({
  'us-east-005': 'https://s3.us-east-005.backblazeb2.com',
  'us-west-004': 'https://s3.us-west-004.backblazeb2.com',
  'eu-central-003': 'https://s3.eu-central-003.backblazeb2.com',
  'ca-east-005': 'https://s3.ca-east-005.backblazeb2.com'
});
const WEEKDAYS = Object.freeze([[0, 'Dom'], [1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']]);
const fieldClass = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const MASKED_SECRET = '••••••••••••••••';
const EMPTY_STATUS = Object.freeze({
  active_provider: 'none',
  enabled: false,
  schedule_enabled: false,
  schedule_days: [0, 1, 2, 3, 4, 5, 6],
  schedule_times: ['02:00'],
  retention_days: 30,
  failure_email_enabled: false,
  failure_email_recipients: [],
  failure_email_on_recovery: false,
  has_backup_passphrase: false,
  providers: {},
  recent_runs: []
});

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
  const defaultBackblazeRegion = provider === 'backblaze_b2' && !config.region ? 'us-east-005' : config.region;
  const knownBackblazeRegion = provider === 'backblaze_b2' && Boolean(BACKBLAZE_REGIONS[defaultBackblazeRegion]);
  return {
    endpoint: config.endpoint || (knownBackblazeRegion ? BACKBLAZE_REGIONS[defaultBackblazeRegion] : ''),
    region: defaultBackblazeRegion || '',
    bucket: config.bucket || '',
    access_key: '',
    secret_key: '',
    prefix: config.prefix || 'fullpassword/backups/',
    edit_endpoint: provider === 'mega_s3' ? true : Boolean(config.endpoint && !knownBackblazeRegion)
  };
};

const SectionCard = ({ icon, title, description, children, className = '' }) => (
  <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
    <div className="mb-4 flex items-start gap-3">
      <span className="rounded-md bg-indigo-50 p-2 text-indigo-600">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
    </div>
    {children}
  </section>
);

const ProviderSwitch = ({ provider, label, active, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={active}
    disabled={disabled}
    onClick={() => onChange(provider)}
    className={`flex min-w-36 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
      active ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`}
  >
    {label}
    <span className={`relative h-5 w-9 rounded-full ${active ? 'bg-indigo-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

const SecretInput = ({ label, value, onChange, configured, placeholder = MASKED_SECRET }) => {
  const [visible, setVisible] = useState(false);
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <span className="relative block">
        <input
          type={visible ? 'text' : 'password'}
          required={!configured}
          autoComplete="new-password"
          className={`${fieldClass} w-full pr-10`}
          value={value}
          placeholder={configured ? placeholder : ''}
          onChange={onChange}
        />
        <button
          type="button"
          aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-slate-700"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
      {configured && <span className="mt-1 block text-xs text-slate-500">Deixe em branco para manter o segredo salvo.</span>}
    </label>
  );
};

const S3ProviderForm = ({
  provider,
  form,
  setForm,
  configured,
  credentialHint,
  busy,
  onSubmit,
  onRemove
}) => {
  const backblaze = provider === 'backblaze_b2';
  const selectBackblazeRegion = (region) => {
    setForm((current) => ({
      ...current,
      region: region === 'custom' ? '' : region,
      endpoint: region === 'custom' ? '' : BACKBLAZE_REGIONS[region],
      edit_endpoint: region === 'custom'
    }));
  };
  const regionSelection = backblaze
    ? (BACKBLAZE_REGIONS[form.region] ? form.region : 'custom')
    : form.region;

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <SectionCard
        icon={<Server className="h-4 w-4" />}
        title="Região e Endpoint"
        description={backblaze ? 'Selecione a região do bucket ou informe um endpoint personalizado.' : 'Use os dados do painel Mega Object Storage / S4.'}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Região</span>
            {backblaze ? (
              <select className={`${fieldClass} w-full`} value={regionSelection} onChange={(event) => selectBackblazeRegion(event.target.value)}>
                {Object.keys(BACKBLAZE_REGIONS).map((region) => <option key={region} value={region}>{region}</option>)}
                <option value="custom">Personalizada</option>
              </select>
            ) : (
              <input required className={`${fieldClass} w-full`} value={form.region} placeholder="eu-central-1" onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} />
            )}
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-slate-700">Endpoint S3</span>
            <input
              type="url"
              required
              disabled={!form.edit_endpoint && (backblaze || !form.endpoint)}
              className={`${fieldClass} w-full`}
              value={form.endpoint}
              placeholder={backblaze ? 'https://s3.regiao.backblazeb2.com' : 'https://s3.eu-central-1.s4.mega.io'}
              onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.edit_endpoint === true} onChange={(event) => setForm((current) => ({ ...current, edit_endpoint: event.target.checked }))} />
            Editar endpoint manualmente
          </label>
        </div>
      </SectionCard>

      <SectionCard icon={<KeyRound className="h-4 w-4" />} title="Credenciais" description="Os segredos são criptografados no servidor e não voltam a ser exibidos.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">{backblaze ? 'Key ID / Access Key' : 'Access Key'}</span>
            <input
              required={!configured}
              autoComplete="off"
              className={`${fieldClass} w-full`}
              value={form.access_key}
              placeholder={configured ? credentialHint || 'Credencial salva' : ''}
              onChange={(event) => setForm((current) => ({ ...current, access_key: event.target.value }))}
            />
          </label>
          <SecretInput
            label={backblaze ? 'Application Key / Secret Key' : 'Secret Key'}
            value={form.secret_key}
            configured={configured}
            onChange={(event) => setForm((current) => ({ ...current, secret_key: event.target.value }))}
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={<FolderOpen className="h-4 w-4" />}
        title="Destino de armazenamento"
        description={backblaze ? 'Use um bucket privado no Backblaze B2.' : 'Use o bucket indicado no painel Mega Object Storage / S4.'}
        className="xl:col-span-2"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Bucket</span><input required className={`${fieldClass} w-full`} value={form.bucket} onChange={(event) => setForm((current) => ({ ...current, bucket: event.target.value }))} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Prefixo remoto</span><input required className={`${fieldClass} w-full`} value={form.prefix} onChange={(event) => setForm((current) => ({ ...current, prefix: event.target.value }))} /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar configuração</button>
          {configured && <button type="button" onClick={onRemove} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-50"><Trash2 className="mr-2 h-4 w-4" /> Remover configuração</button>}
        </div>
      </SectionCard>
    </form>
  );
};

const FtpProviderForm = ({ form, setForm, configured, credentialHint, busy, onSubmit, onRemove }) => (
  <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
    <SectionCard icon={<Server className="h-4 w-4" />} title="Servidor FTP" description="Informe o servidor e habilite FTPS sempre que disponível.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Host</span><input required className={`${fieldClass} w-full`} value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Porta</span><input type="number" min="1" max="65535" required className={`${fieldClass} w-full`} value={form.port} onChange={(event) => setForm((current) => ({ ...current, port: Number(event.target.value) }))} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.secure === true} onChange={(event) => setForm((current) => ({ ...current, secure: event.target.checked }))} /> Usar FTPS</label>
      </div>
      {!form.secure && <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> FTP puro não criptografa o tráfego. Use FTPS sempre que o servidor permitir.</p>}
    </SectionCard>

    <SectionCard icon={<KeyRound className="h-4 w-4" />} title="Credenciais" description="A senha é criptografada no servidor e não volta a ser exibida.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Usuário</span>
          <input required={!configured} autoComplete="off" className={`${fieldClass} w-full`} value={form.username} placeholder={configured ? credentialHint || 'Usuário salvo' : ''} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
        </label>
        <SecretInput label="Senha" value={form.password} configured={configured} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
      </div>
    </SectionCard>

    <SectionCard icon={<FolderOpen className="h-4 w-4" />} title="Destino de armazenamento" description="A pasta será criada quando necessário." className="xl:col-span-2">
      <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Pasta remota</span><input required className={`${fieldClass} w-full`} value={form.remote_path} onChange={(event) => setForm((current) => ({ ...current, remote_path: event.target.value }))} /></label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar configuração</button>
        {configured && <button type="button" onClick={onRemove} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-50"><Trash2 className="mr-2 h-4 w-4" /> Remover configuração</button>}
      </div>
    </SectionCard>
  </form>
);

const CommunicationStatus = ({ status, activeProvider, activeLabel, busy, onTest, details }) => {
  const state = busy === 'provider-test'
    ? 'testing'
    : details?.state || (activeProvider?.last_test_status === 'success' ? 'success' : activeProvider?.last_test_status === 'failed' ? 'failed' : 'idle');
  const labels = {
    idle: 'Não testado',
    testing: 'Testando comunicação...',
    success: 'Conectado com sucesso',
    failed: 'Falha na comunicação'
  };
  const success = state === 'success';
  const safeDetails = {
    provider: status.active_provider,
    vendor: activeLabel,
    endpoint_host: activeProvider?.public_config?.endpoint || activeProvider?.public_config?.host || null,
    bucket_folder: activeProvider?.public_config?.bucket || activeProvider?.public_config?.remote_path || activeProvider?.drive_folder_name || null,
    status: state,
    latency_ms: details?.latency_ms || null,
    stage: details?.stage || null,
    error: details?.message || activeProvider?.last_error_message || null
  };
  return (
    <SectionCard icon={success ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} title="Status do armazenamento" description="Valide a comunicação e as permissões no destino remoto.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-sm font-medium ${success ? 'text-green-700' : state === 'failed' ? 'text-red-700' : 'text-slate-700'}`}>{details?.label || labels[state]}</p>
          {(details?.message || activeProvider?.last_error_message) && <p className="mt-1 text-xs text-slate-600">{details?.message || activeProvider.last_error_message}</p>}
        </div>
        <button type="button" onClick={onTest} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50">
          <RefreshCw className={`mr-2 h-4 w-4 ${state === 'testing' ? 'animate-spin' : ''}`} /> Testar comunicação
        </button>
      </div>
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-indigo-600">Detalhes técnicos seguros</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-900 p-3 text-slate-100">{JSON.stringify(safeDetails, null, 2)}</pre>
      </details>
    </SectionCard>
  );
};

export default function CloudBackupCard({ isSuperAdmin }) {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [providerForm, setProviderForm] = useState(createProviderForm('backblaze_b2'));
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [failureEmailRecipients, setFailureEmailRecipients] = useState('');
  const [communicationDetails, setCommunicationDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  useClearOnVaultLock(() => {
    setBackupPassphrase('');
    setProviderForm((current) => ({ ...current, access_key: '', secret_key: '', username: '', password: '' }));
  });

  const loadStatus = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const { data } = await api.get('/cloud-backup/status');
      setStatus({ ...EMPTY_STATUS, ...data });
      const recipients = data.failure_email_recipients?.length
        ? data.failure_email_recipients
        : data.suggested_failure_email ? [data.suggested_failure_email] : [];
      setFailureEmailRecipients(recipients.join(', '));
      if (!['none', 'google_drive'].includes(data.active_provider)) {
        setProviderForm(createProviderForm(data.active_provider, data.providers?.[data.active_provider]?.public_config));
      }
    } catch (error) {
      safeLogError('Falha sanitizada ao carregar Backup Nuvem.', error);
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível carregar o Backup Nuvem.' });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

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

  const selectProvider = (provider) => {
    const targetProvider = provider === status.active_provider ? 'none' : provider;
    if (
      targetProvider !== 'none'
      && status.active_provider !== 'none'
      && !window.confirm('Ao ativar este provedor, os próximos backups serão enviados somente por ele. As credenciais atuais serão preservadas. Deseja continuar?')
    ) return;
    setCommunicationDetails(null);
    perform(
      'provider-change',
      () => api.put('/cloud-backup/provider', { provider: targetProvider }),
      targetProvider === 'none' ? 'Backup Nuvem desativado. As credenciais foram preservadas.' : 'Provedor ativo alterado.'
    );
  };

  const saveProvider = async (event) => {
    event.preventDefault();
    const response = await perform('provider-save', () => api.put('/cloud-backup/provider', {
      provider: status.active_provider,
      config: providerForm
    }), 'Configuração do provedor salva com segurança.');
    if (response) setProviderForm((current) => ({ ...current, access_key: '', secret_key: '', username: '', password: '' }));
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const response = await perform('settings-save', () => api.put('/cloud-backup/settings', {
      enabled: status.active_provider === 'none' ? false : status.enabled,
      schedule_enabled: status.active_provider === 'none' ? false : status.schedule_enabled,
      schedule_days: status.schedule_days,
      schedule_times: status.schedule_times,
      retention_days: Number(status.retention_days),
      backup_passphrase: backupPassphrase,
      failure_email_enabled: status.failure_email_enabled,
      failure_email_recipients: failureEmailRecipients.split(',').map((email) => email.trim()).filter(Boolean),
      failure_email_on_recovery: status.failure_email_on_recovery
    }), 'Configurações do Backup Nuvem salvas.');
    if (response) setBackupPassphrase('');
  };

  const removeProvider = () => {
    if (!window.confirm('Remover as credenciais deste provedor? Os backups remotos serão preservados.')) return;
    perform('provider-remove', () => api.post('/cloud-backup/disconnect', { provider: status.active_provider }), 'Configuração do provedor removida.');
  };

  const testProvider = async () => {
    const startedAt = window.performance.now();
    setBusy('provider-test');
    setCommunicationDetails({ state: 'testing' });
    setFeedback({ type: '', text: '' });
    try {
      const { data } = await api.post('/cloud-backup/test');
      setCommunicationDetails({
        state: 'success',
        latency_ms: Math.round(window.performance.now() - startedAt),
        message: data.message || 'Comunicação validada.',
        stage: 'connection_test'
      });
      setFeedback({ type: 'success', text: 'Comunicação com o provedor validada.' });
    } catch (error) {
      safeLogError('Falha sanitizada no teste de Backup Nuvem.', error);
      const code = String(error.response?.data?.code || '');
      let label = 'Erro desconhecido';
      if (/AUTH|CREDENTIAL|TOKEN/.test(code)) label = 'Falha de autenticação';
      else if (/BUCKET|FOLDER|PATH|NOT_FOUND/.test(code)) label = 'Bucket/pasta não encontrado';
      else if (/PERMISSION|ACCESS_DENIED|FORBIDDEN/.test(code)) label = 'Sem permissão';
      else if (/TIMEOUT/.test(code)) label = 'Timeout';
      else if (/ENDPOINT|HOST/.test(code)) label = 'Endpoint/host inválido';
      setCommunicationDetails({
        state: 'failed',
        label,
        latency_ms: Math.round(window.performance.now() - startedAt),
        message: error.response?.data?.error || 'Não foi possível validar o destino remoto.',
        stage: error.response?.data?.code || 'connection_test'
      });
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível validar o provedor.' });
    } finally {
      setBusy('');
    }
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

  const activeProvider = status.providers?.[status.active_provider];
  const providerConfigured = activeProvider?.configured === true;
  const activeLabel = PROVIDERS.find(([provider]) => provider === status.active_provider)?.[1] || 'Nenhum';
  const providerControlsDisabled = status.active_provider === 'none' || !providerConfigured || Boolean(busy);
  const activationDisabled = !providerConfigured
    || (!status.has_backup_passphrase && backupPassphrase.length < 16);
  let providerFormComponent = null;
  if (['backblaze_b2', 'mega_s3'].includes(status.active_provider)) {
    providerFormComponent = <S3ProviderForm provider={status.active_provider} form={providerForm} setForm={setProviderForm} configured={providerConfigured} credentialHint={activeProvider?.credential_hint} busy={busy} onSubmit={saveProvider} onRemove={removeProvider} />;
  } else if (status.active_provider === 'ftp') {
    providerFormComponent = <FtpProviderForm form={providerForm} setForm={setProviderForm} configured={providerConfigured} credentialHint={activeProvider?.credential_hint} busy={busy} onSubmit={saveProvider} onRemove={removeProvider} />;
  }

  if (!isSuperAdmin) return null;

  return (
    <SettingsAccordionCard id="cloud-backup" title="Backup Nuvem" description="Configure um destino remoto para armazenar backups criptografados do FullPassword." icon={<Cloud className="mr-2 h-5 w-5 text-indigo-500" />} badge={<span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Super Admin</span>}>
      {loading ? <p className="text-sm text-slate-500">Carregando Backup Nuvem...</p> : (
        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">Selecione no máximo um provedor. Clique novamente no provedor ativo para desligá-lo.</p>
            <div className="flex flex-wrap gap-2">{PROVIDERS.map(([provider, label]) => <ProviderSwitch key={provider} provider={provider} label={label} active={status.active_provider === provider} disabled={Boolean(busy)} onChange={selectProvider} />)}</div>
          </section>

          {feedback.text && <div className={`rounded-md border p-3 text-sm ${feedback.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{feedback.text}</div>}

          {status.active_provider === 'none' ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
              <Cloud className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-800">Nenhum provedor de backup em nuvem ativo.</p>
              <p className="mt-1 text-sm text-slate-500">Ative um provedor acima para configurar o armazenamento remoto.</p>
            </div>
          ) : (
            <>
              <SectionCard icon={<Cloud className="h-4 w-4" />} title="Provedor ativo" description="Somente este provedor será usado nas novas execuções.">
                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div><span className="block text-xs text-slate-500">Provedor</span><strong>{activeLabel}</strong></div>
                  <div><span className="block text-xs text-slate-500">Status</span><strong className={providerConfigured ? 'text-green-700' : 'text-amber-700'}>{providerConfigured ? 'Configurado' : 'Configuração pendente'}</strong></div>
                  <div><span className="block text-xs text-slate-500">Credenciais</span><strong>{providerConfigured ? 'Salvas com segurança' : 'Não informadas'}</strong></div>
                </div>
              </SectionCard>

              {status.active_provider === 'google_drive' && (
                <SectionCard icon={<KeyRound className="h-4 w-4" />} title="Configuração OAuth e conta" description="Preserva o fluxo OAuth existente com escopo drive.file.">
                  <GoogleDriveProviderPanel providerStatus={activeProvider} onChanged={loadStatus} busy={busy} setBusy={setBusy} setFeedback={setFeedback} />
                </SectionCard>
              )}
              {providerFormComponent}

              <CommunicationStatus status={status} activeProvider={activeProvider} activeLabel={activeLabel} busy={busy} onTest={testProvider} details={communicationDetails} />
            </>
          )}

          <form onSubmit={saveSettings} className="space-y-4">
            <SectionCard icon={<Database className="h-4 w-4" />} title="Configuração de backup" description="Backups remotos usam exclusivamente o formato criptografado Backup V2.">
              <fieldset disabled={status.active_provider === 'none'} className="space-y-4 disabled:opacity-60">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.active_provider !== 'none' && status.enabled} disabled={activationDisabled} onChange={(event) => setStatus((current) => ({ ...current, enabled: event.target.checked }))} /> Backup Nuvem ativo</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.active_provider !== 'none' && status.schedule_enabled} disabled={activationDisabled} onChange={(event) => setStatus((current) => ({ ...current, schedule_enabled: event.target.checked }))} /> Agendamento ativo</label>
                  <label className="text-sm"><span className="mb-1 block font-medium">Formato</span><input readOnly value="Backup V2" className={`${fieldClass} w-full bg-slate-100`} /></label>
                  <label className="text-sm"><span className="mb-1 block font-medium">Retenção</span><select value={status.retention_days} disabled={providerControlsDisabled} onChange={(event) => setStatus((current) => ({ ...current, retention_days: Number(event.target.value) }))} className={`${fieldClass} w-full`}>{[7, 15, 30, 60].map((days) => <option key={days} value={days}>{days} dias</option>)}</select></label>
                </div>
                <fieldset disabled={providerControlsDisabled}><legend className="mb-2 text-sm font-medium">Dias da semana</legend><div className="flex flex-wrap gap-2">{WEEKDAYS.map(([day, label]) => <label key={day} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 text-sm"><input type="checkbox" checked={status.schedule_days.includes(day)} onChange={() => toggleDay(day)} /> {label}</label>)}</div></fieldset>
                <fieldset disabled={providerControlsDisabled} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="text-sm"><span className="mb-1 block font-medium">Execuções por dia</span><select value={status.schedule_times.length} onChange={(event) => setExecutionCount(Number(event.target.value))} className={`${fieldClass} w-full`}><option value={1}>1 vez</option><option value={2}>2 vezes</option><option value={3}>3 vezes</option></select></label>
                  {status.schedule_times.map((time, index) => <label key={index} className="text-sm"><span className="mb-1 block font-medium">Horário {index + 1}</span><input type="time" value={time} onChange={(event) => setStatus((current) => ({ ...current, schedule_times: current.schedule_times.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} className={`${fieldClass} w-full`} /></label>)}
                </fieldset>
                <label className="block text-sm"><span className="mb-1 block font-medium">Frase de criptografia do Backup V2</span><input type="password" minLength={16} autoComplete="new-password" value={backupPassphrase} disabled={providerControlsDisabled} onChange={(event) => setBackupPassphrase(event.target.value)} placeholder={status.has_backup_passphrase ? 'Deixe em branco para manter a frase salva' : 'Mínimo de 16 caracteres'} className={`${fieldClass} w-full`} /><span className="mt-1 block text-xs font-medium text-amber-700">Guarde essa frase em local seguro. Sem ela, o backup não poderá ser restaurado.</span></label>
                <button type="button" onClick={() => { if (window.confirm('Executar agora um Backup V2 criptografado no provedor ativo?')) perform('backup-run', () => api.post('/cloud-backup/run'), 'Backup V2 enviado ao provedor ativo.'); }} disabled={!providerConfigured || !status.has_backup_passphrase || Boolean(busy)} className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><UploadCloud className="mr-2 h-4 w-4" /> Executar backup agora</button>
              </fieldset>
            </SectionCard>

            <SectionCard icon={<Mail className="h-4 w-4" />} title="Notificações por e-mail" description="Usa a configuração SMTP existente e nunca inclui credenciais, frase ou conteúdo do backup.">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.failure_email_enabled} onChange={(event) => setStatus((current) => ({ ...current, failure_email_enabled: event.target.checked }))} /> Enviar e-mail em caso de falha no backup</label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Destinatários</span>
                  <input type="text" className={`${fieldClass} w-full`} value={failureEmailRecipients} disabled={!status.failure_email_enabled} placeholder="admin@example.com, suporte@example.com" onChange={(event) => setFailureEmailRecipients(event.target.value)} />
                  <span className="mt-1 block text-xs text-slate-500">Até 10 endereços separados por vírgula.</span>
                </label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.failure_email_on_recovery} disabled={!status.failure_email_enabled} onChange={(event) => setStatus((current) => ({ ...current, failure_email_on_recovery: event.target.checked }))} /> Enviar também quando o backup voltar a funcionar</label>
              </div>
            </SectionCard>

            <button type="submit" disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar configurações</button>
          </form>

          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Último sucesso</span>{formatDateTimeShort(status.last_success_at)}</div>
            <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Próxima execução</span>{formatDateTimeShort(status.next_execution_at)}</div>
            <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Último erro</span>{status.last_error_message || '-'}</div>
          </div>

          <SectionCard icon={<Database className="h-4 w-4" />} title="Histórico das últimas execuções" description="Resultados recentes do provedor que estava ativo em cada execução.">
            <div className="overflow-x-auto rounded-md border"><table className="min-w-full divide-y text-sm"><thead className="bg-slate-50"><tr>{['Início', 'Provedor', 'Origem', 'Status', 'Arquivo', 'Tamanho'].map((label) => <th key={label} className="px-3 py-2 text-left font-medium text-slate-600">{label}</th>)}</tr></thead><tbody className="divide-y">{!status.recent_runs?.length ? <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Nenhuma execução registrada.</td></tr> : status.recent_runs.map((run) => <tr key={run.id}><td className="whitespace-nowrap px-3 py-2">{formatDateTimeShort(run.started_at)}</td><td className="px-3 py-2">{PROVIDERS.find(([value]) => value === run.provider)?.[1] || run.provider}</td><td className="px-3 py-2">{run.trigger_type}</td><td className="px-3 py-2">{run.status}</td><td className="max-w-64 truncate px-3 py-2">{run.file_name || run.error_message || '-'}</td><td className="whitespace-nowrap px-3 py-2">{run.size_bytes ? `${(Number(run.size_bytes) / 1024 / 1024).toFixed(2)} MB` : '-'}</td></tr>)}</tbody></table></div>
          </SectionCard>

          <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">O backup local/manual permanece disponível independentemente do Backup Nuvem. Desligar um provedor não remove credenciais nem arquivos remotos.</p>
        </div>
      )}
    </SettingsAccordionCard>
  );
}
