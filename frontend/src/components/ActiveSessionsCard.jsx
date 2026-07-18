import { useCallback, useEffect, useState } from 'react';
import { Laptop, Loader2, RefreshCw } from 'lucide-react';
import api from '../services/api';

const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';

export default function ActiveSessionsCard({ allUsers = false }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(allUsers ? '/system/sessions' : '/auth/sessions');
      setSessions(Array.isArray(data) ? data : []);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Não foi possível carregar as sessões.');
    } finally {
      setLoading(false);
    }
  }, [allUsers]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const revokeSession = async (session) => {
    if (!window.confirm('Encerrar esta sessão?')) return;
    try {
      const { data } = await api.delete(`${allUsers ? '/system' : '/auth'}/sessions/${session.id}`);
      if (data.current_session_revoked) {
        window.location.href = '/login';
        return;
      }
      await loadSessions();
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Sessões expiram após 12 horas ou 60 minutos sem atividade.</p>
        <div className="flex gap-2">
          {!allUsers && <button type="button" onClick={revokeOthers} className="text-sm font-medium text-red-600 hover:text-red-800">Encerrar outras</button>}
          <button type="button" onClick={loadSessions} disabled={loading} className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-800"><RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</button>
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-600" /> : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr>
              {allUsers && <th className="px-3 py-2 text-left">Usuário</th>}
              <th className="px-3 py-2 text-left">Dispositivo</th><th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-left">Login</th><th className="px-3 py-2 text-left">Último acesso</th>
              <th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Ação</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sessions.length === 0 ? <tr><td colSpan={allUsers ? 7 : 6} className="px-3 py-5 text-center text-slate-500">Nenhuma sessão encontrada.</td></tr> : sessions.map((session) => (
                <tr key={session.id}>
                  {allUsers && <td className="px-3 py-2"><span className="block font-medium">{session.name}</span><span className="text-xs text-slate-500">{session.email}</span></td>}
                  <td className="px-3 py-2"><span className="flex items-center font-medium"><Laptop className="mr-1 h-4 w-4" />{session.browser}</span><span className="text-xs text-slate-500">{session.os} · {session.device}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap">{session.ip_address || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(session.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(session.last_seen_at)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${session.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{session.is_current ? 'Atual' : session.status === 'active' ? 'Ativa' : session.status === 'expired' ? 'Expirada' : 'Encerrada'}</span></td>
                  <td className="px-3 py-2 text-right">{session.status === 'active' && <button type="button" onClick={() => revokeSession(session)} className="font-medium text-red-600 hover:text-red-800">Encerrar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
