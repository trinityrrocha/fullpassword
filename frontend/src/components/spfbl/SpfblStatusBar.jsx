import { STATE_LABELS, formatIsoDateTime } from '../../utils/spfbl';

// Shared "Atualizar / carregando em etapas / atualizado em" line of the Dashboard and the History.
export default function SpfblStatusBar({ state, busy, onRefresh }) {
  const tone = state?.loading ? 'border-blue-600' : state?.partial ? 'border-red-700' : 'border-emerald-700';
  return (
    <div className={`flex flex-wrap items-center gap-3 border-l-4 bg-white px-3 py-3 ${tone}`}>
      <button type="button" onClick={onRefresh} disabled={busy || state?.loading} className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-blue-800 hover:bg-slate-50 disabled:opacity-60">Atualizar</button>
      <strong role="status" className="text-sm text-slate-900">{STATE_LABELS(state)}</strong>
      {state?.updated_at && <span className="ml-auto text-xs text-slate-600">Atualizado em {formatIsoDateTime(state.updated_at)}</span>}
      {state?.error && <span role="alert" className="basis-full text-sm text-red-800">{state.error}</span>}
    </div>
  );
}
