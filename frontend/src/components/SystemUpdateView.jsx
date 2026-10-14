import { useId, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react';
import { describeSystemUpdate, releasePhaseDescriptions, shortReleaseRevision } from '../utils/systemUpdatePresentation';

const tones = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  info: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200',
  success: 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  danger: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200'
};
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 active:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-600 dark:hover:bg-slate-800 dark:active:bg-slate-700';
const steps = [['requested', 'Solicitada'], ['deploying', 'Implantando'], ['stabilizing', 'Estabilizando'], ['completed', 'Concluída']];

export default function SystemUpdateView({ versions, agent, error, busy, loading, onRequest, onRefresh }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const status = describeSystemUpdate({ versions, agent, error, loading });
  const release = agent.release;
  const progress = agent.progress;
  const stepIndex = steps.findIndex(([phase]) => phase === status.phase);
  const details = [
    ['Revisão backend completa', versions.backend],
    ['Revisão frontend completa', versions.frontend],
    ['Revisão do pedido', progress?.revision],
    ['Approval do pedido', progress?.approvalId],
    ['Identificador do pedido', progress?.requestId],
    ['Estado do agente', progress?.state],
    ['Início (UTC)', progress?.startedAt],
    ['Estabilização (UTC)', progress?.healthyAt],
    ['Conclusão (UTC)', progress?.finishedAt],
    ['Código de erro do agente', progress?.errorCode],
    ['Approval aprovada', release?.approvalId],
    ['Release aprovada', release?.revision],
    ['Checksum do manifesto', release?.manifestHash],
    ['Validade da aprovação (UTC)', release?.expiresAt],
    ['Origem aprovada', release?.origin],
    ['Backend image ref / digest aprovado', release?.backend],
    ['Frontend image ref / digest aprovado', release?.frontend],
    ['Backend image ref / digest do pedido', progress?.backend],
    ['Frontend image ref / digest do pedido', progress?.frontend]
  ];
  return (
    <div tabIndex={-1} data-focus-return data-update-state={status.state} className="min-w-0 space-y-4 text-sm text-slate-700 dark:text-slate-200">
      <div data-update-summary className="space-y-4">
        <div className="min-h-16 space-y-2" role="status" aria-live="polite" aria-atomic="true">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[status.tone]}`}>
            {status.tone === 'success' && <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />}
            {status.label}
          </span>
          <p>{status.message}</p>
        </div>
        <dl className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="min-w-0">
            <dt className="text-xs text-slate-500 dark:text-slate-400">Versão atual</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{shortReleaseRevision(status.currentRevision)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-slate-500 dark:text-slate-400">Nova versão</dt>
            <dd className="mt-1 break-words font-semibold text-slate-900 dark:text-slate-100">
              {status.state === 'completed' || status.state === 'current' ? 'Nenhuma atualização pendente' : status.availableRevision ? (release.version || shortReleaseRevision(status.availableRevision)) : 'Nenhuma versão aprovada'}
            </dd>
          </div>
        </dl>
        {stepIndex >= 0 && <ol aria-label="Etapas da atualização" className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {steps.map(([phase, label], index) => <li key={phase} aria-current={index === stepIndex ? 'step' : undefined}
            className={`flex items-center gap-1.5 rounded border px-2 py-1.5 ${index <= stepIndex ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}>
            <span aria-hidden="true" className="shrink-0">{index < stepIndex || status.phase === 'completed' ? '✓' : index + 1}</span>{label}
          </li>)}
        </ol>}
        <div className="flex flex-wrap items-center gap-2">
          {status.canRequest && <button type="button" disabled={busy} aria-busy={busy} aria-label="Atualizar sistema" onClick={onRequest}
            className="relative inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 active:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60">
            <span className={`inline-flex items-center gap-2 ${busy ? 'invisible' : ''}`}><ArrowUpCircle aria-hidden="true" className="h-4 w-4" />Atualizar sistema</span>
            {busy && <span className="absolute inset-0 flex items-center justify-center">Solicitando…</span>}
          </button>}
          <button type="button" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(open => !open)} className={secondaryButton}>
            Mais informações<ChevronDown aria-hidden="true" className={`h-4 w-4 ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          {status.canRefresh && <button type="button" onClick={onRefresh} className={secondaryButton}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />Consultar progresso
          </button>}
        </div>
      </div>
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      <div id={detailsId} hidden={!detailsOpen} className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Detalhes técnicos e segurança</h3>
        <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
          {details.map(([label, value]) => <div key={label} className="min-w-0">
            <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="mt-1 break-all font-mono text-xs">{value || 'Não disponível'}</dd>
          </div>)}
        </dl>
        <div className="space-y-2 text-xs">
          <p>{releasePhaseDescriptions[progress?.state] || 'Nenhuma implantação solicitada.'}</p>
          <p>Pedido registrado para a aprovação atual: {agent.requested ? 'Sim' : 'Não'}. Uma aprovação já solicitada não pode ser reutilizada.</p>
          <p>Somente o Super Admin pode solicitar uma release previamente aprovada. O agente verifica assinatura, revisão, imagens e recuperação antes da implantação.</p>
          <p>Atualizações exigem uma release assinada, revisão explícita e recuperação verificada. O atualizador antigo de main está desativado. A primeira instalação segura exige um operador autorizado.</p>
          {!release && <p>Não há release aprovada disponível. O operador precisa provisionar o agente e uma aprovação válida; main não será instalada automaticamente.</p>}
          <p>O pedido não contém comandos ou caminhos. Após interrupção, somente o operador pode reconciliar a implantação e emitir nova aprovação.</p>
        </div>
      </div>
    </div>
  );
}
