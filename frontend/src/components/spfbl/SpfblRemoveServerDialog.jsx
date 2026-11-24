import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import FormDialog from '../FormDialog';
import { removeWhmServer } from '../../services/spfblService';
import { describeError, removalSummary } from '../../utils/spfbl';

// Removing a server needs an explicit answer about its domains: there is no default, so nothing is removed by a stray click.
export default function SpfblRemoveServerDialog({ server, onClose, onRemoved }) {
  const id = useId();
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (!choice) return;
    setBusy(true); setError('');
    try { onRemoved(await removeWhmServer(server.id, choice === 'remove')); } catch (failure) { setError(describeError(failure, 'Não foi possível remover o servidor.')); setBusy(false); }
  };
  return (
    <FormDialog title={`Remover o servidor ${server.name}?`} onClose={onClose} busy={busy} child guardChanges={false}
      description={`${removalSummary(server)} Deseja remover os domínios vinculados a ele?`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" data-dialog-cancel data-initial-focus disabled={busy} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={confirm} disabled={busy || !choice} className="inline-flex min-w-32 items-center justify-center rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60">
            {busy ? <><Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Removendo...</> : 'Remover servidor'}
          </button>
        </div>
      )}>
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <fieldset className="space-y-2">
          <legend className="sr-only">O que fazer com os domínios vinculados</legend>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="radio" name={`${id}-choice`} value="remove" checked={choice === 'remove'} onChange={() => setChoice('remove')} disabled={busy} className="mt-0.5 h-4 w-4 border-slate-300 text-red-700" />
            <span><strong>Sim, remover</strong> os domínios importados deste servidor (e os acessos dos usuários a eles). Domínios cadastrados à mão são mantidos.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="radio" name={`${id}-choice`} value="keep" checked={choice === 'keep'} onChange={() => setChoice('keep')} disabled={busy} className="mt-0.5 h-4 w-4 border-slate-300 text-indigo-600" />
            <span><strong>Não, manter</strong> os domínios: ficam como <em>sem servidor de consulta</em> e os usuários continuam vendo apenas o histórico já coletado (sem desbloquear ou bloquear).</span>
          </label>
        </fieldset>
        <p className="text-xs text-slate-600">A conexão Matrix deste servidor também é removida. O histórico já coletado é guardado pelo período de retenção.</p>
      </div>
    </FormDialog>
  );
}
