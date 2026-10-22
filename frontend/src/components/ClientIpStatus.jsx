import { useEffect, useState } from 'react';
import api from '../services/api';

const modeLabels = { direct: 'Acesso direto', cloudflare_proxy: 'Cloudflare Proxy', cloudflare_tunnel: 'Cloudflare Tunnel' };

export default function ClientIpStatus() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: false });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    api.get('/system/client-ip-status', { signal: controller.signal, timeout: 15000 })
      .then(({ data }) => {
        if (current) setState({ loading: false, data, error: false });
      })
      .catch(() => {
        if (current) setState({ loading: false, data: null, error: true });
      });
    return () => { current = false; controller.abort(); };
  }, [attempt]);
  const retry = () => {
    setState({ loading: true, data: null, error: false });
    setAttempt(value => value + 1);
  };
  const data = state.data;
  const verified = data && (data.mode === 'direct' || data.cloudflare === true);
  return (
    <section aria-labelledby="client-ip-heading" className="min-h-32 rounded-md border border-slate-200 p-4 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
      <h3 id="client-ip-heading" className="font-medium text-slate-900 dark:text-slate-100">Origem dos IPs dos clientes</h3>
      <div aria-live="polite" aria-busy={state.loading}>
        {state.loading && <p className="mt-2 text-slate-600 dark:text-slate-300">Consultando origem dos IPs...</p>}
        {state.error && <div className="mt-2"><p role="alert">Não foi possível validar a origem dos IPs. Revise a configuração da implantação.</p><button type="button" onClick={retry} className="mt-2 cursor-pointer rounded px-2 py-1 text-indigo-600 hover:bg-indigo-50 focus-visible:outline-2 dark:text-indigo-300 dark:hover:bg-slate-800">Tentar novamente</button></div>}
        {data && <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div><dt className="text-slate-500 dark:text-slate-400">Definido na implantação</dt><dd>{modeLabels[data.mode] || 'Modo não identificado'}</dd></div>
          <div><dt className="text-slate-500 dark:text-slate-400">IP atual detectado</dt><dd className="break-all font-mono">{data.client_ip || 'Não identificado'}</dd></div>
          <div className="sm:col-span-2"><dt className="sr-only">Status</dt><dd>{verified ? 'IP real validado' : 'O IP do cliente não pôde ser validado. Revise a configuração da implantação.'}</dd></div>
        </dl>}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">A topologia só pode ser alterada administrativamente na implantação.</p>
    </section>
  );
}
