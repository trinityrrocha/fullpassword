import { useId, useState } from 'react';
import { Plug } from 'lucide-react';
import SpfblServerDialog from './SpfblServerDialog';
import { testMatrixServer } from '../../services/spfblService';
import { describeError } from '../../utils/spfbl';

const secondaryButton = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';

// One Matrix connection per WHM server. The connection is edited here (user and password) but belongs to the server: it is
// created and removed together with it (or removed alone from the edit form).
export default function SpfblMatrixPanel({ servers, onReload }) {
  const id = useId();
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });

  const test = async (server) => {
    setBusy(server.id); setMessage({ type: '', text: '' });
    try { const result = await testMatrixServer(server.id); setMessage({ type: 'success', text: `${server.name}: ${result.message || 'Conexão com o Matrix confirmada.'}` }); } catch (error) {
      setMessage({ type: 'error', text: `${server.name}: ${describeError(error, 'Não foi possível testar a conexão com o Matrix.')}` });
    } finally { setBusy(''); }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-labelledby={`${id}-title`}>
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 id={`${id}-title`} className="flex items-center text-base font-semibold text-slate-900"><Plug className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />Conexões Matrix SPFBL</h2>
        <p className="mt-1 text-sm text-slate-600">Cada conexão é vinculada a um servidor WHM e serve os domínios dele. O Matrix mostra só os últimos 1024 registros por servidor.</p>
      </header>
      <div className="space-y-3 p-4">
        {servers.length === 0 ? (
          <p className="text-sm text-slate-600">Cadastre primeiro um servidor WHM (card “Servidor WHM”): a conexão Matrix fica vinculada a ele.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200" aria-label="Conexões Matrix">
            {servers.map((server) => (
              <li key={server.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-slate-900">{server.name}</p>
                  <p className="break-all text-xs text-slate-600">{server.matrix_configured ? `Conta ${server.matrix_user}` : 'Sem conexão Matrix: só lista domínios'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {server.matrix_configured && <button type="button" disabled={busy !== ''} onClick={() => test(server)} aria-label={`Testar Matrix de ${server.name}`} className={secondaryButton}>{busy === server.id ? 'Testando...' : 'Testar conexão'}</button>}
                  <button type="button" disabled={busy !== ''} onClick={() => setEditor(server)} aria-label={`${server.matrix_configured ? 'Editar' : 'Configurar'} Matrix de ${server.name}`} className={secondaryButton}>{server.matrix_configured ? 'Editar' : 'Configurar'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {message.text && <p role={message.type === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{message.text}</p>}
      </div>
      {editor && (
        <SpfblServerDialog server={editor} section="matrix" onClose={() => setEditor(null)}
          onSaved={async () => { setEditor(null); await onReload(); setMessage({ type: 'success', text: `Conexão Matrix de ${editor.name} salva.` }); }} />
      )}
    </section>
  );
}
