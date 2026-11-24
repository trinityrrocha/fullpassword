import { useMemo, useState } from 'react';
import { MAX_DOMAINS_PER_USER, MODE_LABELS, filterDomains, selectionSummary, toggleId } from '../../utils/spfbl';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const VISIBLE_LIMIT = 50;

// The mode and the domains of an SPFBL grant. Shared by the access dialog and the user dialog (Gestão de Equipe).
// Native controls on purpose (UX contract): radios for the mode, checkboxes for domains.
export default function SpfblAccessFields({ idPrefix, mode, onModeChange, selected, onSelectedChange, domains, busy = false }) {
  const [query, setQuery] = useState('');
  const matching = useMemo(() => filterDomains(domains, { query }), [domains, query]);
  const visible = matching.slice(0, VISIBLE_LIMIT);
  return (
    <>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Tratamento dos bloqueios</legend>
        <div className="space-y-1">
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name={`${idPrefix}-mode`} value={value} checked={mode === value} disabled={busy} onChange={() => onModeChange(value)} className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Domínios permitidos (de 1 a {MAX_DOMAINS_PER_USER})</legend>
        <label className="block text-sm text-slate-700">
          <span className="sr-only">Filtrar domínios</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar domínios" maxLength={100} autoComplete="off" className={fieldClass} />
        </label>
        <p role="status" className="mt-2 text-xs text-slate-600">
          {selectionSummary(selected.length)}.{matching.length > VISIBLE_LIMIT ? ` Mostrando ${VISIBLE_LIMIT} de ${matching.length}: refine o filtro.` : ''}
        </p>
        <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {visible.map((domain) => (
            <li key={domain.id}>
              <label className="flex items-center gap-2 px-3 py-2 text-sm text-slate-800">
                <input type="checkbox" checked={selected.includes(domain.id)} disabled={busy} onChange={() => onSelectedChange((current) => toggleId(current, domain.id))} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="break-all">{domain.name}</span>
                {!domain.active && <span className="text-xs text-slate-600">(inativo)</span>}
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="px-3 py-2 text-sm text-slate-600">Nenhum domínio encontrado.</li>}
        </ul>
      </fieldset>
    </>
  );
}
