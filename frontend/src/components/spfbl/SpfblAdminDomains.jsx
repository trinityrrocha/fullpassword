import { useEffect, useMemo, useState } from 'react';
import { getAdminDomains } from '../../services/spfblService';
import { describeError, formatDay, formatNumber, paginate } from '../../utils/spfbl';

const Num = ({ value, tone = '' }) => <td className={`px-3 py-2 text-right tabular-nums ${value ? tone : 'text-slate-400'}`}>{formatNumber(value)}</td>;

// Super Admin: the results of EVERY registered domain over the dashboard window, one line per domain.
export default function SpfblAdminDomains() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    getAdminDomains().then((value) => { if (active) setData(value); }).catch((failure) => { if (active) setError(describeError(failure, 'Não foi possível carregar os domínios.')); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => (data?.domains || []).filter((d) => d.domain.includes(query.trim().toLowerCase()) && (!onlyBlocked || d.blocked > 0)), [data, query, onlyBlocked]);
  const view = paginate(filtered, page);
  if (error) return <p role="alert" className="text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-600">Carregando domínios...</p>;

  return (
    <section className="space-y-3" aria-labelledby="spfbl-domains-overview">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="spfbl-domains-overview" className="text-base font-semibold text-slate-900">Todos os domínios cadastrados</h3>
          <p className="text-xs text-slate-600">{formatDay(data.period.start)} a {formatDay(data.period.end)} · {formatNumber(data.domains.length)} domínios · {formatNumber(data.totals.total)} tentativas · {formatNumber(data.totals.blocked)} bloqueios{data.state.loading ? ' · carregando' : data.state.partial ? ' · cobertura parcial' : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-slate-700"><span className="sr-only">Buscar domínio</span>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar domínio" maxLength={100} autoComplete="off" className="min-h-9 w-48 rounded-md border border-slate-300 bg-white px-3 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={onlyBlocked} onChange={(event) => { setOnlyBlocked(event.target.checked); setPage(1); }} className="h-4 w-4" />Só com bloqueios</label>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full whitespace-nowrap text-[13px]">
          <caption className="sr-only">Resultados por domínio cadastrado</caption>
          <thead className="text-[11px] uppercase tracking-wide text-slate-500"><tr className="border-b border-slate-200">
            <th scope="col" className="px-3 py-2 text-left font-medium">Domínio</th>
            {['Tentativas', 'Bloqueios', 'Banimento', 'Segurança', 'Inexistência', 'Desbloqueios', 'Pendentes'].map((h) => <th key={h} scope="col" className="px-3 py-2 text-right font-medium">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {view.items.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-600">Nenhum domínio.</td></tr>}
            {view.items.map((d) => (
              <tr key={d.domain} className="hover:bg-slate-50">
                <th scope="row" className="px-3 py-2 text-left font-medium text-slate-900">{d.domain}{!d.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600">inativo</span>}</th>
                <Num value={d.total} /><Num value={d.blocked} tone="font-semibold text-red-700" />
                <Num value={d.banimento} /><Num value={d['segurança']} /><Num value={d['inexistência']} />
                <Num value={d.unlocked} tone="text-emerald-700" /><Num value={d.pending} tone="font-semibold text-amber-700" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.pages > 1 && (
        <nav aria-label="Paginação dos domínios" className="flex items-center justify-between gap-3">
          <button type="button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)} className="rounded px-2 py-1 text-sm font-medium text-blue-800 underline disabled:opacity-60">Anterior</button>
          <span className="text-xs text-slate-600">Página {view.page} de {view.pages}</span>
          <button type="button" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} className="rounded px-2 py-1 text-sm font-medium text-blue-800 underline disabled:opacity-60">Próxima</button>
        </nav>
      )}
    </section>
  );
}
