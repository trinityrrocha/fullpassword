import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import SystemUpdateView from './SystemUpdateView';
export default function UpdateStatusPanel() {
  const [versions, setVersions] = useState({ backend: null, frontend: null });
  const [agent, setAgent] = useState({ release: null, progress: null, requested: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
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
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(read, 5000);
        }
      }
    };
    void read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [refresh]);
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
  return <SystemUpdateView versions={versions} agent={agent} error={error} busy={busy} loading={loading}
    onRequest={requestRelease} onRefresh={() => setRefresh(value => value + 1)} />;
}
