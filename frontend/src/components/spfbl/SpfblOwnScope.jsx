import { useMemo, useState } from 'react';
import DomainBadge from './DomainBadge';
import { MODE_LABELS, filterDomains, paginate } from '../../utils/spfbl';

// What a granted (non-Super-Admin) account sees: only its own scope, read-only.
export default function SpfblOwnScope({ overview }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterDomains(overview.domains, { query }), [overview.domains, query]);
  const view = paginate(filtered, page);
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-labelledby="spfbl-own-title">
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 id="spfbl-own-title" className="text-base font-semibold text-slate-900">Seus domínios</h2>
        <p className="mt-1 text-sm text-slate-600">Modo de tratamento dos bloqueios: <strong>{MODE_LABELS[overview.unlock_mode]}</strong>.</p>
      </header>
      <div className="space-y-4 p-4">
        {overview.domains.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum domínio liberado para você ainda. Fale com o administrador.</p>
        ) : (
          <>
            <label className="block text-sm font-medium text-slate-700">
              Buscar domínio
              <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} maxLength={100} autoComplete="off" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
            </label>
            <p role="status" className="text-sm text-slate-600">{view.total} de {overview.domains.length} domínios.</p>
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200" aria-label="Seus domínios">
              {view.items.map((domain) => (
                <li key={domain.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="break-all text-sm font-medium text-slate-900">{domain.name}</span>
                  <DomainBadge domain={{ ...domain, source: 'manual' }} />
                </li>
              ))}
            </ul>
            {view.pages > 1 && (
              <nav aria-label="Paginação de domínios" className="flex items-center justify-between gap-3">
                <button type="button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)} className="rounded px-2 py-1 text-sm font-medium text-indigo-700 underline disabled:opacity-60">Anterior</button>
                <span className="text-sm text-slate-600">Página {view.page} de {view.pages}</span>
                <button type="button" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} className="rounded px-2 py-1 text-sm font-medium text-indigo-700 underline disabled:opacity-60">Próxima</button>
              </nav>
            )}
          </>
        )}
      </div>
    </section>
  );
}
