import { useCallback, useEffect, useRef, useState } from 'react';
import SpfblStatusBar from './SpfblStatusBar';
import SpfblRecord from './SpfblRecord';
import { getHistory, refreshHistory } from '../../services/spfblService';
import { COVERAGE_NOTE, REASON_ICONS, describeError, describeRelease, formatEpoch, formatNumber } from '../../utils/spfbl';

const POLL_MS = 3000;
const field = 'mt-1 w-full min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900';

export default function SpfblHistory() {
  const [applied, setApplied] = useState({});            // what the server last answered with (defaults come from the server)
  const [draft, setDraft] = useState(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const timer = useRef(null);
  const request = useRef(0);
  const hasData = useRef(false);

  const load = useCallback(async (params) => {
    const ticket = ++request.current;
    clearTimeout(timer.current);
    try {
      const next = await getHistory(params);
      if (ticket !== request.current) return;
      hasData.current = true;
      setData(next); setError(''); setFieldError('');
      setDraft((current) => current || { domain: next.domain, ...next.filters });
      if (next.state.loading) timer.current = setTimeout(() => load(params), POLL_MS);
    } catch (failure) {
      if (ticket !== request.current) return;
      const message = describeError(failure, 'Não foi possível carregar o histórico.');
      if (failure?.response?.status === 422 && hasData.current) setFieldError(message); else setError(message); // a rejected FIRST load must not leave the screen on "Carregando"
    }
  }, []);
  useEffect(() => { load({ ...applied, page }); return () => { clearTimeout(timer.current); request.current += 1; }; }, [applied, page, load]);

  const submit = (event) => { event.preventDefault(); setPage(1); setApplied({ ...draft }); };
  const clear = () => { setDraft(null); setPage(1); setApplied({}); };
  const refresh = async () => {
    setBusy(true);
    try { await refreshHistory(); await load({ ...applied, page }); } catch (failure) { setError(describeError(failure, 'Não foi possível atualizar agora.')); } finally { setBusy(false); }
  };
  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  if (selected) return <SpfblRecord id={selected} domain={data?.domain} onBack={() => setSelected(null)} />;
  if (error && !data) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (!data || !draft) return <p role="status" className="text-sm text-slate-600">Carregando...</p>;
  if (data.domains_scope.length === 0) return <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Nenhum domínio ativo liberado para você ainda. Fale com o administrador.</p>;

  return (
    <div className="space-y-4">
      <form onSubmit={submit} noValidate className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4" aria-label="Filtros do histórico">
        <label className="block text-sm font-medium text-slate-800 md:col-span-1">Domínio autorizado
          <select value={draft.domain} onChange={set('domain')} className={field}>{data.domains_scope.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        </label>
        <label className="block text-sm font-medium text-slate-800">Pesquisar por
          <select value={draft.by} onChange={set('by')} className={field}><option value="sender">Remetente</option><option value="recipient">Destinatário</option></select>
        </label>
        <label className="block text-sm font-medium text-slate-800 md:col-span-2">E-mail completo
          <input type="email" inputMode="email" value={draft.email} onChange={set('email')} maxLength={254} autoComplete="off" aria-invalid={fieldError ? 'true' : undefined} className={field} />
        </label>
        <label className="block text-sm font-medium text-slate-800">Situação
          <select value={draft.status} onChange={set('status')} className={field}><option>Bloqueados</option><option>Desbloqueados</option><option>Livres</option><option>Todos</option></select>
        </label>
        <label className="block text-sm font-medium text-slate-800">De<input type="date" value={draft.start} onChange={set('start')} className={field} /></label>
        <label className="block text-sm font-medium text-slate-800">Até<input type="date" value={draft.end} onChange={set('end')} className={field} /></label>
        <div className="flex items-end gap-2">
          <button type="submit" className="min-h-9 flex-1 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900">Consultar</button>
          <button type="button" onClick={clear} className="min-h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-blue-800 hover:bg-slate-50">Limpar filtros</button>
        </div>
        <p className="text-xs text-slate-600 md:col-span-4">E-mail opcional. Remetente busca o endereço exato no envelope, From e Reply-To. Período em America/Sao_Paulo, até 31 dias.</p>
        {fieldError && <p role="alert" className="text-sm text-red-800 md:col-span-4">{fieldError}</p>}
      </form>

      <h2 className="text-lg font-semibold text-slate-900">Registros do domínio</h2>
      <SpfblStatusBar state={data.state} busy={busy} onRefresh={refresh} />
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <p role="status" className="text-sm text-slate-700"><strong>{formatNumber(data.filtered_total)}</strong> registros/tentativas com os filtros · <strong>{formatNumber(data.period_total)}</strong> do domínio no período recuperado. {data.state.partial || data.state.loading ? COVERAGE_NOTE : ''}</p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Registros do domínio {data.domain}</caption>
          <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>{['Data e hora', 'Remetente', 'Destinatário', 'Situação', 'Motivo', 'Ações'].map((h) => <th key={h} scope="col" className="px-3 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-200">
            {data.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">Nenhum registro com estes filtros.</td></tr>}
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap px-3 py-3 text-slate-900">{formatEpoch(row.timestamp)}</td>
                <td className="break-all px-3 py-3 text-slate-900">{row.sender || row.from || '—'}</td>
                <td className="break-all px-3 py-3 text-slate-900">{row.recipient}</td>
                <td className="px-3 py-3">
                  <span className={`rounded border px-2 py-1 text-xs font-medium ${row.status === 'Bloqueados' ? 'border-red-700 text-red-800' : 'border-emerald-700 text-emerald-800'}`}>{row.status}</span>
                  {describeRelease(row.release) && (<div className="mt-1"><span className={`rounded border px-2 py-1 text-xs font-medium ${describeRelease(row.release).tone}`}>{describeRelease(row.release).badge}</span><div className="mt-1 text-xs text-slate-600">{describeRelease(row.release).line}</div></div>)}
                </td>
                <td className="px-3 py-3 text-slate-900"><span aria-hidden="true">{REASON_ICONS[row.icon]} </span>{row.reason}</td>
                <td className="px-3 py-3"><button type="button" onClick={() => setSelected(row.id)} className="text-sm text-blue-800 underline">Ver detalhes<span className="sr-only"> de {row.recipient}</span></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.pages > 1 && (
        <nav aria-label="Paginação do histórico" className="flex items-center justify-between gap-3">
          <button type="button" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} className="rounded px-2 py-1 text-sm font-medium text-blue-800 underline disabled:opacity-60">Anterior</button>
          <span className="text-sm text-slate-600">Página {data.page} de {data.pages}</span>
          <button type="button" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)} className="rounded px-2 py-1 text-sm font-medium text-blue-800 underline disabled:opacity-60">Próxima</button>
        </nav>
      )}
    </div>
  );
}
