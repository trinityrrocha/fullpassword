import { useEffect, useState } from 'react';
import FormDialog from '../FormDialog';
import PaginationBar from '../PaginationBar';
import { getSent } from '../../services/spfblService';
import { describeError, formatIsoDateTime, formatNumber } from '../../utils/spfbl';
import { DEFAULT_SENT_FILTERS, PERIOD_OPTIONS, RESULT_OPTIONS, RESULT_TONE_CLASSES, SEARCH_BY_OPTIONS, detailGroups, splitDateTime } from '../../utils/spfblSent';

const field = 'mt-1 w-full min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900';
const HEADERS = ['Evento', 'Remetente', 'Destinatário', 'Data', 'Hora', 'Resultado', ''];

function DetailsDialog({ row, onClose }) {
  return (
    <FormDialog title="Detalhes do envio" description={`${row.event} · ${row.result.label}${row.server ? ` · Servidor ${row.server}` : ''}`} size="xl" guardChanges={false} onClose={onClose}
      footer={<div className="flex justify-end"><button type="button" data-dialog-cancel className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Fechar</button></div>}>
      <div className="space-y-4">
        {detailGroups(row.detail).map(([title, rows]) => (
          <section key={title} aria-label={title}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
            <dl className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[11rem_1fr] gap-3 px-3 py-1.5">
                  <dt className="font-medium text-slate-600">{label}</dt>
                  <dd className="break-words text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </FormDialog>
  );
}

// "Enviados": the mail sent by the chosen domain, read live from its WHM server. Same scope as the received history.
export default function SpfblSent() {
  const [applied, setApplied] = useState({});
  const [draft, setDraft] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const next = await getSent({ ...applied, page, page_size: pageSize });
        if (!active) return;
        setData(next); setError('');
        setDraft((current) => current || { domain: next.domain, ...next.filters });
      } catch (failure) {
        if (active) setError(describeError(failure, 'Não foi possível consultar os e-mails enviados.'));
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [applied, page, pageSize, tick]);

  const submit = (event) => { event.preventDefault(); setPage(1); setLoading(true); setApplied({ ...draft }); };
  const clear = () => { setDraft((current) => ({ domain: current?.domain, ...DEFAULT_SENT_FILTERS })); setPage(1); setLoading(true); setApplied({ domain: draft?.domain }); };
  const refresh = () => { setLoading(true); setTick((value) => value + 1); };
  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  if (error && !data) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (!data || !draft) return <p role="status" className="text-sm text-slate-600">Carregando…</p>;
  if (data.domains_scope.length === 0) return <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Nenhum domínio ativo liberado para você ainda. Fale com o administrador.</p>;

  return (
    <div className="space-y-4">
      <form onSubmit={submit} noValidate className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-3 xl:grid-cols-[1.3fr_1fr_1fr_1.1fr_1.5fr_auto]" aria-label="Filtros dos e-mails enviados">
        <label className="block text-xs font-medium text-slate-700">Domínio
          <select value={draft.domain} onChange={set('domain')} className={field}><option value="all">Todos os domínios</option>{data.domains_scope.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Período
          <select value={draft.period} onChange={set('period')} className={field}>{PERIOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Resultado
          <select value={draft.status} onChange={set('status')} className={field}>{RESULT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Pesquisar por
          <select value={draft.by} onChange={set('by')} className={field}>{SEARCH_BY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Texto
          <input type="search" value={draft.q} onChange={set('q')} maxLength={100} autoComplete="off" placeholder="parte do endereço" className={field} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="min-h-9 flex-1 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900">Consultar</button>
          <button type="button" onClick={clear} className="min-h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-blue-800 hover:bg-slate-50">Limpar</button>
        </div>
        <p className="col-span-full text-xs text-slate-500">Consulta feita ao vivo no servidor WHM do domínio (resposta guardada por 1 minuto) e mostra o que o servidor ainda guarda. Horário de Brasília.</p>
      </form>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {data.servers_failed > 0 && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-sent-servers-failed>
          {data.servers_failed === 1 ? '1 servidor WHM não respondeu' : `${data.servers_failed} servidores WHM não responderam`}: os e-mails dele{data.servers_failed === 1 ? '' : 's'} não aparecem nesta lista.
          {data.servers_failed_names?.length > 0 && <> Servidor{data.servers_failed_names.length === 1 ? '' : 'es'}: {data.servers_failed_names.map((server) => `${server.name} (${server.code})`).join(', ')}.</>}
        </p>
      )}
      {data.truncated && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">O servidor devolveu o limite de registros de algum tipo: pode haver mais e-mails no período. Reduza o período para ver todos.</p>}
      {data.diagnostics && (
        <p className="text-xs text-slate-500" data-sent-diagnostics>
          Diagnóstico (só para o Super Admin): o WHM devolveu {formatNumber(data.diagnostics.returned?.success || 0)} entregues, {formatNumber(data.diagnostics.returned?.defer || 0)} adiados, {formatNumber(data.diagnostics.returned?.failure || 0)} falhas
          {data.diagnostics.returned?.inprogress ? `, ${formatNumber(data.diagnostics.returned.inprogress)} em andamento` : ''}{data.diagnostics.returned?.rejected ? ` e ${formatNumber(data.diagnostics.returned.rejected)} recusados na chegada` : ''}.
          Ficaram de fora {formatNumber(data.diagnostics.other_domain)} de outros domínios, {formatNumber(data.diagnostics.out_of_period)} fora do período e {formatNumber(data.diagnostics.other_type)} que não são envios.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm text-slate-700"><strong>{formatNumber(data.filtered_total)}</strong> {data.filtered_total === 1 ? 'registro' : 'registros'} com os filtros · <strong>{formatNumber(data.period_total)}</strong> do domínio no período{loading ? ' · atualizando…' : ''}</p>
        <button type="button" onClick={refresh} disabled={loading} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Atualizar</button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[56rem] table-fixed whitespace-nowrap text-left text-[13px]">
          <caption className="sr-only">{data.domain === 'all' ? 'E-mails enviados por todos os domínios' : `E-mails enviados pelo domínio ${data.domain}`}</caption>
          <colgroup><col className="w-[8.5rem]" /><col className="w-[16rem]" /><col /><col className="w-[5.5rem]" /><col className="w-[5rem]" /><col className="w-[17rem]" /><col className="w-[5.5rem]" /></colgroup>
          <thead className="text-[11px] uppercase tracking-wide text-slate-500"><tr className="border-b border-slate-200">{HEADERS.map((header) => <th key={header || 'acoes'} scope="col" className="px-3 py-2 font-semibold">{header || <span className="sr-only">Ações</span>}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.length === 0 && <tr><td colSpan={HEADERS.length} className="px-3 py-6 text-center text-slate-600">Nenhum e-mail enviado com estes filtros.</td></tr>}
            {data.rows.map((row) => {
              const when = splitDateTime(row.sent_at);
              return (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="truncate px-3 py-2 text-slate-700" title={row.event}>{row.event}</td>
                  <td className="truncate px-3 py-2 text-slate-900" title={row.sender}>{row.sender || '—'}</td>
                  <td className="truncate px-3 py-2 text-slate-900" title={row.delivered_to && row.delivered_to !== row.recipient ? `${row.recipient} → ${row.delivered_to}` : row.recipient}>{row.recipient || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700" title={formatIsoDateTime(row.sent_at)}>{when.date}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{when.time}</td>
                  <td className="overflow-hidden px-3 py-2">
                    <span className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RESULT_TONE_CLASSES[row.result.tone] || RESULT_TONE_CLASSES.info}`} title={row.detail.message || row.result.label}>{row.result.label}</span>
                  </td>
                  <td className="px-3 py-2 text-right"><button type="button" onClick={() => setSelected(row)} className="text-sm text-blue-800 underline">Detalhes<span className="sr-only"> do envio para {row.recipient}</span></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationBar label="Paginação dos e-mails enviados" page={data.page} pages={data.pages} total={data.filtered_total} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
      {selected && <DetailsDialog row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
