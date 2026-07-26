import { useCallback, useEffect, useState } from 'react';
import { Cloud, RefreshCw, Save, Trash2, UploadCloud } from 'lucide-react';
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
const WEEKDAYS = Object.freeze([[0, 'Dom'], [1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']]);
const fieldClass = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';
const EMPTY_STATUS = Object.freeze({
  active_provider: 'none',
  enabled: false,
  schedule_enabled: false,
  schedule_days: [0, 1, 2, 3, 4, 5, 6],
  schedule_times: ['02:00'],
  retention_days: 30,
  has_backup_passphrase: false,
  providers: {},
  recent_runs: []
});

const createProviderForm = (provider, config = {}) => provider === 'ftp'
  ? {
      host: config.host || '',
      port: config.port || 21,
      username: '',
      password: '',
      remote_path: config.remote_path || '/fullpassword/backups',
      secure: config.secure === true
    }
  : {
      endpoint: config.endpoint || '',
      region: config.region || '',
      bucket: config.bucket || '',
      access_key: '',
      secret_key: '',
      prefix: config.prefix || 'fullpassword/backups/'
    };

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

const S3ProviderForm = ({ provider, form, setForm, configured, credentialHint, busy, onSubmit, onRemove }) => {
  const backblaze = provider === 'backblaze_b2';
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="font-medium text-slate-900">{backblaze ? 'Backblaze B2' : 'Mega S3'}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {backblaze
            ? 'Use o endpoint S3 informado no painel do bucket Backblaze B2. O bucket deve ser privado.'
            : 'Use o endpoint e a região informados no painel Mega Object Storage / S4.'}
        </p>
        {configured && <p className="mt-1 text-xs text-green-700">Credenciais salvas: {credentialHint || 'configuradas'}. A chave secreta não é exibida.</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block font-medium">Endpoint S3</span><input type="url" required className={`${fieldClass} w-full`} value={form.endpoint || ''} onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Region</span><input required className={`${fieldClass} w-full`} value={form.region || ''} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Bucket</span><input required className={`${fieldClass} w-full`} value={form.bucket || ''} onChange={(event) => setForm((current) => ({ ...current, bucket: event.target.value }))} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">{backblaze ? 'Key ID / Access Key' : 'Access Key'}</span><input required={!configured} autoComplete="off" className={`${fieldClass} w-full`} value={form.access_key || ''} onChange={(event) => setForm((current) => ({ ...current, access_key: event.target.value }))} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">{backblaze ? 'Application Key / Secret Key' : 'Secret Key'}</span><input type="password" required={!configured} autoComplete="new-password" className={`${fieldClass} w-full`} value={form.secret_key || ''} onChange={(event) => setForm((current) => ({ ...current, secret_key: event.target.value }))} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Prefixo remoto</span><input required className={`${fieldClass} w-full`} value={form.prefix || ''} onChange={(event) => setForm((current) => ({ ...current, prefix: event.target.value }))} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar configuração</button>
        {configured && <button type="button" onClick={onRemove} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-50"><Trash2 className="mr-2 h-4 w-4" /> Remover configuração</button>}
      </div>
    </form>
  );
};

const FtpProviderForm = ({ form, setForm, configured, credentialHint, busy, onSubmit, onRemove }) => (
  <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
    <div>
      <h3 className="font-medium text-slate-900">FTP / FTPS</h3>
      <p className="mt-1 text-sm text-amber-700">Preferencialmente use FTPS. FTP puro não criptografa o tráfego.</p>
      {configured && <p className="mt-1 text-xs text-green-700">Usuário salvo: {credentialHint || 'configurado'}. A senha não é exibida.</p>}
    </div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="text-sm"><span className="mb-1 block font-medium">Host</span><input required className={`${fieldClass} w-full`} value={form.host || ''} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} /></label>
      <label className="text-sm"><span className="mb-1 block font-medium">Porta</span><input type="number" min="1" max="65535" required className={`${fieldClass} w-full`} value={form.port || 21} onChange={(event) => setForm((current) => ({ ...current, port: Number(event.target.value) }))} /></label>
      <label className="text-sm"><span className="mb-1 block font-medium">Usuário</span><input required={!configured} autoComplete="off" className={`${fieldClass} w-full`} value={form.username || ''} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></label>
      <label className="text-sm"><span className="mb-1 block font-medium">Senha</span><input type="password" required={!configured} autoComplete="new-password" className={`${fieldClass} w-full`} value={form.password || ''} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></label>
      <label className="text-sm"><span className="mb-1 block font-medium">Pasta remota</span><input required className={`${fieldClass} w-full`} value={form.remote_path || ''} onChange={(event) => setForm((current) => ({ ...current, remote_path: event.target.value }))} /></label>
      <label className="flex items-center gap-2 self-end py-2 text-sm"><input type="checkbox" checked={form.secure === true} onChange={(event) => setForm((current) => ({ ...current, secure: event.target.checked }))} /> Usar FTPS</label>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar configuração</button>
      {configured && <button type="button" onClick={onRemove} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-50"><Trash2 className="mr-2 h-4 w-4" /> Remover configuração</button>}
    </div>
  </form>
);

export default function CloudBackupCard({ isSuperAdmin }) {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [providerForm, setProviderForm] = useState(createProviderForm('backblaze_b2'));
  const [backupPassphrase, setBackupPassphrase] = useState('');
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
      await operation();
      setFeedback({ type: 'success', text: successMessage });
      await loadStatus();
      return true;
    } catch (error) {
      safeLogError('Falha sanitizada na ação de Backup Nuvem.', error);
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível concluir a operação.' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const selectProvider = (provider) => {
    if (provider === status.active_provider) return;
    if (status.active_provider !== 'none' && !window.confirm('Ao ativar este provedor, os próximos backups serão enviados somente por ele. As credenciais atuais serão preservadas. Deseja continuar?')) return;
    perform('provider-change', () => api.put('/cloud-backup/provider', { provider }), 'Provedor ativo alterado.');
  };

  const saveProvider = async (event) => {
    event.preventDefault();
    const success = await perform('provider-save', () => api.put('/cloud-backup/provider', {
      provider: status.active_provider,
      config: providerForm
    }), 'Configuração do provedor salva com segurança.');
    if (success) setProviderForm((current) => ({ ...current, access_key: '', secret_key: '', username: '', password: '' }));
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const success = await perform('settings-save', () => api.put('/cloud-backup/settings', {
      enabled: status.enabled,
      schedule_enabled: status.schedule_enabled,
      schedule_days: status.schedule_days,
      schedule_times: status.schedule_times,
      retention_days: Number(status.retention_days),
      backup_passphrase: backupPassphrase
    }), 'Configurações do Backup Nuvem salvas.');
    if (success) setBackupPassphrase('');
  };

  const removeProvider = () => {
    if (!window.confirm('Remover as credenciais deste provedor? Os backups remotos serão preservados.')) return;
    perform('provider-remove', () => api.post('/cloud-backup/disconnect', { provider: status.active_provider }), 'Configuração do provedor removida.');
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
  const controlsDisabled = !providerConfigured || Boolean(busy);
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
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Provedor ativo: {activeLabel}</p>
            <div className="flex flex-wrap gap-2">{PROVIDERS.map(([provider, label]) => <ProviderSwitch key={provider} provider={provider} label={label} active={status.active_provider === provider} disabled={Boolean(busy)} onChange={selectProvider} />)}</div>
          </div>

          {feedback.text && <div className={`rounded-md border p-3 text-sm ${feedback.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{feedback.text}</div>}

          {status.active_provider === 'google_drive' && <GoogleDriveProviderPanel providerStatus={activeProvider} onChanged={loadStatus} busy={busy} setBusy={setBusy} setFeedback={setFeedback} />}
          {providerFormComponent}

          {status.active_provider !== 'none' && (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => perform('provider-test', () => api.post('/cloud-backup/test'), 'Comunicação com o provedor validada.')} disabled={controlsDisabled} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`mr-2 h-4 w-4 ${busy === 'provider-test' ? 'animate-spin' : ''}`} /> Testar comunicação</button>
                <button type="button" onClick={() => { if (window.confirm('Executar agora um Backup V2 criptografado no provedor ativo?')) perform('backup-run', () => api.post('/cloud-backup/run'), 'Backup V2 enviado ao provedor ativo.'); }} disabled={!providerConfigured || !status.has_backup_passphrase || Boolean(busy)} className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><UploadCloud className="mr-2 h-4 w-4" /> Executar backup agora</button>
              </div>

              <form onSubmit={saveSettings} className="space-y-4 border-t border-slate-200 pt-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.enabled} disabled={!providerConfigured} onChange={(event) => setStatus((current) => ({ ...current, enabled: event.target.checked }))} /> Backup Nuvem ativo</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.schedule_enabled} disabled={!providerConfigured} onChange={(event) => setStatus((current) => ({ ...current, schedule_enabled: event.target.checked }))} /> Agendamento ativo</label>
                  <label className="text-sm"><span className="mb-1 block font-medium">Formato</span><input readOnly value="Backup V2" className={`${fieldClass} w-full bg-slate-100`} /></label>
                  <label className="text-sm"><span className="mb-1 block font-medium">Retenção</span><select value={status.retention_days} disabled={controlsDisabled} onChange={(event) => setStatus((current) => ({ ...current, retention_days: Number(event.target.value) }))} className={`${fieldClass} w-full`}>{[7, 15, 30, 60].map((days) => <option key={days} value={days}>{days} dias</option>)}</select></label>
                </div>
                <fieldset disabled={controlsDisabled}><legend className="mb-2 text-sm font-medium">Dias da semana</legend><div className="flex flex-wrap gap-2">{WEEKDAYS.map(([day, label]) => <label key={day} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 text-sm"><input type="checkbox" checked={status.schedule_days.includes(day)} onChange={() => toggleDay(day)} /> {label}</label>)}</div></fieldset>
                <fieldset disabled={controlsDisabled} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="text-sm"><span className="mb-1 block font-medium">Execuções por dia</span><select value={status.schedule_times.length} onChange={(event) => setExecutionCount(Number(event.target.value))} className={`${fieldClass} w-full`}><option value={1}>1 vez</option><option value={2}>2 vezes</option><option value={3}>3 vezes</option></select></label>
                  {status.schedule_times.map((time, index) => <label key={index} className="text-sm"><span className="mb-1 block font-medium">Horário {index + 1}</span><input type="time" value={time} onChange={(event) => setStatus((current) => ({ ...current, schedule_times: current.schedule_times.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} className={`${fieldClass} w-full`} /></label>)}
                </fieldset>
                <label className="block text-sm"><span className="mb-1 block font-medium">Frase de criptografia do Backup V2</span><input type="password" minLength={16} autoComplete="new-password" value={backupPassphrase} disabled={controlsDisabled} onChange={(event) => setBackupPassphrase(event.target.value)} placeholder={status.has_backup_passphrase ? 'Deixe em branco para manter a frase salva' : 'Mínimo de 16 caracteres'} className={`${fieldClass} w-full`} /><span className="mt-1 block text-xs text-slate-500">Armazenada criptografada. Sem essa frase, o backup não poderá ser restaurado.</span></label>
                <button type="submit" disabled={controlsDisabled} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar configuração comum</button>
              </form>
            </>
          )}

          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Último sucesso</span>{formatDateTimeShort(status.last_success_at)}</div>
            <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Próxima execução</span>{formatDateTimeShort(status.next_execution_at)}</div>
            <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Último erro</span>{status.last_error_message || '-'}</div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Últimas execuções</h3>
            <div className="overflow-x-auto rounded-md border"><table className="min-w-full divide-y text-sm"><thead className="bg-slate-50"><tr>{['Início', 'Provedor', 'Origem', 'Status', 'Arquivo', 'Tamanho'].map((label) => <th key={label} className="px-3 py-2 text-left font-medium text-slate-600">{label}</th>)}</tr></thead><tbody className="divide-y">{!status.recent_runs?.length ? <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Nenhuma execução registrada.</td></tr> : status.recent_runs.map((run) => <tr key={run.id}><td className="whitespace-nowrap px-3 py-2">{formatDateTimeShort(run.started_at)}</td><td className="px-3 py-2">{PROVIDERS.find(([value]) => value === run.provider)?.[1] || run.provider}</td><td className="px-3 py-2">{run.trigger_type}</td><td className="px-3 py-2">{run.status}</td><td className="max-w-64 truncate px-3 py-2">{run.file_name || run.error_message || '-'}</td><td className="whitespace-nowrap px-3 py-2">{run.size_bytes ? `${(Number(run.size_bytes) / 1024 / 1024).toFixed(2)} MB` : '-'}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      )}
    </SettingsAccordionCard>
  );
}
