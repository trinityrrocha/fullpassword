import { useEffect, useState } from 'react';
import api from '../services/api';

// Read-only until a signed-release web bridge is implemented, provisioned and validated.
// Never fall back to the removed main/Docker-socket updater.
export default function UpdateStatusPanel() {
  const [versions, setVersions] = useState({ backend: null, frontend: null });
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      api.get('/health', { signal: abort.signal, timeout: 5000 }),
      fetch('/version.json', { signal: abort.signal, cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error('VERSION_UNAVAILABLE');
        return response.json();
      })
    ]).then(([backend, frontend]) => {
      if (!abort.signal.aborted) setVersions({
        backend: backend.data.schema_ready ? backend.data.commit : null,
        frontend: frontend.revision
      });
    }).catch(() => {
      if (!abort.signal.aborted) setError('Não foi possível comprovar as revisões instaladas.');
    });
    return () => abort.abort();
  }, []);
  const identified = value => /^[a-f0-9]{40}$/.test(value || '');
  return (
    <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
      <p role="status">Atualização web indisponível: a integração com o agente de releases assinadas ainda precisa ser implementada, provisionada e validada.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {['backend', 'frontend'].map(service => <div key={service}>
          Revisão {service}
          <span className="block break-all font-mono text-xs">{identified(versions[service]) ? versions[service] : 'Não comprovada'}</span>
        </div>)}
      </div>
      {identified(versions.backend) && identified(versions.frontend) && versions.backend !== versions.frontend &&
        <p role="alert" className="text-red-600 dark:text-red-400">Frontend e backend estão em revisões diferentes.</p>}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      <p>Não reinstale main para inicializar o controle de versão. O operador deve validar assinatura, digests, destino de teste e restauração antes da implantação.</p>
      <p className="text-xs">A leitura destas versões não comprova a procedência das imagens nem substitui a validação pelo operador. Nenhuma atualização é acionada por esta tela.</p>
    </div>
  );
}
