import { useCallback, useEffect, useState } from 'react';
import { getAudit } from '../../services/spfblService';
import { describeError, formatIsoShort } from '../../utils/spfbl';

const TONES = { success: 'bg-emerald-50 text-emerald-700', failed: 'bg-red-50 text-red-700', denied: 'bg-amber-50 text-amber-800', blocked: 'bg-amber-50 text-amber-800' };
const MODES = { direct: 'direto', review: 'revisão' };
const PROVIDER = { WHITELISTED: 'liberado', BLOCKED: 'bloqueado', NONE: 'sem regra', UNKNOWN: 'desconhecido' };
const field = 'mt-1 w-full min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900';

// What was recorded for an event, in one short line. Only allow-listed fields ever arrive (server side).
const summarize = (details) => [
  details.domain, details.mode && `modo ${MODES[details.mode]}`, details.provider_status && `SPFBL: ${PROVIDER[details.provider_status]}`,
  details.notification === 'smtp_skipped' && 'e-mail não enviado', details.notification === 'sent' && 'e-mail enviado', details.reason && `motivo ${details.reason}`, details.diagnostic
].filter(Boolean).join(' · ');

// Super Admin: the SPFBL entries of the audit trail.
export default function SpfblAudit() {
  const [draft, setDraft] = useState({ action: '', status: '', domain: '', start: '', end: '' });
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setData(await getAudit({ ...applied, page })); setError(''); } catch (failure) { setError(describeError(failure, 'Não foi possível carregar a auditoria.')); }
  }, [applied, page]);
  useEffect(() => { load(); }, [load]);

  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const submit = (event) => { event.preventDefault(); setPage(1); setApplied(Object.fromEntries(Object.entries(draft).filter(([, value]) => value))); };
  const clear = () => { setDraft({ action: '', status: '', domain: '', start: '', end: '' }); setPage(1); setApplied({}); };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} noValidate aria-label="Filtros da auditoria" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-6">
        <label className="block text-xs font-medium text-slate-700 md:col-span-2">Evento
          <select value={draft.action} onChange={set('action')} className={field}><option value="">Todos</option>{(data?.actions || []).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Situação
          <select value={draft.status} onChange={set('status')} className={field}><option value="">Todas</option><option value="success">Sucesso</option><option value="failed">Falha</option><option value="denied">Negado</option></select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Domínio<input value={draft.domain} onChange={set('domain')} maxLength={253} autoComplete="off" placeholder="exemplo.com.br" className={field} /></label>
        <label className="block text-xs font-medium text-slate-700">De<input type="date" value={draft.start} onChange={set('start')} className={field} /></label>
        <label className="block text-xs font-medium text-slate-700">Até<input type="date" value={draft.end} onChange={set('end')} className={field} /></label>
        <div className="flex gap-2 md:col-span-6">
          <button type="submit" className="min-h-9 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900">Filtrar</button>
          <button type="button" onClick={clear} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-blue-800 hover:bg-slate-50">Limpar</button>
        </div>
      </form>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {!data && !error && <p role="status" className="text-sm text-slate-600">Carregando...</p>}
      {data && (
        <>
          <p role="status" className="text-xs text-slate-600">{data.total} eventos{data.total ? ` · página ${data.page} de ${data.pages}` : ''}. Sem senhas, tokens ou chaves do fornecedor.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full table-fixed min-w-[48rem] whitespace-nowrap text-[13px]">
              <caption className="sr-only">Auditoria do SPFBL</caption>
              <colgroup><col className="w-[8.5rem]" /><col className="w-[12rem]" /><col className="w-[13rem]" /><col className="w-[6rem]" /><col /></colgroup>
              <thead className="text-[11px] uppercase tracking-wide text-slate-500"><tr className="border-b border-slate-200">{['Data', 'Evento', 'Usuário', 'Situação', 'Detalhes'].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.events.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-600">Nenhum evento com estes filtros.</td></tr>}
                {data.events.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 tabular-nums text-slate-700">{formatIsoShort(e.at)}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{e.label}</td>
                    <td className="truncate px-3 py-2 text-slate-700" title={e.user || ''}>{e.user || '—'}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONES[e.status] || 'bg-slate-100 text-slate-700'}`}>{e.status_label}</span></td>
                    <td className="truncate px-3 py-2 text-slate-600" title={summarize(e.details)}>{summarize(e.details) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.pages > 1 && (
            <nav aria-label="Paginação da auditoria" className="flex items-center justify-between gap-3">
              <button type="button" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} className="rounded px-2 py-1 text-sm font-medium text-blue-800 underline disabled:opacity-60">Anterior</button>
              <span className="text-xs text-slate-600">Página {data.page} de {data.pages}</span>
              <button type="button" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)} className="rounded px-2 py-1 text-sm font-medium text-blue-800 underline disabled:opacity-60">Próxima</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
