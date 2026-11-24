import { useEffect, useId } from 'react';
import { listAccess, listDomains } from '../../services/spfblService';
import { EMPTY_SPFBL_ACCESS, MAX_DOMAINS_PER_USER, describeError } from '../../utils/spfbl';
import SpfblAccessFields from './SpfblAccessFields';

// Access to the SPFBL module of ONE account, edited inside the user dialog (Gestão de Equipe). The parent keeps the value and
// saves it together with the user; this component only loads what exists today and edits the draft.
export default function SpfblUserAccess({ userId, eligible, reason, value, onChange }) {
  const id = useId();
  useEffect(() => {
    let active = true;
    Promise.all([listDomains(), userId ? listAccess() : Promise.resolve([])])
      .then(([domains, grants]) => {
        if (!active) return;
        const grant = userId ? grants.find((item) => item.user_id === userId) : null;
        onChange({ loaded: true, had: Boolean(grant), enabled: Boolean(grant), mode: grant?.unlock_mode || 'review', domainIds: (grant?.domains || []).map((d) => d.id), domains, dirty: false, error: '' });
      })
      .catch((error) => { if (active) onChange({ ...EMPTY_SPFBL_ACCESS, error: describeError(error, 'Não foi possível carregar o acesso ao SPFBL.') }); });
    return () => { active = false; };
    // Loads once per dialog (and per target); the parent owns the draft afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const patch = (next) => onChange({ ...value, ...next, dirty: true });
  if (value.error) return <p role="alert" className="text-sm text-red-700">{value.error}</p>;
  if (!value.loaded) return <p role="status" className="text-sm text-slate-600">Carregando...</p>;
  return (
    <div className="space-y-4">
      {!eligible ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{reason}</p>
      ) : (
        <>
          <label className="flex items-start gap-3 rounded-md bg-slate-50 p-3">
            <input type="checkbox" checked={value.enabled} onChange={(event) => patch({ enabled: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            <span><span className="block text-sm font-medium text-slate-700">Dar acesso ao SPFBL</span>
              <span className="block text-xs text-slate-500">O usuário verá só os domínios escolhidos (de 1 a {MAX_DOMAINS_PER_USER}). Vale a cada requisição: ao desmarcar e salvar, ele sai na hora.</span></span>
          </label>
          {value.enabled && (
            <SpfblAccessFields idPrefix={id} mode={value.mode} onModeChange={(mode) => patch({ mode })} selected={value.domainIds} domains={value.domains}
              onSelectedChange={(update) => patch({ domainIds: typeof update === 'function' ? update(value.domainIds) : update })} />
          )}
        </>
      )}
    </div>
  );
}
