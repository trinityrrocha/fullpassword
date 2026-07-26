import { useCallback, useEffect, useState } from 'react';
import { Cloud, Link, RefreshCw, Save, Unlink, UploadCloud } from 'lucide-react';
import api from '../services/api';
import SettingsAccordionCard from './SettingsAccordionCard';
import { safeLogError } from '../utils/safeLogger';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import {
  GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE,
  GOOGLE_DRIVE_SERVER_SETUP_MESSAGE,
  getGoogleDriveActionError,
  normalizeGoogleDriveStatus,
  validateGoogleDriveSettingsSave
} from '../utils/googleDriveBackupUiState';

const WEEKDAYS = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [0, 'Dom']
];
const DEFAULT_TIMES = ['02:00', '14:00', '18:00'];
const INITIAL_STATUS = {
  enabled: false,
  connected: false,
  server_configured: false,
  google_email: null,
  drive_folder_name: 'FullPassword Backups',
  backup_format: 'v2',
  schedule_enabled: false,
  schedule_days: [0, 1, 2, 3, 4, 5, 6],
  schedule_times: ['02:00'],
  retention_days: 30,
  has_backup_passphrase: false,
  recent_runs: []
};
const fieldClass = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';

const runStatusLabel = {
  running: 'Em execução',
  success: 'Sucesso',
  failed: 'Falha',
  skipped: 'Ignorado'
};

export default function GoogleDriveBackupCard({ isSuperAdmin }) {
  const [settings, setSettings] = useState(INITIAL_STATUS);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [message, setMessage] = useState(() => {
    const result = new URLSearchParams(window.location.search).get('google_drive');
    if (result === 'connected') return { type: 'success', text: 'Google Drive conectado com sucesso.' };
    if (result === 'denied') return { type: 'error', text: 'A conexão com o Google Drive foi cancelada.' };
    if (result === 'error') return { type: 'error', text: 'Não foi possível concluir a conexão com o Google Drive.' };
    return { type: '', text: '' };
  });

  useClearOnVaultLock(() => {
    setBackupPassphrase('');
  });

  const loadStatus = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const { data } = await api.get('/integrations/google-drive/status');
      setSettings(normalizeGoogleDriveStatus({ ...INITIAL_STATUS, ...data }));
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Não foi possível carregar o status do Google Drive.'
      });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(loadStatus, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  if (!isSuperAdmin) return null;

  const perform = async (name, operation, successMessage) => {
    setAction(name);
    setMessage({ type: '', text: '' });
    try {
      await operation();
      setMessage({ type: 'success', text: successMessage });
      await loadStatus();
    } catch (error) {
      const actionError = getGoogleDriveActionError(
        error,
        'Não foi possível concluir a operação com o Google Drive.'
      );
      if (!actionError.expected) {
        safeLogError('Falha sanitizada na ação do Google Drive.', error);
      }
      setMessage({
        type: 'error',
        text: actionError.message
      });
    } finally {
      setAction('');
    }
  };

  const connect = () => {
    if (!settings.server_configured) {
      setMessage({ type: 'error', text: GOOGLE_DRIVE_SERVER_SETUP_MESSAGE });
      return;
    }
    perform('connect', async () => {
      const { data } = await api.get('/integrations/google-drive/oauth/start');
      window.location.assign(data.authorization_url);
    }, 'Redirecionando para o Google...');
  };

  const save = (event) => {
    event.preventDefault();
    const validationMessage = validateGoogleDriveSettingsSave(settings);
    if (validationMessage) {
      setSettings((value) => ({ ...value, enabled: false, schedule_enabled: false }));
      setMessage({ type: 'error', text: validationMessage });
      return;
    }
    return perform('save', () => api.put('/integrations/google-drive/settings', {
      enabled: settings.enabled,
      schedule_enabled: settings.schedule_enabled,
      schedule_days: settings.schedule_days,
      schedule_times: settings.schedule_times,
      retention_days: Number(settings.retention_days),
      backup_passphrase: backupPassphrase
    }), 'Configuração do backup Google Drive salva.').then(() => setBackupPassphrase(''));
  };

  const test = () => perform(
    'test',
    () => api.post('/integrations/google-drive/test'),
    'Comunicação validada e pasta de backup disponível.'
  );

  const backupNow = () => {
    if (!window.confirm('Executar agora um Backup V2 criptografado e enviá-lo ao Google Drive?')) return;
    perform(
      'backup',
      () => api.post('/integrations/google-drive/backup-now'),
      'Backup V2 enviado ao Google Drive.'
    );
  };

  const disconnect = () => {
    if (!window.confirm('Desconectar o Google Drive e desativar o agendamento? Os backups existentes não serão excluídos.')) return;
    perform(
      'disconnect',
      () => api.post('/integrations/google-drive/disconnect'),
      'Google Drive desconectado. Os backups existentes foram preservados.'
    );
  };

  const setExecutionCount = (count) => {
    const current = settings.schedule_times;
    const scheduleTimes = Array.from({ length: count }, (_, index) => current[index] || DEFAULT_TIMES[index]);
    setSettings((value) => ({ ...value, schedule_times: scheduleTimes }));
  };

  const toggleDay = (day) => {
    const selected = settings.schedule_days.includes(day);
    const scheduleDays = selected
      ? settings.schedule_days.filter((value) => value !== day)
      : [...settings.schedule_days, day].sort();
    if (scheduleDays.length) setSettings((value) => ({ ...value, schedule_days: scheduleDays }));
  };
  const canConfigure = settings.server_configured && settings.connected;
  const controlsDisabled = !canConfigure || Boolean(action);

  return (
    <SettingsAccordionCard
      id="google-drive-backup"
      title="Backup Google Drive"
      icon={<Cloud className="mr-2 h-5 w-5 text-indigo-500" />}
      badge={<span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Super Admin</span>}
    >
      {loading ? (
        <div className="text-sm text-slate-500">Carregando integração Google Drive...</div>
      ) : (
        <div className="space-y-5">
          {!settings.server_configured && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Integração Google Drive não configurada no servidor.</p>
              <p className="mt-1">
                Configure GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET e GOOGLE_DRIVE_REDIRECT_URI no backend e reinicie o serviço.
              </p>
            </div>
          )}
          {settings.server_configured && !settings.connected && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              {GOOGLE_DRIVE_CONNECT_FIRST_MESSAGE}
            </div>
          )}
          {message.text && (
            <div className={`rounded-md border p-3 text-sm ${
              message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}>
              {message.text}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div>
              <div className="text-sm font-medium text-slate-900">
                {settings.connected ? `Conectado como: ${settings.google_email || 'conta Google autorizada'}` : 'Não conectado'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Pasta: {settings.drive_folder_name} · Escopo mínimo drive.file
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!settings.connected ? (
                <div>
                  <button type="button" onClick={connect} disabled={!settings.server_configured || Boolean(action)} title={!settings.server_configured ? 'Configure as credenciais OAuth no servidor para liberar a conexão.' : undefined} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <Link className="mr-2 h-4 w-4" /> Conectar Google Drive
                  </button>
                  {!settings.server_configured && (
                    <p className="mt-1 max-w-xs text-xs text-slate-500">
                      Configure as credenciais OAuth no servidor para liberar a conexão.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <button type="button" onClick={test} disabled={!canConfigure || Boolean(action)} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                    <RefreshCw className={`mr-2 h-4 w-4 ${action === 'test' ? 'animate-spin' : ''}`} /> Testar comunicação
                  </button>
                  <button type="button" onClick={disconnect} disabled={Boolean(action)} className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                    <Unlink className="mr-2 h-4 w-4" /> Desconectar
                  </button>
                </>
              )}
            </div>
          </div>

          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={settings.enabled} disabled={!canConfigure} onChange={(event) => setSettings((value) => ({ ...value, enabled: event.target.checked }))} />
                Backup Google Drive ativo
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={settings.schedule_enabled} disabled={!canConfigure} onChange={(event) => setSettings((value) => ({ ...value, schedule_enabled: event.target.checked }))} />
                Agendamento ativo
              </label>
              <label className="text-sm text-slate-700">
                <span className="mb-1 block font-medium">Formato</span>
                <input value="Backup V2" readOnly className={`${fieldClass} w-full bg-slate-100`} />
              </label>
              <label className="text-sm text-slate-700">
                <span className="mb-1 block font-medium">Retenção</span>
                <select value={settings.retention_days} disabled={controlsDisabled} onChange={(event) => setSettings((value) => ({ ...value, retention_days: Number(event.target.value) }))} className={`${fieldClass} w-full disabled:bg-slate-100 disabled:text-slate-500`}>
                  {[7, 15, 30, 60].map((days) => <option key={days} value={days}>{days} dias</option>)}
                </select>
              </label>
            </div>

            <fieldset disabled={controlsDisabled} className={controlsDisabled ? 'opacity-60' : ''}>
              <legend className="mb-2 text-sm font-medium text-slate-700">Dias da semana</legend>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 text-sm">
                  <input type="checkbox" checked={settings.schedule_days.length === 7} onChange={(event) => setSettings((value) => ({ ...value, schedule_days: event.target.checked ? [0, 1, 2, 3, 4, 5, 6] : [1] }))} />
                  Todos os dias
                </label>
                {WEEKDAYS.map(([day, label]) => (
                  <label key={day} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 text-sm">
                    <input type="checkbox" checked={settings.schedule_days.includes(day)} onChange={() => toggleDay(day)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset disabled={controlsDisabled} className={`grid grid-cols-1 gap-3 md:grid-cols-4 ${controlsDisabled ? 'opacity-60' : ''}`}>
              <label className="text-sm text-slate-700">
                <span className="mb-1 block font-medium">Execuções por dia</span>
                <select value={settings.schedule_times.length} onChange={(event) => setExecutionCount(Number(event.target.value))} className={`${fieldClass} w-full`}>
                  <option value={1}>1 vez</option>
                  <option value={2}>2 vezes</option>
                  <option value={3}>3 vezes</option>
                </select>
              </label>
              {settings.schedule_times.map((time, index) => (
                <label key={index} className="text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Horário {index + 1}</span>
                  <input type="time" value={time} onChange={(event) => setSettings((value) => ({ ...value, schedule_times: value.schedule_times.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} className={`${fieldClass} w-full`} />
                </label>
              ))}
            </fieldset>

            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Frase de criptografia do Backup V2</span>
              <input type="password" value={backupPassphrase} disabled={controlsDisabled} onChange={(event) => setBackupPassphrase(event.target.value)} minLength={16} autoComplete="new-password" placeholder={settings.has_backup_passphrase ? 'Deixe em branco para manter a frase salva' : 'Mínimo de 16 caracteres'} className={`${fieldClass} w-full disabled:bg-slate-100 disabled:text-slate-500`} />
              <span className="mt-1 block text-xs text-slate-500">
                Armazenada cifrada no servidor. Guarde uma cópia segura: sem ela o backup não pode ser restaurado.
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={controlsDisabled} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                <Save className="mr-2 h-4 w-4" /> Salvar configuração
              </button>
              <button type="button" onClick={backupNow} disabled={!canConfigure || !settings.has_backup_passphrase || Boolean(action)} className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50">
                <UploadCloud className="mr-2 h-4 w-4" /> Executar backup agora
              </button>
            </div>
          </form>

          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-3"><span className="block text-xs text-slate-500">Último sucesso</span>{formatDateTimeShort(settings.last_success_at)}</div>
            <div className="rounded-md border border-slate-200 p-3"><span className="block text-xs text-slate-500">Próxima execução</span>{formatDateTimeShort(settings.next_execution_at)}</div>
            <div className="rounded-md border border-slate-200 p-3"><span className="block text-xs text-slate-500">Último erro</span>{settings.last_error_message || '-'}</div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-900">Últimas execuções</h3>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50"><tr>{['Início', 'Origem', 'Status', 'Arquivo', 'Tamanho'].map((label) => <th key={label} className="px-3 py-2 text-left font-medium text-slate-600">{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {settings.recent_runs.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Nenhuma execução registrada.</td></tr>
                  ) : settings.recent_runs.map((run) => (
                    <tr key={run.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDateTimeShort(run.started_at)}</td>
                      <td className="px-3 py-2">{run.trigger_type}</td>
                      <td className="px-3 py-2">{runStatusLabel[run.status] || run.status}</td>
                      <td className="max-w-64 truncate px-3 py-2">{run.file_name || run.error_message || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{run.size_bytes ? `${(Number(run.size_bytes) / 1024 / 1024).toFixed(2)} MB` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </SettingsAccordionCard>
  );
}
