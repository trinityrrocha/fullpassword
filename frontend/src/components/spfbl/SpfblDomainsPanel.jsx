import { useId, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import DomainBadge from './DomainBadge';
import { addDomain, removeDomain } from '../../services/spfblService';
import { describeError, filterDomains, paginate } from '../../utils/spfbl';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const primaryButton = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
const linkButton = 'rounded px-2 py-1 text-sm font-medium text-indigo-700 underline hover:bg-slate-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600';

// The catalogue may hold thousands of domains: filtered and paginated, never rendered whole.
export default function SpfblDomainsPanel({ domains, loadError, onReload }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  const filtered = useMemo(() => filterDomains(domains, { query, status }), [domains, query, status]);
  const view = paginate(filtered, page);

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage({ type: '', text: '' });
    try {
      const created = await addDomain(newName);
      setNewName('');
      await onReload();
      setMessage({ type: 'success', text: `${created.name} cadastrado.` });
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível cadastrar o domínio.') });
    } finally { setBusy(false); }
  };

  const remove = async (domain) => {
    setBusy(true);
    setMessage({ type: '', text: '' });
    try {
      await removeDomain(domain.id);
      setConfirmingId(null);
      await onReload();
      setMessage({ type: 'success', text: `${domain.name} removido.` });
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível remover o domínio.') });
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-labelledby={`${id}-title`}>
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 id={`${id}-title`} className="flex items-center text-base font-semibold text-slate-900"><Globe className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />Domínios</h2>
        <p className="mt-1 text-sm text-slate-600">Catálogo de domínios do módulo: importados do WHM (somente os de contas não suspensas ficam ativos) ou cadastrados à mão.</p>
      </header>
      <div className="space-y-4 p-4">
        {loadError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</p>}

        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={add} noValidate>
          <label className="flex-1 text-sm font-medium text-slate-700">
            Cadastrar domínio à mão
            <input type="text" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={253} autoComplete="off" spellCheck={false} placeholder="exemplo.com.br" className={`${fieldClass} mt-1`} />
          </label>
          <button type="submit" disabled={busy || !newName.trim()} className={primaryButton}>Cadastrar</button>
        </form>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">
            Buscar por domínio ou conta cPanel
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} maxLength={100} autoComplete="off" className={`${fieldClass} mt-1`} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Situação
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={`${fieldClass} mt-1`}>
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
              <option value="whm">Importados do WHM</option>
              <option value="manual">Cadastrados à mão</option>
            </select>
          </label>
        </div>

        <p role="status" className="text-sm text-slate-600">
          {domains.length === 0 ? 'Nenhum domínio no catálogo. Sincronize com o WHM ou cadastre um domínio.' : `${view.total} de ${domains.length} domínios${view.total ? ` · página ${view.page} de ${view.pages}` : ''}.`}
        </p>

        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200" aria-label="Domínios do catálogo">
          {view.items.map((domain) => (
            <li key={domain.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-slate-900">{domain.name}</p>
                <p className="text-xs text-slate-600">{domain.source === 'whm' ? `WHM${domain.cpanel_user ? ` · conta ${domain.cpanel_user}` : ''}` : 'Cadastrado à mão'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DomainBadge domain={domain} />
                {domain.source === 'manual' && (confirmingId === domain.id ? (
                  <span className="flex items-center gap-1">
                    <span className="text-sm text-slate-700">Remover {domain.name}?</span>
                    <button type="button" disabled={busy} onClick={() => remove(domain)} className={linkButton}>Confirmar</button>
                    <button type="button" disabled={busy} onClick={() => setConfirmingId(null)} className={linkButton}>Cancelar</button>
                  </span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setConfirmingId(domain.id)} aria-label={`Remover ${domain.name}`} className={linkButton}>Remover</button>
                ))}
              </div>
            </li>
          ))}
        </ul>

        {view.pages > 1 && (
          <nav aria-label="Paginação de domínios" className="flex items-center justify-between gap-3">
            <button type="button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)} className={linkButton}>Anterior</button>
            <span className="text-sm text-slate-600">Página {view.page} de {view.pages}</span>
            <button type="button" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} className={linkButton}>Próxima</button>
          </nav>
        )}

        {message.text && (
          <p role={message.type === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{message.text}</p>
        )}
      </div>
    </section>
  );
}
