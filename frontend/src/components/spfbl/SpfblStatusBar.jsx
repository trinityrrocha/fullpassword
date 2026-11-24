import { STATE_LABELS, formatIsoDateTime, formatIsoShort } from '../../utils/spfbl';

// Shared "Atualizar / carregando em etapas / atualizado em" line of the Dashboard and the History.
export default function SpfblStatusBar({ state, busy, onRefresh }) {
  const tone = state?.loading ? 'border-blue-600' : state?.partial ? 'border-red-700' : 'border-emerald-700';
  return (
    <div className={`flex flex-wrap items-center gap-3 border-l-4 bg-white px-3 py-3 ${tone}`}>
      <button type="button" onClick={onRefresh} disabled={busy || state?.loading} className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-blue-800 hover:bg-slate-50 disabled:opacity-60">Atualizar</button>
      <strong role="status" className="text-sm text-slate-900">{STATE_LABELS(state)}</strong>
      {state?.updated_at && <span className="ml-auto text-xs text-slate-600">Atualizado em {formatIsoDateTime(state.updated_at)}</span>}
      {state?.since && <span className="text-xs text-slate-600">Armazenado desde {formatIsoShort(state.since).slice(0, 8)}</span>}
      {state?.gap_before && (
        <span role="alert" className="basis-full text-sm text-red-800">
          Possível perda de registros anteriores a {formatIsoShort(state.gap_before).slice(0, 8)}: o Matrix mostra só os últimos 1024 registros do servidor e a coleta anterior não os alcançou. Use um intervalo de coleta menor.
        </span>
      )}
      {!state?.gap_before && state?.provider_limit && !state?.loading && <span className="basis-full text-xs text-slate-600">O Matrix devolveu o limite de 1024 registros: períodos antes de {state?.since ? formatIsoShort(state.since).slice(0, 8) : 'a primeira coleta'} podem estar incompletos.</span>}
      {state?.error && <span role="alert" className="basis-full text-sm text-red-800">{state.error}</span>}
    </div>
  );
}
