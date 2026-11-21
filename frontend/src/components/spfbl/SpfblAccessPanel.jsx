import { useId, useState } from 'react';
import { Users } from 'lucide-react';
import AccessEditorDialog from './AccessEditorDialog';
import { revokeAccess } from '../../services/spfblService';
import { MODE_LABELS, describeError } from '../../utils/spfbl';

const primaryButton = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
const linkButton = 'rounded px-2 py-1 text-sm font-medium text-indigo-700 underline hover:bg-slate-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600';
const CHIP_LIMIT = 5;

export default function SpfblAccessPanel({ grants, users, domains, loadError, onReload }) {
  const id = useId();
  const [editor, setEditor] = useState(null); // { grant } while open
  const [confirmingId, setConfirmingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const revoke = async (grant) => {
    setBusy(true);
    setMessage({ type: '', text: '' });
    try {
      await revokeAccess(grant.user_id);
      setConfirmingId(null);
      await onReload();
      setMessage({ type: 'success', text: `Acesso de ${grant.name} revogado.` });
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível revogar o acesso.') });
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-labelledby={`${id}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id={`${id}-title`} className="flex items-center text-base font-semibold text-slate-900"><Users className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />Acessos de usuários</h2>
          <p className="mt-1 text-sm text-slate-600">Contas do FullPassword que podem abrir o SPFBL, com os domínios que podem ver. Não há uma segunda senha: valem o login, o MFA e a auditoria do FullPassword.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => setEditor({ grant: null })} className={primaryButton}>Dar acesso</button>
      </header>
      <div className="space-y-3 p-4">
        {loadError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</p>}
        {grants.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum usuário com acesso além do Super Admin.</p>
        ) : (
          <ul className="space-y-3" aria-label="Usuários com acesso ao SPFBL">
            {grants.map((grant) => (
              <li key={grant.user_id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{grant.name} {!grant.user_active && <span className="text-xs font-medium text-amber-800">(conta inativa: sem acesso)</span>}</p>
                    <p className="break-all text-xs text-slate-600">{grant.email}</p>
                    <p className="mt-1 text-xs text-slate-700">{MODE_LABELS[grant.unlock_mode]}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <button type="button" disabled={busy} onClick={() => setEditor({ grant })} aria-label={`Editar acesso de ${grant.name}`} className={linkButton}>Editar</button>
                    {confirmingId === grant.user_id ? (
                      <span className="flex items-center gap-1">
                        <span className="text-sm text-slate-700">Revogar o acesso de {grant.name}?</span>
                        <button type="button" disabled={busy} onClick={() => revoke(grant)} className={linkButton}>Confirmar</button>
                        <button type="button" disabled={busy} onClick={() => setConfirmingId(null)} className={linkButton}>Cancelar</button>
                      </span>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => setConfirmingId(grant.user_id)} aria-label={`Revogar acesso de ${grant.name}`} className={linkButton}>Revogar</button>
                    )}
                  </div>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1" aria-label={`Domínios de ${grant.name}`}>
                  {grant.domains.slice(0, CHIP_LIMIT).map((domain) => <li key={domain.id} className="break-all rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-800">{domain.name}</li>)}
                  {grant.domains.length > CHIP_LIMIT && <li className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-800">+{grant.domains.length - CHIP_LIMIT}</li>}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {message.text && (
          <p role={message.type === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{message.text}</p>
        )}
      </div>
      {editor && (
        <AccessEditorDialog
          grant={editor.grant}
          users={users}
          grants={grants}
          domains={domains}
          onClose={() => setEditor(null)}
          onSaved={async (saved) => { setEditor(null); await onReload(); setMessage({ type: 'success', text: `Acesso de ${saved.name} salvo.` }); }}
        />
      )}
    </section>
  );
}
