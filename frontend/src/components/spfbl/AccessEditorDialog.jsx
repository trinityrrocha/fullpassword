import { useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import FormDialog from '../FormDialog';
import { saveAccess } from '../../services/spfblService';
import { MAX_DOMAINS_PER_USER, MODE_LABELS, canSaveAccess, describeError, filterDomains, grantableUsers, selectionSummary, toggleId } from '../../utils/spfbl';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const VISIBLE_LIMIT = 50;

// Native controls on purpose (UX contract): a select for the account, radios for the mode, checkboxes for domains.
export default function AccessEditorDialog({ grant, users, grants, domains, onClose, onSaved }) {
  const id = useId();
  const editing = Boolean(grant);
  const [userId, setUserId] = useState(grant?.user_id || '');
  const [mode, setMode] = useState(grant?.unlock_mode || 'review');
  const [selected, setSelected] = useState(() => (grant?.domains || []).map((domain) => domain.id));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const candidates = useMemo(() => grantableUsers(users, grants, grant?.user_id), [users, grants, grant]);
  const matching = useMemo(() => filterDomains(domains, { query }), [domains, query]);
  const visible = matching.slice(0, VISIBLE_LIMIT);
  const valid = canSaveAccess(userId, mode, selected);

  const submit = async (event) => {
    event.preventDefault();
    if (!valid) { setError(`Escolha o usuário, o modo e de 1 a ${MAX_DOMAINS_PER_USER} domínios.`); return; }
    setBusy(true);
    setError('');
    try {
      const saved = await saveAccess(userId, { unlock_mode: mode, domain_ids: selected });
      onSaved(saved);
    } catch (failure) {
      setError(describeError(failure, 'Não foi possível salvar o acesso.'));
      setBusy(false);
    }
  };

  const formId = `${id}-form`;
  return (
    <FormDialog
      title={editing ? 'Editar acesso ao SPFBL' : 'Dar acesso ao SPFBL'}
      description="O usuário verá apenas os domínios escolhidos. O acesso vale a cada requisição: ao revogar, ele sai na hora."
      onClose={onClose}
      busy={busy}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" data-dialog-cancel disabled={busy} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed">Cancelar</button>
          <button type="submit" form={formId} disabled={busy} className="inline-flex min-w-32 items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-70">
            {busy ? <><Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : 'Salvar acesso'}
          </button>
        </div>
      )}
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        {error && <p id={`${id}-error`} role="alert" className="text-sm text-red-700">{error}</p>}

        <div>
          <label htmlFor={`${id}-user`} className="mb-1 block text-sm font-medium text-slate-700">Usuário</label>
          <select id={`${id}-user`} value={userId} disabled={editing || busy} onChange={(event) => setUserId(event.target.value)} className={fieldClass} aria-describedby={error ? `${id}-error` : undefined}>
            <option value="">Selecione um usuário</option>
            {candidates.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}
          </select>
          {!editing && candidates.length === 0 && <p className="mt-1 text-xs text-slate-600">Todos os usuários ativos já têm acesso. O Super Admin não precisa de acesso.</p>}
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Tratamento dos bloqueios</legend>
          <div className="space-y-1">
            {Object.entries(MODE_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} disabled={busy} onChange={() => setMode(value)} className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500" />
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
                  <input type="checkbox" checked={selected.includes(domain.id)} disabled={busy} onChange={() => setSelected((current) => toggleId(current, domain.id))} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className="break-all">{domain.name}</span>
                  {!domain.active && <span className="text-xs text-slate-600">(inativo)</span>}
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-2 text-sm text-slate-600">Nenhum domínio encontrado.</li>}
          </ul>
        </fieldset>
      </form>
    </FormDialog>
  );
}
