import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

const phases = {
  requested: 'Solicitação recebida; aguardando o agente.',
  deploying: 'Implantação em andamento.',
  stabilizing: 'Serviços saudáveis; verificando estabilidade por pelo menos 60 segundos.',
  completed: 'Release instalada e verificada pelo agente.',
  recovery_required: 'A implantação precisa de recuperação pelo operador. Não repita o pedido.'
};
export default function UpdateStatusPanel() {
  const [versions, setVersions] = useState({ backend: null, frontend: null });
  const [agent, setAgent] = useState({ release: null, progress: null, requested: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer;
    const read = async () => {
      try {
        const [status, backend, frontend] = await Promise.all([
          api.get('/system/update/status', { signal: abort.signal, timeout: 5000 }),
          api.get('/health', { signal: abort.signal, timeout: 5000 }),
          fetch('/version.json', { signal: abort.signal, cache: 'no-store' }).then(response => {
            if (!response.ok) throw new Error('VERSION_UNAVAILABLE');
            return response.json();
          })
        ]);
        if (abort.signal.aborted) return;
        setAgent(status.data);
        setVersions({ backend: backend.data.schema_ready ? backend.data.commit : null, frontend: frontend.revision });
        setError('');
      } catch {
        if (!abort.signal.aborted) setError('Não foi possível consultar o agente. Uma falha de rede não comprova falha da implantação; não repita o pedido.');
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 5000);
      }
    };
    void read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [refresh]);
  const identified = value => /^[a-f0-9]{40}$/.test(value || '');
  const release = agent.release;
  const active = agent.requested || ['deploying','stabilizing','recovery_required'].includes(agent.progress?.state);
  const requestRelease = async () => {
    if (pending.current || !release || active) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await api.post('/system/update', { approvalId: release.approvalId, revision: release.revision, manifestHash: release.manifestHash }, { timeout: 10000 });
      setAgent(current => ({ ...current, requested: true }));
    } catch {
      setError('Pedido não confirmado. Consulte o progresso antes de qualquer nova tentativa.');
    } finally {
      pending.current = false;
      setBusy(false);
      setRefresh(value => value + 1);
    }
  };
  return (
    <div tabIndex={-1} data-focus-return className="min-h-48 space-y-3 text-sm text-slate-700 dark:text-slate-200">
      <div className="grid gap-3 sm:grid-cols-2">
        {['backend','frontend'].map(service => <div key={service}>
          Revisão {service}<span className="block break-all font-mono text-xs">{identified(versions[service]) ? versions[service] : 'Não comprovada'}</span>
        </div>)}
      </div>
      {identified(versions.backend) && identified(versions.frontend) && versions.backend !== versions.frontend &&
        <p role="alert" className="text-red-600 dark:text-red-400">Frontend e backend estão em revisões diferentes.</p>}
      <div role="status" aria-live="polite">
        {agent.requested && agent.progress?.approvalId !== release?.approvalId ? phases.requested : agent.progress ? phases[agent.progress.state] || 'Estado não identificado; consulte o operador.' : agent.requested ? phases.requested : 'Nenhuma implantação solicitada.'}
      </div>
      {agent.progress && <p className="break-all font-mono text-xs">Revisão do pedido: {agent.progress.revision}</p>}
      {release ? <div className="space-y-2">
        <p>Release aprovada pelo operador para {release.origin}</p>
        <p className="break-all font-mono text-xs">{release.revision}</p>
        <p className="break-all font-mono text-xs">Backend: {release.backend}<br />Frontend: {release.frontend}</p>
        <p>A atualização exige senha de login recente e MFA, se habilitado. O agente verifica assinatura, digests e recuperação.</p>
        <button type="button" disabled={busy || active} aria-busy={busy} onClick={requestRelease}
          className="cursor-pointer rounded bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Confirmando solicitação…' : 'Solicitar release aprovada'}
        </button>
      </div> : <p>Não há release aprovada disponível. O operador precisa provisionar o agente e uma aprovação válida; main não será instalada automaticamente.</p>}
      <button type="button" onClick={() => setRefresh(value => value + 1)} className="cursor-pointer rounded border border-slate-300 px-3 py-2 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 dark:border-slate-600 dark:hover:bg-slate-800">Consultar progresso</button>
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-xs">O pedido não contém comandos ou caminhos. Após interrupção, somente o operador pode reconciliar a implantação e emitir nova aprovação.</p>
    </div>
  );
}
