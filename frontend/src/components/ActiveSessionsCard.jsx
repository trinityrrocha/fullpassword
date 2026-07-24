import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Laptop, Loader2, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';

export default function ActiveSessionsCard({ allUsers = false, compactProfile = false }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionTab, setSessionTab] = useState('active');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, total_pages: 0 });

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (allUsers) {
        const { data } = await api.get('/system/sessions', {
          params: { status: sessionTab, page: currentPage }
        });
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
        setPagination(data?.pagination || { page: currentPage, limit: 10, total: 0, total_pages: 0 });
      } else {
        const { data } = await api.get('/auth/sessions');
        setSessions(Array.isArray(data) ? data : []);
      }
    } catch (requestError) {
      setSessions([]);
      setError(requestError.response?.data?.error || 'Não foi possível carregar as sessões.');
    } finally {
      setLoading(false);
    }
  }, [allUsers, currentPage, sessionTab]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => { void loadSessions(); }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadSessions]);

  const revokeSession = async (session) => {
    if (!window.confirm('Encerrar esta sessão?')) return;
    try {
      const { data } = await api.delete(`${allUsers ? '/system' : '/auth'}/sessions/${session.id}`);
      if (data.current_session_revoked) {
        window.location.assign('/login');
        return;
      }
      if (allUsers && sessions.length === 1 && currentPage > 1) {
        setCurrentPage((page) => page - 1);
      } else {
        await loadSessions();
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Não foi possível encerrar a sessão.');
    }
  };

  const revokeOthers = async () => {
    if (!window.confirm('Encerrar todas as outras sessões da sua conta?')) return;
    try {
      await api.delete('/auth/sessions');
      await loadSessions();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Não foi possível encerrar as outras sessões.');
    }
  };

  const selectTab = (tab) => {
    setSessionTab(tab);
    setCurrentPage(1);
  };

  return (
    <div className={compactProfile ? 'space-y-2' : 'space-y-3'}>
      {allUsers && (
        <div className="flex border-b border-slate-200" role="tablist" aria-label="Tipo de sessão">
          {[
            ['active', 'Sessões ativas'],
            ['ended', 'Sessões encerradas']
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={sessionTab === value}
              onClick={() => selectTab(value)}
              className={`border-b-2 px-4 py-2 text-sm font-medium ${
                sessionTab === value
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`${compactProfile ? 'text-xs' : 'text-sm'} text-slate-600`}>
          {allUsers && sessionTab === 'ended'
            ? 'O histórico exibe somente sessões encerradas nos últimos 30 dias.'
            : 'Sessões expiram após 12 horas ou 60 minutos sem atividade.'}
        </p>
        <div className="flex gap-2">
          {!allUsers && <button type="button" onClick={revokeOthers} className={`${compactProfile ? 'text-xs' : 'text-sm'} font-medium text-red-600 hover:text-red-800`}>Encerrar outras</button>}
          <button type="button" onClick={loadSessions} disabled={loading} className={`inline-flex items-center ${compactProfile ? 'text-xs' : 'text-sm'} font-medium text-indigo-600 hover:text-indigo-800`}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</button>
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-600" /> : (
        <div className={`${compactProfile ? 'overflow-hidden' : 'overflow-x-auto'} rounded-md border border-slate-200`}>
          <table className={`${compactProfile ? 'w-full table-fixed text-xs' : 'min-w-full text-sm'} divide-y divide-slate-200`}>
            <thead className="bg-slate-50"><tr>
              {allUsers && <th className="px-3 py-2 text-left">Usuário</th>}
              <th className={`${compactProfile ? 'w-20 px-2 py-1' : 'px-3 py-2'} text-left`}>Dispositivo</th><th className={`${compactProfile ? 'w-24 px-2 py-1' : 'px-3 py-2'} text-left`}>IP</th>
              {!compactProfile && <th className="px-3 py-2 text-left">Login</th>}<th className={`${compactProfile ? 'w-36 px-2 py-1' : 'px-3 py-2'} text-left`}>{allUsers && sessionTab === 'ended' ? 'Encerrada em' : 'Último acesso'}</th>
              {!compactProfile && <th className="px-3 py-2 text-left">Status</th>}<th className={`${compactProfile ? 'w-16 px-2 py-1' : 'px-3 py-2'} text-right`}>Ação</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sessions.length === 0 ? <tr><td colSpan={allUsers ? 7 : compactProfile ? 4 : 6} className={`${compactProfile ? 'py-3' : 'py-5'} px-3 text-center text-slate-500`}>Nenhuma sessão encontrada.</td></tr> : sessions.map((session) => (
                <tr key={session.id} className={compactProfile ? 'h-8' : undefined}>
                  {allUsers && <td className="px-3 py-2 font-medium">{session.name || session.email || '—'}</td>}
                  <td className={`${compactProfile ? 'px-2 py-1' : 'w-20 px-3 py-2'}`}><button type="button" onClick={() => setSelectedSession(session)} title="Ver dispositivo" aria-label="Ver informações do dispositivo" className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"><Laptop className="h-4 w-4" /></button></td>
                  <td className={`${compactProfile ? 'break-all px-2 py-1' : 'whitespace-nowrap px-3 py-2'}`}>{session.ip_address || '—'}</td>
                  {!compactProfile && <td className="whitespace-nowrap px-3 py-2">{formatDateTimeShort(session.created_at)}</td>}
                  <td className={`${compactProfile ? 'px-2 py-1' : 'px-3 py-2'} whitespace-nowrap`}>{formatDateTimeShort(allUsers && sessionTab === 'ended' ? session.ended_at : session.last_seen_at)}</td>
                  {!compactProfile && <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${session.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{session.is_current ? 'Atual' : session.status === 'active' ? 'Ativa' : session.status === 'expired' ? 'Expirada' : 'Encerrada'}</span></td>}
                  <td className={`${compactProfile ? 'px-2 py-1' : 'px-3 py-2'} text-right`}>{session.status === 'active' && <button type="button" onClick={() => revokeSession(session)} className="font-medium text-red-600 hover:text-red-800">Encerrar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {allUsers && !loading && pagination.total_pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setCurrentPage((page) => page - 1)} disabled={currentPage <= 1} className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Anterior</button>
          <span className="text-sm text-slate-600">Página {pagination.page} de {pagination.total_pages}</span>
          <button type="button" onClick={() => setCurrentPage((page) => page + 1)} disabled={currentPage >= pagination.total_pages} className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Próxima</button>
        </div>
      )}
      {selectedSession && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="device-info-title" onClick={() => setSelectedSession(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 id="device-info-title" className="text-lg font-semibold text-slate-900">Informações do dispositivo</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="font-medium text-slate-500">Navegador</dt><dd className="mt-1 text-slate-900">{selectedSession.browser || '—'}</dd></div>
              <div><dt className="font-medium text-slate-500">Sistema operacional</dt><dd className="mt-1 text-slate-900">{selectedSession.os || '—'}</dd></div>
              <div><dt className="font-medium text-slate-500">Dispositivo</dt><dd className="mt-1 text-slate-900">{selectedSession.device || '—'}</dd></div>
              <div><dt className="font-medium text-slate-500">IP</dt><dd className="mt-1 font-mono text-slate-900">{selectedSession.ip_address || '—'}</dd></div>
              <div><dt className="font-medium text-slate-500">Usuário</dt><dd className="mt-1 text-slate-900">{selectedSession.name || selectedSession.email || '—'}</dd></div>
            </dl>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setSelectedSession(null)} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Fechar</button></div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
