import { useCallback, useEffect, useRef, useState } from 'react';
import { blockRequest, getRequestDetail, keepRequest, listRequests, releaseRequest } from '../../services/spfblService';
import PaginationBar from '../PaginationBar';
import { REQUEST_FILTERS, REQUEST_STATUS_TONE, describeError, formatIsoDateTime, formatIsoShort, paginate } from '../../utils/spfbl';

const Badge = ({ request }) => <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_TONE[request.status] || 'text-slate-800 border-slate-400'}`}>{request.status_label}</span>;

// Admin decision panel for one request: keep the block, release it at the provider, or block again.
function ReviewPanel({ id, onDone, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const lock = useRef(false);
  const close = useRef(null);

  const load = useCallback(async () => { try { setDetail(await getRequestDetail(id)); setError(''); } catch (failure) { setError(describeError(failure, 'Não foi possível abrir a solicitação.')); } }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { close.current?.focus(); }, []);

  const act = async (action, needsConfirm, success) => {
    if (lock.current) return;
    if (needsConfirm && !confirm) { setError('Marque a confirmação para continuar.'); return; }
    lock.current = true; setBusy(true); setError(''); setDone('');
    try {
      await action({ revision: detail.request.revision, notify, proof: detail.confirmation });
      setDone(success); setConfirm(false); await load(); await onDone();
    } catch (failure) { await load(); setError(describeError(failure, 'Não foi possível concluir. Recarregue a solicitação.')); } finally { lock.current = false; setBusy(false); }
  };

  const request = detail?.request;
  return (
    <section className="space-y-3 rounded-lg border border-slate-300 bg-white p-4 shadow-sm" aria-label="Revisão da solicitação">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-900">Revisão da solicitação</h3>
        <button ref={close} type="button" onClick={onClose} className="text-sm text-blue-800 underline">Fechar</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {!detail && !error && <p role="status" className="text-sm text-slate-600">Carregando...</p>}
      {request && (
        <>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-xs text-slate-600">Domínio</dt><dd className="break-all font-mono">{request.domain}</dd></div>
            <div><dt className="text-xs text-slate-600">Solicitante</dt><dd>{request.actor_name || 'Conta removida'}</dd></div>
            <div><dt className="text-xs text-slate-600">Destinatário</dt><dd className="break-all font-mono">{request.recipient}</dd></div>
            <div><dt className="text-xs text-slate-600">Remetente</dt><dd className="break-all font-mono">{request.sender || 'Não informado'}</dd></div>
            <div><dt className="text-xs text-slate-600">Motivo original</dt><dd>{request.reason}</dd></div>
            <div><dt className="text-xs text-slate-600">Situação</dt><dd><Badge request={request} />{request.result_info ? <span className="ml-2 text-xs text-slate-600">{request.result_info}</span> : null}</dd></div>
          </dl>
          {(request.can_release || request.can_block) && (
            <>
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Liberar ou bloquear é enviado ao SPFBL e pode afetar outros destinatários da mesma integração. Se o SPFBL não confirmar, a tentativa fica registrada e não é repetida automaticamente.</p>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} className="mt-1 h-4 w-4" /><span>Entendo o alcance e confirmo a decisão sobre o motivo mostrado acima.</span></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="mt-1 h-4 w-4" /><span>Avisar o solicitante por e-mail (se o SMTP estiver ativo).</span></label>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {request.can_keep && <button type="button" disabled={busy} onClick={() => act((i) => keepRequest(id, i), false, 'Bloqueio mantido. Nada foi enviado ao SPFBL.')} className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">Manter bloqueio</button>}
            {request.can_release && <button type="button" disabled={busy} onClick={() => act((i) => releaseRequest(id, i), true, 'Liberação confirmada pelo SPFBL.')} className="min-h-9 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60">Liberar no SPFBL</button>}
            {request.can_block && <button type="button" disabled={busy} onClick={() => act((i) => blockRequest(id, i), true, 'Bloqueio enviado e confirmado pelo SPFBL.')} className="min-h-9 rounded-md border border-red-700 bg-white px-4 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60">Bloquear novamente</button>}
          </div>
          <div role="status" aria-live="polite">{done && <p className="text-sm font-medium text-emerald-800">{done}</p>}</div>
          {detail.events.length > 0 && (
            <div><h4 className="text-sm font-semibold text-slate-900">Eventos</h4>
              <ul className="mt-1 divide-y divide-slate-200 border-t border-slate-200 text-sm">{detail.events.map((e, index) => <li key={`${e.created_at}-${index}`} className="py-1">{formatIsoDateTime(e.created_at)} · {{ unlocked: 'liberado', kept: 'mantido', reopened: 'bloqueado novamente (confirmado no fornecedor)', reblocked: 'bloqueado novamente' }[e.action] || e.action}{e.actor_name ? ` · ${e.actor_name}` : ''}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function SpfblRequests() {
  const [filter, setFilter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const load = useCallback(async (status) => {
    try { setData(await listRequests(status)); setError(''); } catch (failure) { setError(describeError(failure, 'Não foi possível carregar as solicitações.')); }
  }, []);
  useEffect(() => { load(filter); }, [filter, load]);


  if (error && !data) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-600">Carregando...</p>;
  const admin = data.is_admin;
  const view = paginate(data.requests, page, pageSize);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{admin ? 'Solicitações de revisão' : 'Minhas solicitações'}</h2>
        <label className="text-sm font-medium text-slate-800">Situação
          <select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }} className="ml-2 min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">{REQUEST_FILTERS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {open && <ReviewPanel id={open} onDone={() => load(filter)} onClose={() => setOpen(null)} />}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full table-fixed min-w-[44rem] whitespace-nowrap text-left text-[13px]">
          <caption className="sr-only">{admin ? 'Solicitações de revisão' : 'Minhas solicitações'}</caption>
          <thead className="text-[11px] uppercase tracking-wide text-slate-500"><tr className="border-b border-slate-200">{['Data', ...(admin ? ['Solicitante'] : []), 'Destinatário', 'Remetente', 'Motivo', 'Situação', ...(admin ? [''] : [])].map((h) => <th key={h || 'acoes'} scope="col" className="px-3 py-2 font-medium">{h || <span className="sr-only">Ações</span>}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.requests.length === 0 && <tr><td colSpan={admin ? 7 : 5} className="px-3 py-6 text-center text-slate-600">Nenhuma solicitação.</td></tr>}
            {view.items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 tabular-nums text-slate-700">{formatIsoShort(r.requested_at)}</td>
                {admin && <td className="truncate px-3 py-2" title={r.actor_name || ''}>{r.actor_name || '—'}</td>}
                <td className="truncate px-3 py-2" title={r.recipient}>{r.recipient}</td>
                <td className="truncate px-3 py-2" title={r.sender}>{r.sender || '—'}</td>
                <td className="truncate px-3 py-2 text-slate-700" title={r.reason}>{r.reason}</td>
                <td className="px-3 py-2"><Badge request={r} /></td>
                {admin && <td className="px-3 py-2 text-right"><button type="button" onClick={() => setOpen(r.id)} className="text-blue-800 underline">Revisar<span className="sr-only"> {r.recipient}</span></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar label="Paginação das solicitações" page={view.page} pages={view.pages} total={view.total} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
    </div>
  );
}
