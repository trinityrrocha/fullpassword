import { useCallback, useEffect, useRef, useState } from 'react';
import SpfblStatusBar from './SpfblStatusBar';
import SpfblRecord from './SpfblRecord';
import PaginationBar from '../PaginationBar';
import { getHistory, refreshHistory } from '../../services/spfblService';
import { COVERAGE_NOTE, REASON_ICONS, REASON_SHORT, shortAddress, describeError, describeRelease, formatEpochShort, formatIsoShort, formatNumber } from '../../utils/spfbl';

const POLL_MS = 3000;
const field = 'mt-1 w-full min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900';

export default function SpfblHistory() {
  const [applied, setApplied] = useState({});            // what the server last answered with (defaults come from the server)
  const [draft, setDraft] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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
  useEffect(() => { load({ ...applied, page, page_size: pageSize }); return () => { clearTimeout(timer.current); request.current += 1; }; }, [applied, page, pageSize, load]);

  const submit = (event) => { event.preventDefault(); setPage(1); setApplied({ ...draft }); };
  const clear = () => { setDraft(null); setPage(1); setApplied({}); };
  const refresh = async () => {
    setBusy(true);
    try { await refreshHistory(applied); await load({ ...applied, page, page_size: pageSize }); } catch (failure) { setError(describeError(failure, 'Não foi possível atualizar agora.')); } finally { setBusy(false); }
  };
  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  if (selected) return <SpfblRecord id={selected} domain={data?.domain} onBack={() => setSelected(null)} />;
  if (error && !data) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (!data || !draft) return <p role="status" className="text-sm text-slate-600">Carregando...</p>;
  if (data.domains_scope.length === 0) return <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Nenhum domínio ativo liberado para você ainda. Fale com o administrador.</p>;

  return (
    <div className="space-y-4">
      <form onSubmit={submit} noValidate className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-4 xl:grid-cols-[1.3fr_1fr_1.6fr_1fr_1fr_1fr_auto]" aria-label="Filtros do histórico">
        <label className="block text-xs font-medium text-slate-700">Domínio autorizado
          <select value={draft.domain} onChange={set('domain')} className={field}>{data.domains_scope.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Pesquisar por
          <select value={draft.by} onChange={set('by')} className={field}><option value="sender">Remetente</option><option value="recipient">Destinatário</option></select>
        </label>
        <label className="block text-xs font-medium text-slate-700">E-mail completo
          <input type="email" inputMode="email" value={draft.email} onChange={set('email')} maxLength={254} autoComplete="off" aria-invalid={fieldError ? 'true' : undefined} className={field} />
        </label>
        <label className="block text-xs font-medium text-slate-700">Situação
          <select value={draft.status} onChange={set('status')} className={field}><option>Bloqueados</option><option>Desbloqueados</option><option>Livres</option><option>Todos</option></select>
        </label>
        <label className="block text-xs font-medium text-slate-700">De<input type="date" value={draft.start} onChange={set('start')} className={field} /></label>
        <label className="block text-xs font-medium text-slate-700">Até<input type="date" value={draft.end} onChange={set('end')} className={field} /></label>
        <div className="flex items-end gap-2">
          <button type="submit" className="min-h-9 flex-1 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900">Consultar</button>
          <button type="button" onClick={clear} className="min-h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-blue-800 hover:bg-slate-50">Limpar filtros</button>
        </div>
        <p className="col-span-full text-xs text-slate-500">E-mail opcional. Remetente busca o endereço exato no envelope, From e Reply-To. Período em America/Sao_Paulo, até 90 dias (limitado ao tempo de retenção configurado).</p>
        {fieldError && <p role="alert" className="col-span-full text-sm text-red-800">{fieldError}</p>}
      </form>

      <h2 className="text-base font-semibold text-slate-900">Registros do domínio</h2>
      <SpfblStatusBar state={data.state} busy={busy} onRefresh={refresh} />
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <p role="status" className="text-sm text-slate-700"><strong>{formatNumber(data.filtered_total)}</strong> registros/tentativas com os filtros · <strong>{formatNumber(data.period_total)}</strong> do domínio no período recuperado. {data.state.partial || data.state.loading ? COVERAGE_NOTE : ''}</p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full table-fixed min-w-[44rem] whitespace-nowrap text-left text-[13px]">
          <caption className="sr-only">Registros do domínio {data.domain}</caption>
          <colgroup><col className="w-[8.5rem]" /><col /><col className="w-[10rem]" /><col className="w-[17rem]" /><col className="w-[5.5rem]" /></colgroup>
          <thead className="text-[11px] uppercase tracking-wide text-slate-500"><tr className="border-b border-slate-200">{['Data', 'Remetente', 'Destinatário', 'Situação', ''].map((h) => <th key={h || 'acoes'} scope="col" className="px-3 py-2 font-medium">{h || <span className="sr-only">Ações</span>}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-600">Nenhum registro com estes filtros.</td></tr>}
            {data.rows.map((row) => {
              const release = describeRelease(row.release);
              return (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 tabular-nums text-slate-700">{formatEpochShort(row.timestamp)}</td>
                  <td className="truncate px-3 py-2 text-slate-900" title={row.sender || row.from}>{row.sender || row.from || '—'}</td>
                  <td className="truncate px-3 py-2 text-slate-900" title={row.recipient}>{shortAddress(row.recipient)}</td>
                  <td className="overflow-hidden px-3 py-2">
                    <span className="inline-flex max-w-full items-center gap-2 overflow-hidden">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${row.status === 'Bloqueados' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`} title={row.reason}><span aria-hidden="true">{REASON_ICONS[row.icon]}</span>{REASON_SHORT[row.icon] || row.reason}</span>
                      {release && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${release.state === 'unlocked' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`} title={release.line}>{release.badge}{row.release.at ? <span className="ml-1 font-normal text-slate-600">{formatIsoShort(row.release.at)}{row.release.by ? ` · ${row.release.by}` : ''}</span> : null}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right"><button type="button" onClick={() => setSelected(row.id)} className="text-sm text-blue-800 underline">Detalhes<span className="sr-only"> de {row.recipient}</span></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationBar label="Paginação do histórico" page={data.page} pages={data.pages} total={data.filtered_total} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
    </div>
  );
}
