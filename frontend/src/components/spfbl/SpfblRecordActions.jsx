import { useRef, useState } from 'react';
import { blockSender, requestReview, unlockRecord } from '../../services/spfblService';
import { EVENT_LABELS, describeError, describeRelease, formatIsoDateTime } from '../../utils/spfbl';

const Box = ({ title, children, tone = 'border-slate-200' }) => (<section className={`rounded-lg border bg-white p-4 shadow-sm ${tone}`} aria-label={title}><h3 className="text-lg font-semibold text-slate-900">{title}</h3><div className="mt-2 space-y-3 text-sm text-slate-800">{children}</div></section>);

// What the person can do with one blocked record, decided by the server (can_request / can_unlock) and shown here.
export default function SpfblRecordActions({ record, domain, state, onChanged }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const lock = useRef(false);

  const run = async (kind, action, success) => {
    if (lock.current) return;
    if (!confirm) { setMessage({ kind, error: 'Marque a confirmação para continuar.' }); return; }
    lock.current = true; setBusy(true); setMessage(null);
    try { await action(); setMessage({ kind, ok: success }); setConfirm(false); await onChanged(); } catch (failure) { setMessage({ kind, error: describeError(failure, 'Não foi possível concluir. Atualize o registro e tente de novo.') }); await onChanged().catch(() => {}); } finally { lock.current = false; setBusy(false); }
  };

  // A result is shown only inside the box of the action that produced it (a box can disappear after its own success).
  const statusFor = (kind) => (
    <div role="status" aria-live="polite">
      {message?.kind === kind && message.ok && <p className="font-medium text-emerald-800">{message.ok}</p>}
      {message?.kind === kind && message.error && <p role="alert" className="text-red-800">{message.error}</p>}
    </div>
  );

  return (
    <>
      {state.operation.uncertain && (
        <Box title="Resultado não confirmado" tone="border-red-300">
          <p>Há uma tentativa com resultado não confirmado pelo SPFBL. Ela <strong>não será repetida automaticamente</strong>. Use “Consultar status atual” e, se persistir, fale com o administrador.</p>
        </Box>
      )}
      {state.release && (
        <Box title={state.release.state === 'unlocked' ? 'Remetente desbloqueado' : 'Remetente bloqueado novamente'} tone={state.release.state === 'unlocked' ? 'border-emerald-300' : 'border-slate-300'}>
          {state.release.state === 'unlocked' ? (
            <p>Este registro <strong>estava bloqueado</strong> ({record.reason}) e <strong>agora está desbloqueado</strong>. {describeRelease(state.release).line}.</p>
          ) : (
            <p>Este remetente foi desbloqueado{state.release.unlocked_at ? ` em ${formatIsoDateTime(state.release.unlocked_at)}${state.release.unlocked_by ? ` por ${state.release.unlocked_by}` : ''}` : ''} e <strong>está bloqueado novamente</strong>. {describeRelease(state.release).line}.</p>
          )}
          {state.events?.length > 0 && (
            <div><h4 className="text-sm font-semibold text-slate-900">Histórico de ações</h4>
              <ul className="mt-1 divide-y divide-slate-200 border-t border-slate-200">{state.events.map((e, index) => <li key={`${e.at}-${index}`} className="py-1">{formatIsoDateTime(e.at)} · {EVENT_LABELS[e.action] || e.action}{e.by ? ` · ${e.by}` : ''}</li>)}</ul>
            </div>
          )}
        </Box>
      )}
      {state.request && !state.can_request && !state.operation.done && !state.operation.uncertain && (
        <Box title="Sua solicitação"><p>Situação: <strong>{state.request.status_label}</strong>.</p></Box>
      )}
      {state.can_request && (
        <Box title="Solicitar revisão do bloqueio">
          <p>Registro de <strong className="break-all">{record.sender || record.from || 'remetente não informado'}</strong> para <strong className="break-all">{record.recipient}</strong>.</p>
          <p>O administrador vai analisar o motivo e decidir se libera o remetente ou mantém o bloqueio.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} className="mt-1 h-4 w-4" /><span>Confirmo que desejo solicitar a revisão deste registro.</span></label>
          <button type="button" disabled={busy} onClick={() => run('request', () => requestReview(record.id, domain), 'Solicitação registrada. O administrador foi avisado.')} className="min-h-9 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60">Registrar solicitação</button>
          {statusFor('request')}
        </Box>
      )}
      {state.can_block && (
        <Box title="Bloquear remetente" tone="border-red-300">
          <p>Enviar o bloqueio de <strong className="break-all">{record.sender || record.from || 'remetente não informado'}</strong> ao SPFBL.</p>
          <p>O bloqueio é enviado ao fornecedor e <strong>pode afetar outros destinatários da mesma integração</strong>, não só este e-mail. Se o SPFBL não confirmar, a tentativa fica registrada e não é repetida automaticamente.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} className="mt-1 h-4 w-4" /><span>Entendo o alcance e confirmo o bloqueio deste remetente.</span></label>
          <button type="button" disabled={busy} onClick={() => run('block', () => blockSender(record.id, domain, state.confirmation), 'Bloqueio confirmado pelo SPFBL.')} className="min-h-9 rounded-md border border-red-700 bg-white px-4 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60">Bloquear remetente</button>
          {statusFor('block')}
        </Box>
      )}
      {state.can_unlock && (
        <Box title="Desbloquear remetente" tone="border-amber-300">
          <p>Registro de <strong className="break-all">{record.sender || record.from || 'remetente não informado'}</strong> para <strong className="break-all">{record.recipient}</strong>.</p>
          <p>A liberação é enviada ao SPFBL e <strong>pode afetar outros destinatários da mesma integração</strong>, não só este e-mail. Se o SPFBL não confirmar, a tentativa fica registrada e não é repetida automaticamente.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} className="mt-1 h-4 w-4" /><span>Entendo o alcance e confirmo o desbloqueio deste remetente.</span></label>
          <button type="button" disabled={busy} onClick={() => run('unlock', () => unlockRecord(record.id, domain, state.confirmation), 'Desbloqueio confirmado pelo SPFBL.')} className="min-h-9 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60">Desbloquear</button>
          {statusFor('unlock')}
        </Box>
      )}
    </>
  );
}
