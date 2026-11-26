import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import FormDialog from '../FormDialog';
import { CARD_ICONS } from './cardMeta';
import { CARD_IDS, CARD_TITLES, DEFAULT_LAYOUT, moveStep, normalizeLayout, sameLayout } from '../../utils/dashboard';

const primaryButton = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';
const secondaryButton = 'rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';
const stepButton = 'rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600';

// Which cards to show and in which order. The same order the page uses; here it is edited with checkboxes and arrows (no dragging needed).
export default function DashboardSettingsDialog({ layout, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeLayout(layout));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (id) => setDraft((current) => ({ ...current, hidden: current.hidden.includes(id) ? current.hidden.filter((item) => item !== id) : [...current.hidden, id] }));
  // In this list every card is shown, so a step is a step among all of them.
  const step = (id, delta) => setDraft((current) => {
    const all = { ...current, hidden: [] };
    return { ...moveStep(all, id, delta), hidden: current.hidden };
  });
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await onSave(draft); onClose(); } catch { setError('Não foi possível salvar a disposição.'); } finally { setBusy(false); }
  };
  return (
    <FormDialog title="Configurar dashboard" description="Escolha os cartões exibidos e a ordem. Você também pode arrastar os cartões na própria página." onClose={onClose} busy={busy} guardChanges={false}
      footer={<div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" disabled={busy || sameLayout(draft, DEFAULT_LAYOUT)} onClick={() => setDraft(normalizeLayout(null))} className={secondaryButton}>Restaurar padrão</button>
        <span className="flex gap-2"><button type="button" data-dialog-cancel disabled={busy} className={secondaryButton}>Cancelar</button><button type="submit" form="dashboard-settings-form" disabled={busy} className={primaryButton}>{busy ? 'Salvando…' : 'Salvar'}</button></span>
      </div>}>
      <form id="dashboard-settings-form" onSubmit={save} noValidate>
        <ol className="divide-y divide-slate-100" aria-label="Cartões do dashboard">
          {draft.order.filter((id) => CARD_IDS.includes(id)).map((id, index, list) => {
            const Icon = CARD_ICONS[id];
            return (
              <li key={id} className="flex items-center gap-3 py-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm font-medium text-slate-800">
                  <input type="checkbox" checked={!draft.hidden.includes(id)} onChange={() => toggle(id)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                  <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="truncate">{CARD_TITLES[id]}</span>
                </label>
                <span className="flex shrink-0">
                  <button type="button" disabled={index === 0} onClick={() => step(id, -1)} aria-label={`Mover ${CARD_TITLES[id]} para cima`} className={stepButton}><ChevronUp className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" disabled={index === list.length - 1} onClick={() => step(id, 1)} aria-label={`Mover ${CARD_TITLES[id]} para baixo`} className={stepButton}><ChevronDown className="h-4 w-4" aria-hidden="true" /></button>
                </span>
              </li>
            );
          })}
        </ol>
        {draft.hidden.length === CARD_IDS.length && <p role="status" className="mt-3 text-sm text-amber-800">Todos os cartões estão ocultos: o dashboard ficará vazio.</p>}
        {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </form>
    </FormDialog>
  );
}
