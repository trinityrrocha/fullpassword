import { useEffect, useId } from 'react';
import SpfblAccessFields from '../spfbl/SpfblAccessFields';
import { listAccessDomains, listDomainAccess } from '../../services/domainManagerService';
import { describeError } from '../../utils/spfbl';
import { EMPTY_DM_ACCESS, MAX_DOMAINS_PER_USER } from '../../utils/domainManager';

// Domain Manager access of ONE account, edited inside the user dialog (Gestão de Equipe). Like the SPFBL tab, the parent keeps the
// draft and saves it together with the user; this component only loads what exists today and edits the draft. Read-only access.
export default function DomainManagerUserAccess({ userId, eligible, reason, value, onChange }) {
  const id = useId();
  useEffect(() => {
    let active = true;
    Promise.all([listAccessDomains(), userId ? listDomainAccess() : Promise.resolve([])])
      .then(([names, grants]) => {
        if (!active) return;
        const grant = userId ? grants.find((item) => item.user_id === userId) : null;
        // The shared picker shows "(inativo)" for domains without `active`: every Domain Manager domain is simply listed.
        onChange({ loaded: true, had: Boolean(grant), enabled: Boolean(grant), domainIds: (grant?.domains || []).map((d) => d.id), domains: names.map((d) => ({ ...d, active: true })), dirty: false, error: '' });
      })
      .catch((error) => { if (active) onChange({ ...EMPTY_DM_ACCESS, error: describeError(error, 'Não foi possível carregar o acesso ao Domain Manager.') }); });
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
            <span><span className="block text-sm font-medium text-slate-700">Dar acesso ao Domain Manager</span>
              <span className="block text-xs text-slate-500">Somente leitura: o usuário vê, abre os detalhes e consulta só os domínios escolhidos (de 1 a {MAX_DOMAINS_PER_USER}). Não cadastra, não remove e não configura alertas. Vale a cada requisição: ao desmarcar e salvar, ele sai na hora.</span></span>
          </label>
          {value.enabled && (
            <SpfblAccessFields idPrefix={id} showMode={false} legend={`Domínios liberados (de 1 a ${MAX_DOMAINS_PER_USER})`} selected={value.domainIds} domains={value.domains}
              onSelectedChange={(update) => patch({ domainIds: typeof update === 'function' ? update(value.domainIds) : update })} />
          )}
        </>
      )}
    </div>
  );
}
