import { useMemo, useState } from 'react';
import {
  Activity,
  BellOff,
  Clipboard,
  Play,
  Save,
  X
} from 'lucide-react';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';
import { getCloudStatus } from '../utils/cloudBackupUiState';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';

const STATUS_MAP = Object.freeze({
  online: { label: 'Online', color: 'bg-green-500', text: 'text-green-700' },
  degraded: { label: 'Instável', color: 'bg-amber-500', text: 'text-amber-700' },
  offline: { label: 'Offline', color: 'bg-red-500', text: 'text-red-700' },
  config_error: { label: 'Erro Config', color: 'bg-red-500', text: 'text-red-700' },
  permission_error: { label: 'Sem Permissão', color: 'bg-orange-500', text: 'text-orange-700' },
  unknown: { label: 'Aguardando', color: 'bg-slate-400', text: 'text-slate-600' },
  not_tested: { label: 'Não testado', color: 'bg-slate-400', text: 'text-slate-600' },
  testing: { label: 'Testando', color: 'bg-indigo-500', text: 'text-indigo-700' }
});

const ModalShell = ({ title, description, onClose, children, size = 'max-w-2xl' }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white shadow-2xl ${size}`}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

export const CloudStatusBadge = ({ status }) => {
  const visual = STATUS_MAP[status] || STATUS_MAP.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium ${visual.text}`}>
      <span className={`h-2 w-2 rounded-full ${visual.color}`} />
      {visual.label}
    </span>
  );
};

export function EndpointEditorModal({ open, provider, providerLabel, form, onConfirm, onClose }) {
  const [draft, setDraft] = useState(form);
  const [error, setError] = useState('');

  if (!open) return null;
  const ftp = provider === 'ftp';
  const confirm = () => {
    if (ftp) {
      const host = String(draft.host || '').trim();
      const port = Number(draft.port);
      if (!host || host.includes('://') || /[\\/]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
        setError('Informe host sem protocolo e porta entre 1 e 65535.');
        return;
      }
    } else {
      try {
        const endpoint = new URL(String(draft.endpoint || '').trim());
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
          throw new Error('invalid');
        }
      } catch {
        setError('O endpoint deve usar HTTPS e não pode conter caminho, credenciais, querystring ou hash.');
        return;
      }
    }
    onConfirm(draft);
    onClose();
  };

  return (
    <ModalShell title="Editar endpoint" description={`Configuração avançada de comunicação — ${providerLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          <span className="font-medium">Provedor:</span> {providerLabel}
          {!ftp && <><span className="mx-2">•</span><span className="font-medium">Região:</span> {draft.region || 'Personalizada'}</>}
        </div>
        {ftp ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm"><span className="mb-1 block font-medium">Host</span><input className={fieldClass} value={draft.host || ''} onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))} /></label>
            <label className="text-sm"><span className="mb-1 block font-medium">Porta</span><input type="number" min="1" max="65535" className={fieldClass} value={draft.port || 21} onChange={(event) => setDraft((current) => ({ ...current, port: Number(event.target.value) }))} /></label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.secure === true} onChange={(event) => setDraft((current) => ({ ...current, secure: event.target.checked }))} /> Usar FTPS</label>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Endpoint S3</span>
            <input type="url" className={fieldClass} value={draft.endpoint || ''} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value, edit_endpoint: true }))} />
            <span className="mt-1 block text-xs text-slate-500">A validação final também será executada pelo backend.</span>
          </label>
        )}
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cancelar</button>
          <button type="button" onClick={confirm} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"><Save className="mr-2 h-4 w-4" /> Confirmar</button>
        </div>
      </div>
    </ModalShell>
  );
}

export function ConnectionTestModal({
  open,
  provider,
  providerLabel,
  providerStatus,
  communication,
  busy,
  safeTarget,
  onTest,
  onClose
}) {
  const [testWrite, setTestWrite] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const status = getCloudStatus({ busy, communication, providerStatus, configured: providerStatus?.configured === true });
  const safeDebug = {
    provider,
    endpoint_host: safeTarget.endpointHost || null,
    bucket_folder: safeTarget.bucketFolder || null,
    region: safeTarget.region || null,
    stage: communication?.stage || null,
    errorCode: communication?.stage || null,
    providerMessage: communication?.message || providerStatus?.last_error_message || null,
    responseTimeMs: communication?.latency_ms || null,
    testedAt: communication?.tested_at || providerStatus?.last_test_at || null
  };
  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(safeDebug, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <ModalShell title="Teste de conexão" description={`Validação segura do destino — ${providerLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <CloudStatusBadge status={status} />
          <div className="text-right text-xs text-slate-500">
            <div>Latência: <strong className="text-slate-800">{communication?.latency_ms ? `${communication.latency_ms}ms` : '-'}</strong></div>
            <div>Teste: {formatDateTimeShort(communication?.tested_at || providerStatus?.last_test_at)}</div>
          </div>
        </div>
        <p className="text-sm text-slate-700">{communication?.message || providerStatus?.last_error_message || 'Execute o teste para validar a comunicação com o destino salvo.'}</p>
        <div className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 text-sm sm:grid-cols-3">
          {(provider === 'ftp' ? ['Conectar', 'Listar pasta', 'WriteTest'] : ['HeadBucket', 'ListObjects', 'WriteTest']).map((stage, index) => (
            <div key={stage} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${status === 'online' && index < 2 ? 'bg-green-500' : 'bg-slate-300'}`} />
              <span>{stage}: {status === 'online' && index < 2 ? 'OK' : index === 2 ? 'Não executado' : 'Aguardando'}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-md bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={testWrite} onChange={(event) => setTestWrite(event.target.checked)} /> Testar permissão de escrita</label>
          {testWrite && <p className="text-xs text-amber-700">O endpoint atual valida conexão e listagem. WriteTest ficará pendente até suporte específico no backend.</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={debugMode} onChange={(event) => setDebugMode(event.target.checked)} /> Modo debug</label>
        </div>
        {debugMode && <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(safeDebug, null, 2)}</pre>}
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" onClick={copyDebug} className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm"><Clipboard className="mr-2 h-4 w-4" /> {copied ? 'Copiado!' : 'Copiar Debug Seguro'}</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Fechar</button>
            <button type="button" onClick={onTest} disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Play className="mr-2 h-4 w-4" /> Testar Conexão</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function MonitoringModal({
  open,
  providerLabel,
  providerStatus,
  communication,
  busy,
  onRun,
  onClose
}) {
  const [mutedUntil, setMutedUntil] = useState(null);
  const [monitorSettings, setMonitorSettings] = useState({
    enabled: true,
    latencyWarningMs: 1000,
    latencyCriticalMs: 3000,
    failureThreshold: 3,
    recoveryThreshold: 2,
    cooldownMinutes: 60,
    notifyDegraded: true,
    notifyOffline: true,
    notifyConfigError: true,
    notifyRecovery: true
  });
  const currentStatus = getCloudStatus({ busy, communication, providerStatus, configured: providerStatus?.configured === true });
  const latency = communication?.latency_ms || null;
  const checkHistory = useMemo(() => {
    const testedAt = communication?.tested_at || providerStatus?.last_test_at;
    return testedAt ? [{ status: currentStatus, latency, testedAt }] : [];
  }, [communication?.tested_at, currentStatus, latency, providerStatus?.last_test_at]);
  if (!open) return null;

  return (
    <ModalShell title="Monitoramento completo" description={`Visão operacional do armazenamento — ${providerLabel}`} onClose={onClose} size="max-w-3xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Status</span><CloudStatusBadge status={currentStatus} /></div>
          <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Latência</span><strong>{latency ? `${latency}ms` : '-'}</strong></div>
          <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Média</span><strong>{latency ? `${latency}ms` : '-'}</strong></div>
          <div className="rounded-md border p-3"><span className="block text-xs text-slate-500">Último check</span><strong className="text-xs">{formatDateTimeShort(communication?.tested_at || providerStatus?.last_test_at)}</strong></div>
        </div>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">Latência — últimas 24h</h4>
          <div className="flex h-[60px] items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {checkHistory.length < 2 ? 'Dados insuficientes para gerar o gráfico.' : <svg viewBox="0 0 300 60" className="h-[60px] w-full" aria-label="Sparkline de latência"><polyline points="0,45 100,32 200,38 300,20" fill="none" stroke="#4f46e5" strokeWidth="2" /></svg>}
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">Histórico de checks</h4>
          {!checkHistory.length ? <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Nenhum check registrado.</p> : checkHistory.map((check) => (
            <details key={check.testedAt} className="rounded-md border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer"><CloudStatusBadge status={check.status} /> <span className="ml-2">{formatDateTimeShort(check.testedAt)} · {check.latency ? `${check.latency}ms` : '-'}</span></summary>
              <p className="mt-2 text-xs text-slate-500">Detalhes adicionais estarão disponíveis quando o backend fornecer histórico de monitoramento.</p>
            </details>
          ))}
        </section>

        <fieldset disabled className="space-y-3 rounded-lg border border-slate-200 p-4 opacity-70">
          <legend className="px-2 text-sm font-semibold">Configurações preparadas para monitoramento contínuo</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {['latencyWarningMs', 'latencyCriticalMs', 'failureThreshold', 'recoveryThreshold', 'cooldownMinutes'].map((key) => (
              <label key={key} className="text-xs"><span className="mb-1 block">{key}</span><input type="number" className={fieldClass} value={monitorSettings[key]} onChange={(event) => setMonitorSettings((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={monitorSettings.enabled} onChange={(event) => setMonitorSettings((current) => ({ ...current, enabled: event.target.checked }))} /> Monitoramento ativo</label>
            {[
              ['notifyDegraded', 'Notificar degraded'],
              ['notifyOffline', 'Notificar offline'],
              ['notifyConfigError', 'Notificar config error'],
              ['notifyRecovery', 'Notificar recovery']
            ].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={monitorSettings[key]} onChange={(event) => setMonitorSettings((current) => ({ ...current, [key]: event.target.checked }))} /> {label}</label>)}
          </div>
          <p className="text-xs text-slate-500">A persistência e o histórico de 24h aguardam suporte do backend; nenhuma rota inexistente é chamada.</p>
        </fieldset>

        {mutedUntil && <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">Alertas visuais silenciados nesta tela até {mutedUntil.toLocaleTimeString('pt-BR')}.</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" onClick={() => setMutedUntil(new Date(Date.now() + 60 * 60 * 1000))} className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm"><BellOff className="mr-2 h-4 w-4" /> Silenciar 1h</button>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled title="Aguardando endpoint de monitoramento" className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm opacity-50"><Save className="mr-2 h-4 w-4" /> Salvar Configurações</button>
            <button type="button" onClick={onRun} disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Activity className="mr-2 h-4 w-4" /> Executar Agora</button>
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Fechar</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
