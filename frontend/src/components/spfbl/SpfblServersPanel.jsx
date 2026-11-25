import { useId, useState } from 'react';
import { Server } from 'lucide-react';
import SpfblServerDialog from './SpfblServerDialog';
import SpfblRemoveServerDialog from './SpfblRemoveServerDialog';
import PaginationBar from '../PaginationBar';
import { syncDomains, syncWhmServer } from '../../services/spfblService';
import { describeError, describeSync, kindLabel, paginate, syncSummary } from '../../utils/spfbl';

const primaryButton = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';
const secondaryButton = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';

// List of servers: add, edit, sync domains and remove. A server carries its own Matrix connection (one dialog edits both).
// Removing asks what to do with the domains.
export default function SpfblServersPanel({ servers, loadError, onReload }) {
  const id = useId();
  const [editor, setEditor] = useState(null); // { server } (null server = new)
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [message, setMessage] = useState({ type: '', text: '' });

  const view = paginate(servers, page, pageSize);
  const say = (type, text) => setMessage({ type, text });
  const run = async (key, action) => {
    setBusy(key); say('', '');
    try { await action(); } catch (error) { say('error', describeError(error, 'Não foi possível concluir a operação.')); } finally { setBusy(''); }
  };
  // The server records the outcome of every attempt (also a failure), so the lists are reloaded either way.
  const sync = (server) => run(`sync-${server.id}`, async () => {
    try { say('success', `${server.name}: sincronizado. ${syncSummary(await syncWhmServer(server.id))}`); } finally { await onReload(); }
  });
  const syncAll = () => run('sync-all', async () => {
    try {
      const result = await syncDomains();
      const failed = result.servers.filter((item) => !item.ok);
      say(failed.length ? 'error' : 'success', failed.length
        ? `${result.ok} servidor(es) sincronizado(s); falhou: ${failed.map((item) => `${item.name} (${item.code})`).join(', ')}.`
        : `${result.ok} servidor(es) sincronizado(s).`);
    } finally { await onReload(); }
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-labelledby={`${id}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id={`${id}-title`} className="flex items-center text-base font-semibold text-slate-900"><Server className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />Servidores</h2>
          <p className="mt-1 text-sm text-slate-600">Cada servidor lista os domínios ativos (somente leitura) e tem a sua própria conexão Matrix SPFBL. Cadastre quantos precisar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {servers.length > 1 && <button type="button" disabled={busy !== ''} onClick={syncAll} className={secondaryButton}>{busy === 'sync-all' ? 'Sincronizando...' : 'Sincronizar todos os servidores'}</button>}
          <button type="button" disabled={busy !== ''} onClick={() => setEditor({ server: null })} className={primaryButton}>Adicionar servidor</button>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {loadError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</p>}
        {servers.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum servidor cadastrado. Adicione o primeiro servidor com o token e, se quiser coletar o histórico, a conta Matrix.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200" aria-label="Servidores cadastrados">
            {view.items.map((server) => (
              <li key={server.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-slate-900">{server.name}</p>
                  <p className="break-all text-xs text-slate-600">{kindLabel(server.kind)} · {server.whm_user}@{server.host} · {server.domains_total} {server.domains_total === 1 ? 'domínio' : 'domínios'} · {server.matrix_configured ? `Matrix: ${server.matrix_user}` : 'sem conexão Matrix'}</p>
                  <p className="text-xs text-slate-600">{describeSync(server.sync_at, server.sync_status)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy !== ''} onClick={() => sync(server)} aria-label={`Sincronizar domínios de ${server.name}`} className={secondaryButton}>{busy === `sync-${server.id}` ? 'Sincronizando...' : 'Sincronizar domínios'}</button>
                  <button type="button" disabled={busy !== ''} onClick={() => setEditor({ server })} aria-label={`Editar ${server.name}`} className={secondaryButton}>Editar</button>
                  <button type="button" disabled={busy !== ''} onClick={() => setRemoving(server)} aria-label={`Remover ${server.name}`} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">Remover</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {servers.length > 0 && <PaginationBar label="Paginação dos servidores" page={view.page} pages={view.pages} total={view.total} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />}
        {message.text && <p role={message.type === 'error' ? 'alert' : 'status'} className={`whitespace-pre-line rounded-md border px-3 py-2 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{message.text}</p>}
      </div>
      {editor && (
        <SpfblServerDialog server={editor.server} onClose={() => setEditor(null)}
          onSaved={async (saved) => { setEditor(null); await onReload(); say('success', `Servidor ${saved.name} salvo.`); }} />
      )}
      {removing && (
        <SpfblRemoveServerDialog server={removing} onClose={() => setRemoving(null)}
          onRemoved={async (result) => { setRemoving(null); await onReload(); say('success', `Servidor ${result.name} removido. ${result.domains_removed} domínios removidos; ${result.domains_kept} mantidos sem servidor de consulta.`); }} />
      )}
    </section>
  );
}
