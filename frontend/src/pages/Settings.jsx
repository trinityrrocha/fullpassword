import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings as SettingsIcon, RefreshCw, AlertTriangle, ShieldCheck, Download, Database } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import SecurityCard from '../components/SecurityCard';
import SettingsAccordionCard from '../components/SettingsAccordionCard';
import ActiveSessionsCard from '../components/ActiveSessionsCard';
import PasswordPolicyCard from '../components/PasswordPolicyCard';
import BackupRestoreCard from '../components/BackupRestoreCard';
import ManualIpRulesCard from '../components/ManualIpRulesCard';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';

const APP_COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'unknown';
const APP_COMMIT_LABEL = /^[0-9a-f]{7,40}$/i.test(String(APP_COMMIT || '').trim()) ? APP_COMMIT : 'não identificado';

const AUDIT_ACTION_OPTIONS = [
  ['', 'Todas as ações'],
  ['system_update_request', 'Atualização'],
  ['backup_export_attempt', 'Tentativa de backup'],
  ['backup_export_success', 'Backup bem-sucedido'],
  ['backup_export_denied', 'Backup negado'],
  ['backup_export_failed', 'Falha de backup'],
  ['audit_events_access', 'Acesso auditoria'],
  ['login_success', 'Login bem-sucedido'],
  ['login_failed', 'Login falhado'],
  ['ip_blocked', 'IP bloqueado'],
  ['ip_unblocked', 'IP desbloqueado'],
  ['ip_whitelisted', 'IP adicionado à whitelist'],
  ['ip_whitelist_removed', 'IP removido da whitelist'],
  ['user_deleted', 'Usuário excluído'],
  ['login_security_policy_updated', 'Política de login alterada'],
  ['ip_access_blocked', 'Acesso bloqueado por IP']
];

const AUDIT_ACTION_LABELS = Object.fromEntries(AUDIT_ACTION_OPTIONS.filter(([value]) => value));

export default function Settings() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateCountdown, setUpdateCountdown] = useState(0);
  const [backupConfirmation, setBackupConfirmation] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupFormat, setBackupFormat] = useState('v2');
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [backupProgress, setBackupProgress] = useState({ type: '', message: '', percent: null });
  const [systemPermissions, setSystemPermissions] = useState(null);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(true);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditPagination, setAuditPagination] = useState({ page: 1, limit: 10, total: 0, total_pages: 0 });
  const [auditFilters, setAuditFilters] = useState({ action: '', status: '', user_email: '', date_from: '', date_to: '' });
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState('');

  const canManageSystem = systemPermissions?.can_manage_system === true && systemPermissions?.is_super_admin === true;
  const currentUserEmail = systemPermissions?.email || user?.email || 'e-mail não identificado';
  const superAdminEmail = systemPermissions?.super_admin_email || 'e-mail configurado na instalação';

  useEffect(() => {
    const loadSystemPermissions = async () => {
      if (!user) {
        setSystemPermissions(null);
        setIsLoadingPermissions(false);
        return;
      }

      setIsLoadingPermissions(true);
      try {
        const response = await api.get('/system/permissions');
        setSystemPermissions(response.data);
      } catch (error) {
        console.error('Erro ao carregar permissões do sistema:', error);
        setSystemPermissions(null);
      } finally {
        setIsLoadingPermissions(false);
      }
    };

    loadSystemPermissions();
  }, [user]);

  useEffect(() => {
    let timer;
    if (updateCountdown > 0) {
      timer = setInterval(() => {
        setUpdateCountdown((prev) => prev - 1);
      }, 1000);
    } else if (updateCountdown === 0 && isUpdating) {
      window.location.reload();
    }
    return () => clearInterval(timer);
  }, [updateCountdown, isUpdating]);

  const handleUpdateSystem = async () => {
    if (!canManageSystem) {
      alert(`Apenas o Super Admin inicial (${superAdminEmail}) pode executar o WebUpdater.`);
      return;
    }

    if (!window.confirm('Tem certeza que deseja atualizar o sistema? O serviço ficará indisponível por alguns segundos.')) {
      return;
    }

    try {
      const response = await api.post('/system/update');
      setIsUpdating(true);
      setUpdateCountdown(response.data.estimatedTime || 60);
    } catch (error) {
      setIsUpdating(false);
      console.error('Erro ao iniciar atualização:', error);
      alert(error.response?.data?.error || 'Erro ao iniciar atualização. Verifique se você está logado como Super Admin.');
    }
  };

  const handleDownloadBackup = async () => {
    if (!canManageSystem) {
      alert(`Apenas o Super Admin inicial (${superAdminEmail}) pode gerar backup completo do sistema.`);
      return;
    }

    if (backupConfirmation !== 'EXPORTAR BACKUP') {
      alert('Digite exatamente EXPORTAR BACKUP para confirmar.');
      return;
    }
    if (backupPassphrase.length < 16) {
      alert('A frase de criptografia deve ter ao menos 16 caracteres.');
      return;
    }

    setIsDownloadingBackup(true);
    setBackupProgress({ type: 'progress', message: 'Preparando backup criptografado...', percent: null });

    try {
      if (backupFormat === 'v2' && typeof window.showSaveFilePicker === 'function') {
        let writable;
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: `fullpassword-${timestamp}.fullpassword-backup-v2.zip`,
            types: [{
              description: 'Backup FullPassword v2',
              accept: { 'application/zip': ['.zip'] }
            }]
          });

          let csrfToken = document.cookie
            .split('; ')
            .find((item) => item.startsWith('fp_csrf='))
            ?.slice('fp_csrf='.length);
          if (!csrfToken) {
            await api.get('/auth/csrf');
            csrfToken = document.cookie
              .split('; ')
              .find((item) => item.startsWith('fp_csrf='))
              ?.slice('fp_csrf='.length);
          }

          const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
          const backupUrl = new URL(`${apiBaseUrl.replace(/\/$/, '')}/system/backup`, window.location.origin);
          const response = await fetch(backupUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(csrfToken ? { 'X-CSRF-Token': decodeURIComponent(csrfToken) } : {})
            },
            body: JSON.stringify({
              confirmation: backupConfirmation,
              passphrase: backupPassphrase,
              format: backupFormat
            })
          });

          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.message || errorBody.error || 'Erro ao gerar backup criptografado.');
          }
          if (!response.body) throw new Error('O navegador não disponibilizou o stream do backup.');

          writable = await fileHandle.createWritable();
          const reader = response.body.getReader();
          const totalBytes = Number(response.headers.get('content-length')) || 0;
          let downloadedBytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
            downloadedBytes += value.byteLength;
            const percent = totalBytes
              ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
              : null;
            setBackupProgress({
              type: 'progress',
              message: percent === null ? 'Baixando backup...' : `Baixando backup: ${percent}%`,
              percent
            });
          }
          await writable.close();
          writable = null;
          setBackupConfirmation('');
          setBackupPassphrase('');
          setBackupProgress({ type: 'success', message: 'Backup criptografado salvo com sucesso.', percent: 100 });
          return;
        } catch (error) {
          if (writable) await writable.abort().catch(() => {});
          if (error?.name === 'AbortError') {
            setBackupProgress({ type: '', message: '', percent: null });
            return;
          }
          throw error;
        }
      }

      const response = await api.post('/system/backup', {
        confirmation: backupConfirmation,
        passphrase: backupPassphrase,
        format: backupFormat
      }, {
        responseType: 'blob',
        onDownloadProgress: ({ loaded, total }) => {
          const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
          setBackupProgress({
            type: 'progress',
            message: percent === null ? 'Baixando backup...' : `Baixando backup: ${percent}%`,
            percent
          });
        }
      });

      const disposition = response.headers['content-disposition'];
      let filename = backupFormat === 'v2'
        ? 'fullpassword-backup.fullpassword-backup-v2.zip'
        : 'fullpassword-backup.fullpassword-backup.enc.json';

      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const blob = new Blob([response.data], {
        type: response.headers['content-type'] || 'application/octet-stream'
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
      setBackupConfirmation('');
      setBackupPassphrase('');
      setBackupProgress({ type: 'success', message: 'Backup criptografado baixado com sucesso.', percent: 100 });

    } catch (error) {
      let message = 'Erro ao gerar backup criptografado.';
      if (error.response?.data instanceof Blob) {
        try {
          const parsed = JSON.parse(await error.response.data.text());
          message = parsed.error || message;
        } catch {
          // Mantém mensagem genérica sem expor a frase enviada no objeto Axios.
        }
      }
      if (!(error.response?.data instanceof Blob) && error?.message) message = error.message;
      setBackupProgress({ type: 'error', message, percent: null });
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const loadAuditEvents = async (page = 1, filterOverride = null, limitOverride = null) => {
    if (!canManageSystem) return;

    setIsLoadingAudit(true);
    setAuditError('');
    try {
      const limit = limitOverride ?? auditPagination.limit;
      const params = { page, limit };
      Object.entries(filterOverride || auditFilters).forEach(([key, value]) => {
        if (value) params[key] = value;
      });
      const response = await api.get('/system/audit-events', { params });
      setAuditEvents(response.data.events || []);
      setAuditPagination(response.data.pagination || { page, limit, total: 0, total_pages: 0 });
    } catch (error) {
      setAuditEvents([]);
      setAuditError(
        error.response?.status === 403
          ? 'Acesso restrito ao Super Admin.'
          : error.response?.data?.error || 'Não foi possível carregar a auditoria.'
      );
    } finally {
      setIsLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (!canManageSystem) return;
    const auditAction = searchParams.get('audit_action');
    const userEmail = searchParams.get('user_email');
    const requestedIp = searchParams.get('ip');
    if (auditAction) {
      const filters = { ...auditFilters, action: auditAction, ...(userEmail ? { user_email: userEmail } : {}) };
      setAuditFilters(filters);
      loadAuditEvents(1, filters);
      setTimeout(() => document.getElementById('system-audit')?.scrollIntoView({ behavior: 'smooth' }), 0);
    }
    if (searchParams.get('security_tab') || requestedIp) {
      setTimeout(() => document.getElementById('security-card')?.scrollIntoView({ behavior: 'smooth' }), 0);
    }
  // Query strings are intentionally applied once after Super Admin permission is known.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageSystem, searchParams]);

  const restrictedWarning = (message) => (
    <div className="bg-amber-50 border-l-4 border-amber-400 p-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        </div>
        <div className="ml-3">
          <p className="text-sm text-amber-700">{message}</p>
          <p className="text-xs text-amber-600 mt-1">
            Usuário autenticado: {currentUserEmail}. Super Admin exigido: {superAdminEmail}.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center">
            <SettingsIcon className="w-6 h-6 mr-2 text-indigo-600" />
            Configurações do Sistema
          </h1>
          <p className="text-sm text-slate-500">Gerencie parâmetros globais, atualizações e backups da plataforma</p>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-800">
            Versão Atual: v1.0.1 ({APP_COMMIT_LABEL})
          </span>
        </div>
      </div>

      {isUpdating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-90">
          <div className="bg-white p-8 rounded-lg shadow-2xl max-w-md w-full text-center">
            <RefreshCw className="w-16 h-16 text-indigo-600 animate-spin mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Atualizando Sistema</h2>
            <p className="text-slate-600 mb-6">
              O FullPassword está baixando a versão mais recente e reconstruindo os containers.
            </p>
            <div className="text-4xl font-mono font-bold text-indigo-600 mb-2">
              {updateCountdown}s
            </div>
            <p className="text-sm text-slate-500">
              A página será recarregada automaticamente.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <SettingsAccordionCard title="WebUpdater (Atualização Automática)" icon={<RefreshCw className="w-5 h-5 mr-2 text-indigo-500" />} badge={canManageSystem && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Super Admin</span>}>
            <p className="text-sm text-slate-600 mb-4">
              O WebUpdater sincroniza o código fonte do repositório GitHub (branch main) e recria os containers Docker automaticamente.
              Esta ação é restrita ao Super Admin inicial.
            </p>

            {isLoadingPermissions ? (
              <div className="text-sm text-slate-500">Validando permissão de Super Admin...</div>
            ) : !canManageSystem ? (
              restrictedWarning('Apenas o Super Admin inicial pode executar a atualização do sistema.')
            ) : (
              <button
                onClick={handleUpdateSystem}
                disabled={isUpdating}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Buscar Atualizações e Reiniciar
              </button>
            )}
        </SettingsAccordionCard>

        {canManageSystem && (
          <SecurityCard />
        )}

        {canManageSystem && <ManualIpRulesCard />}

        {canManageSystem && (
          <SettingsAccordionCard id="system-audit" title="Auditoria do Sistema" icon={<ShieldCheck className="w-5 h-5 mr-2 text-indigo-500" />} description="Consulte eventos administrativos sensíveis, como WebUpdater, exportação de backup e acessos negados.">
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                <select value={auditFilters.action} onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })} aria-label="Ação" className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white">
                  {AUDIT_ACTION_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
                </select>
                <select value={auditFilters.status} onChange={(e) => setAuditFilters({ ...auditFilters, status: e.target.value })} className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white">
                  <option value="">Todos os status</option>
                  <option value="attempt">Tentativa</option>
                  <option value="accepted">Aceito</option>
                  <option value="success">Sucesso</option>
                  <option value="denied">Negado</option>
                  <option value="failed">Falha</option>
                </select>
                <input type="email" value={auditFilters.user_email} onChange={(e) => setAuditFilters({ ...auditFilters, user_email: e.target.value })} placeholder="E-mail do usuário" className="border border-slate-300 rounded-md px-3 py-2 text-sm" />
                <input type="date" value={auditFilters.date_from} onChange={(e) => setAuditFilters({ ...auditFilters, date_from: e.target.value })} aria-label="Data inicial" className="border border-slate-300 rounded-md px-3 py-2 text-sm" />
                <input type="date" value={auditFilters.date_to} onChange={(e) => setAuditFilters({ ...auditFilters, date_to: e.target.value })} aria-label="Data final" className="border border-slate-300 rounded-md px-3 py-2 text-sm" />
              </div>

              <button type="button" onClick={() => loadAuditEvents(1)} disabled={isLoadingAudit} className="inline-flex items-center px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingAudit ? 'animate-spin' : ''}`} /> Atualizar Auditoria
              </button>

              {auditError && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{auditError}</div>}

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {['Data/Hora', 'Usuário', 'Ação', 'Status', 'IP', 'Detalhes'].map((label) => <th key={label} className="px-3 py-3 text-left font-medium text-slate-600">{label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {auditEvents.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">{isLoadingAudit ? 'Carregando eventos...' : 'Nenhum evento carregado.'}</td></tr>
                    ) : auditEvents.map((event) => (
                      <tr key={event.id}>
                        <td className="px-3 py-3 whitespace-nowrap">{formatDateTimeShort(event.created_at)}</td>
                        <td className="px-3 py-3 max-w-56 break-words">{event.user_email || '-'}</td>
                        <td className="px-3 py-3" title={event.action}>
                          <div className="text-sm">{AUDIT_ACTION_LABELS[event.action] || event.action}</div>
                        </td>
                        <td className="px-3 py-3">{event.status}</td>
                        <td className="px-3 py-3 font-mono text-xs">{event.ip_address || '-'}</td>
                        <td className="px-3 py-3 max-w-72">
                          <details>
                            <summary className="cursor-pointer text-indigo-600">Ver JSON</summary>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-xs text-slate-100">{JSON.stringify(event.metadata || {}, null, 2)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => loadAuditEvents(auditPagination.page - 1)} disabled={isLoadingAudit || auditPagination.page <= 1} className="px-3 py-2 border border-slate-300 rounded-md text-sm disabled:opacity-50">Anterior</button>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">Página {auditPagination.page} de {Math.max(1, auditPagination.total_pages)}</span>
                  <label className="flex items-center gap-1 text-xs text-slate-600">Por página
                    <select value={auditPagination.limit} onChange={(e) => { const limit = Number(e.target.value); setAuditPagination((current) => ({ ...current, page: 1, limit })); loadAuditEvents(1, null, limit); }} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"><option value={10}>10</option><option value={30}>30</option></select>
                  </label>
                </div>
                <button type="button" onClick={() => loadAuditEvents(auditPagination.page + 1)} disabled={isLoadingAudit || auditPagination.page >= auditPagination.total_pages} className="px-3 py-2 border border-slate-300 rounded-md text-sm disabled:opacity-50">Próxima</button>
              </div>
            </div>
          </SettingsAccordionCard>
        )}

        {canManageSystem && (
          <SettingsAccordionCard title="Sessões Ativas" icon={<ShieldCheck className="w-5 h-5 mr-2 text-indigo-500" />} description="Visualize e encerre sessões ativas de todos os usuários.">
            <ActiveSessionsCard allUsers />
          </SettingsAccordionCard>
        )}

        {canManageSystem && (
          <SettingsAccordionCard title="Política Global de Senha" icon={<ShieldCheck className="w-5 h-5 mr-2 text-indigo-500" />} description="Requisitos obrigatórios e aviso periódico de troca de senha.">
            <PasswordPolicyCard />
          </SettingsAccordionCard>
        )}

        <SettingsAccordionCard title="Web Backup (Backup Completo)" icon={<Database className="w-5 h-5 mr-2 text-indigo-500" />} badge={canManageSystem && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Super Admin</span>}>
            <p className="text-sm text-slate-600 mb-4">
              Gere um backup completo criptografado do FullPassword. O conteúdo sensível será protegido
              antes do download e as senhas dos cofres não serão descriptografadas pelo servidor.
            </p>

            <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700">
                    Sem a frase de criptografia o backup não poderá ser aberto. Ela não é armazenada pelo sistema.
                  </p>
                </div>
              </div>
            </div>

            {isLoadingPermissions ? (
              <div className="text-sm text-slate-500">Validando permissão de Super Admin...</div>
            ) : !canManageSystem ? (
              restrictedWarning('Apenas o Super Admin inicial pode gerar backup completo do sistema.')
            ) : (
              <div className="space-y-4">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-slate-700">Formato do backup</legend>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className={`cursor-pointer rounded-md border p-3 ${backupFormat === 'v2' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'}`}>
                      <span className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="backup-format"
                          value="v2"
                          checked={backupFormat === 'v2'}
                          onChange={(event) => setBackupFormat(event.target.value)}
                          disabled={isDownloadingBackup}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">Recomendado v2</span>
                          <span className="block text-xs text-slate-600">Manifesto, checksums e partes criptografadas para backups grandes e anexos.</span>
                        </span>
                      </span>
                    </label>
                    <label className={`cursor-pointer rounded-md border p-3 ${backupFormat === 'v1' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'}`}>
                      <span className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="backup-format"
                          value="v1"
                          checked={backupFormat === 'v1'}
                          onChange={(event) => setBackupFormat(event.target.value)}
                          disabled={isDownloadingBackup}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">Compatível v1</span>
                          <span className="block text-xs text-slate-600">Formato legado em arquivo .enc.json, indicado apenas para backups pequenos.</span>
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Confirmação</label>
                    <input
                      type="text"
                      value={backupConfirmation}
                      onChange={(e) => setBackupConfirmation(e.target.value)}
                      placeholder="Digite EXPORTAR BACKUP"
                      autoComplete="off"
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Frase de criptografia</label>
                    <input
                      type="password"
                      value={backupPassphrase}
                      onChange={(e) => setBackupPassphrase(e.target.value)}
                      minLength={16}
                      autoComplete="new-password"
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="mt-1 text-xs text-slate-500">Mínimo de 16 caracteres. Não salve esta frase junto ao arquivo.</p>
                  </div>
                </div>

                <button
                  onClick={handleDownloadBackup}
                  disabled={isDownloadingBackup}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {isDownloadingBackup ? 'Preparando e baixando...' : `Baixar Backup ${backupFormat.toUpperCase()}`}
                </button>
                {backupProgress.message && (
                  <div
                    role={backupProgress.type === 'error' ? 'alert' : 'status'}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      backupProgress.type === 'error'
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : backupProgress.type === 'success'
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : 'border-indigo-200 bg-indigo-50 text-indigo-800'
                    }`}
                  >
                    {backupProgress.message}
                    {backupProgress.type === 'progress' && backupProgress.percent !== null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100">
                        <div className="h-full bg-indigo-600" style={{ width: `${backupProgress.percent}%` }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
        </SettingsAccordionCard>

        {canManageSystem && (
          <SettingsAccordionCard title="Restaurar Backup" icon={<Database className="w-5 h-5 mr-2 text-red-500" />} description="Valide ou restaure um backup criptografado FullPassword.">
            <BackupRestoreCard />
          </SettingsAccordionCard>
        )}

        <div className="w-full max-w-[781px] mx-auto bg-white shadow rounded-lg overflow-hidden border border-slate-200">
          <div className="h-11 px-4 border-b border-slate-200 bg-slate-50 flex items-center">
            <h3 className="text-base font-medium text-slate-900 flex items-center">
              <ShieldCheck className="w-5 h-5 mr-2 text-emerald-500" />
              Status de Segurança
            </h3>
          </div>
          <div className="p-6">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Criptografia Client-Side</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Ativa (AES-256-GCM)</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Derivação de Chave</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Ativa (PBKDF2)</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Arquitetura Zero-Knowledge</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Em conformidade</dd>
              </div>
              <div className="sm:col-span-1">
                <dt className="text-sm font-medium text-slate-500">Isolamento de Memória</dt>
                <dd className="mt-1 text-sm text-slate-900 font-semibold text-emerald-600">Context API Volátil</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
