import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../services/api';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';
import { canInstallUpdate, describeUpdateStatus, requestUpdateCheck, UPDATE_CHECK_ERROR, UPDATE_STATUS_CHANGED } from '../utils/updateNotifications';

export default function UpdateStatusPanel({ onUpdate, updateRequestLoading, isUpdating }) {
  const [status, setStatus] = useState({ state: 'unknown' });
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const checkLock = useRef(false);
  const controller = useRef(null);

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    let timer;
    const deadline = Date.now() + 30000;
    const refresh = async () => {
      try {
        const { data } = await api.get('/system/update/status', { signal: abort.signal, timeout: 5000 });
        if (abort.signal.aborted) return;
        setStatus(data);
        if (['checking', 'updating'].includes(data.state)) {
          if (Date.now() < deadline) timer = setTimeout(refresh, 1500);
          else setError(UPDATE_CHECK_ERROR);
        }
      } catch { if (!abort.signal.aborted) setError(UPDATE_CHECK_ERROR); }
    };
    refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, []);

  const check = async () => {
    if (checkLock.current) return;
    checkLock.current = true;
    setChecking(true);
    setError('');
    const signal = controller.current.signal;
    try {
      await requestUpdateCheck(api, { signal, onStatus: (data) => { if (!signal.aborted) setStatus(data); } });
      window.dispatchEvent(new Event(UPDATE_STATUS_CHANGED));
    } catch {
      if (!signal.aborted) setError(UPDATE_CHECK_ERROR);
    } finally {
      checkLock.current = false;
      if (!signal.aborted) setChecking(false);
    }
  };

  const busy = checking || isUpdating || updateRequestLoading || (!error && ['checking', 'updating'].includes(status.state));
  return (
    <div className="space-y-4 text-sm text-slate-700 dark:text-slate-200">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>Versão atual <span className="block font-mono" title={status.installed_commit || undefined}>{status.installed_commit_short || 'Não identificada'}</span></div>
        <div>Versão disponível <span className="block font-mono" title={status.available_commit || undefined}>{status.available_commit_short || 'Não identificada'}</span></div>
      </div>
      <p role="status">{checking ? 'Verificando atualizações...' : describeUpdateStatus(status)}</p>
      {canInstallUpdate(status) && <p>{status.commits_behind} alterações disponíveis</p>}
      <p className="text-xs text-slate-500 dark:text-slate-400">Última verificação: {formatDateTimeShort(status.checked_at)}</p>
      {status.state === 'check_failed' && <p className="text-xs">Última verificação bem-sucedida: {formatDateTimeShort(status.last_successful_check_at)}</p>}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={check} disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 disabled:opacity-50 dark:border-slate-600">
          <RefreshCw className={`h-4 w-4 ${checking || status.state === 'checking' ? 'animate-spin' : ''}`} />
          {checking ? 'Verificando atualizações...' : status.state === 'check_failed' ? 'Tentar novamente' : 'Verificar atualizações'}
        </button>
        {canInstallUpdate(status) && <button type="button" onClick={onUpdate} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">{updateRequestLoading ? 'Solicitando atualização...' : 'Atualizar sistema'}</button>}
        {status.state === 'unknown' && !status.installed_commit && <button type="button" onClick={onUpdate} disabled={busy} className="rounded-md border border-slate-300 px-3 py-2 disabled:opacity-50 dark:border-slate-600">Inicializar controle de versão</button>}
      </div>
      {status.state === 'unknown' && !status.installed_commit && <p className="text-xs">Em instalações anteriores a este recurso, inicialize o controle pelo WebUpdater. Esta ação pede confirmação e realiza uma implantação; a versão nova só é registrada após a implantação saudável.</p>}
      <p className="text-xs text-slate-500 dark:text-slate-400">A verificação não instala atualizações. A instalação depende de confirmação do Super Admin.</p>
      {canInstallUpdate(status) && status.changes?.length > 0 && <div>
        <h3 className="mb-2 font-medium">Alterações disponíveis</h3>
        <ul className="max-h-80 space-y-3 overflow-y-auto">
          {status.changes.map((change) => <li key={change.commit} className="break-words">
            <span className="mr-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">{change.type_label}</span>{change.title}
            <div className="text-xs text-slate-500 dark:text-slate-400"><span title={change.commit}>{change.short_commit}</span> · {formatDateTimeShort(change.date)}</div>
          </li>)}
        </ul>
        {status.changes_truncated && <p className="mt-2 text-xs">Mostrando as 100 alterações mais recentes.</p>}
      </div>}
    </div>
  );
}
