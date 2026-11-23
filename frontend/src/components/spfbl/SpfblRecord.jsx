import { useEffect, useRef, useState } from 'react';
import { checkRecordStatus, getRecord } from '../../services/spfblService';
import { REASON_ICONS, describeError, formatEpoch } from '../../utils/spfbl';

const Item = ({ label, children }) => (<div><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 break-all font-mono text-sm text-slate-900">{children}</dd></div>);

// "Detalhes do registro": the original provider result plus a read-only current-status lookup.
export default function SpfblRecord({ id, domain, onBack }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const back = useRef(null);
  useEffect(() => {
    let active = true;
    getRecord(id, domain).then((data) => { if (active) setRecord(data.record); }).catch((failure) => { if (active) setError(describeError(failure, 'Registro indisponível. Atualize a consulta.')); });
    return () => { active = false; };
  }, [id, domain]);
  useEffect(() => { back.current?.focus(); }, []);

  const check = async () => {
    if (busy) return;
    setBusy(true); setStatus(null);
    try { setStatus({ ok: await checkRecordStatus(id, domain) }); } catch (failure) { setStatus({ error: describeError(failure, 'Não foi possível consultar o status agora.') }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <button ref={back} type="button" onClick={onBack} className="text-sm text-blue-800 underline">← Voltar ao histórico</button>
      <h2 className="text-xl font-bold text-slate-900">Detalhes do registro</h2>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!record && !error && <p role="status" className="text-sm text-slate-600">Carregando...</p>}
      {record && (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label="Registro">
            <span className={`inline-block rounded border px-2 py-1 text-xs font-medium ${record.status === 'Bloqueados' ? 'border-red-700 text-red-800' : 'border-emerald-700 text-emerald-800'}`}>{record.status}</span>
            <h3 className="mt-2 text-lg font-semibold text-slate-900"><span aria-hidden="true">{REASON_ICONS[record.icon]} </span>{record.reason}</h3>
            <dl className="mt-4 grid gap-4 md:grid-cols-2">
              <Item label="Destinatário">{record.recipient}</Item>
              <Item label="Remetente do envelope">{record.sender || 'Não informado'}</Item>
              <Item label="From">{record.from || 'Não informado'}</Item>
              <Item label="Reply-To">{record.replyto || 'Não informado'}</Item>
              <Item label="Resultado original">{record.result || '—'}</Item>
              <Item label="Data e hora">{formatEpoch(record.timestamp)}</Item>
            </dl>
            <p className="mt-4 text-xs text-slate-600">O código original é mantido. A categoria segue a regra de compatibilidade do produto e não comprova entrega na caixa postal.</p>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="spfbl-status-title">
            <h3 id="spfbl-status-title" className="text-lg font-semibold text-slate-900">Situação atual no SPFBL</h3>
            <p className="mt-1 text-sm text-slate-600">A consulta verifica a regra atual do registro no fornecedor. O motivo original do e-mail continua preservado.</p>
            <button type="button" onClick={check} disabled={busy} className="mt-3 min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-blue-800 hover:bg-slate-50 disabled:opacity-60">{busy ? 'Consultando…' : 'Consultar status atual'}</button>
            <div role="status" className="mt-3 text-sm text-slate-900">
              {status?.ok && <p><strong>{status.ok.label}.</strong>{status.ok.changed_reason ? ' O motivo no fornecedor mudou desde o histórico; atualize a consulta.' : ''}</p>}
              {status?.error && <p role="alert" className="text-red-800">{status.error}</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
