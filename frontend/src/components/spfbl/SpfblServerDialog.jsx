import { useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import FormDialog from '../FormDialog';
import { createWhmServer, updateWhmServer } from '../../services/spfblService';
import { buildServerPayload, describeError } from '../../utils/spfbl';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const hintClass = 'mt-1 block text-xs font-normal text-slate-600';

// Create or edit one WHM server and its Matrix connection. `section` limits the form: 'whm' (name, host, user, token),
// 'matrix' (Matrix user and password) or 'all' (new server: both, as one record). Secret inputs are uncontrolled and never prefilled.
export default function SpfblServerDialog({ server, section = 'all', onClose, onSaved }) {
  const id = useId();
  const editing = Boolean(server);
  const tokenRef = useRef(null);
  const passwordRef = useRef(null);
  const [name, setName] = useState(server?.name || '');
  const [host, setHost] = useState(server?.host || '');
  const [user, setUser] = useState(server?.whm_user || 'root');
  const [matrixUser, setMatrixUser] = useState(server?.matrix_user || '');
  const [removeMatrix, setRemoveMatrix] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const showWhm = section !== 'matrix';
  const showMatrix = section !== 'whm';
  const hostChanged = editing && (host.trim() !== server.host || user.trim() !== server.whm_user);
  const title = !editing ? 'Adicionar servidor WHM' : section === 'matrix' ? `Conexão Matrix de ${server.name}` : `Editar servidor ${server.name}`;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    const payload = buildServerPayload({ name, host, user, token: tokenRef.current?.value, matrixUser, matrixPassword: passwordRef.current?.value }, { section });
    if (editing && removeMatrix && showMatrix) { delete payload.matrix_user; delete payload.matrix_password; payload.remove_matrix = true; }
    try {
      const saved = editing ? await updateWhmServer(server.id, payload) : await createWhmServer(payload);
      if (tokenRef.current) tokenRef.current.value = '';
      if (passwordRef.current) passwordRef.current.value = '';
      onSaved(saved);
    } catch (failure) {
      setError(describeError(failure, 'Não foi possível salvar o servidor.'));
      setBusy(false);
    }
  };

  const formId = `${id}-form`;
  return (
    <FormDialog title={title} onClose={onClose} busy={busy} child size="xl"
      description={section === 'matrix' ? 'Usuário e senha da conta Matrix SPFBL deste servidor. Ficam cifrados no servidor e nunca voltam ao navegador.'
        : 'O servidor WHM lista os domínios (somente leitura). Token e senha ficam cifrados no servidor e nunca voltam ao navegador.'}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" data-dialog-cancel disabled={busy} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button type="submit" form={formId} disabled={busy} className="inline-flex min-w-32 items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? <><Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : (editing ? 'Salvar' : 'Adicionar servidor')}
          </button>
        </div>
      )}>
      <form id={formId} noValidate onSubmit={submit} className="space-y-5">
        {error && <p role="alert" className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {showWhm && (
          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-slate-900">Servidor WHM (cPanel)</legend>
            <label className="block text-sm font-medium text-slate-700">Nome do servidor
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="off" className={`${fieldClass} mt-1`} />
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm font-medium text-slate-700">Servidor (hostname)
                <input type="text" value={host} onChange={(event) => setHost(event.target.value)} maxLength={253} autoComplete="off" spellCheck={false} placeholder="servidor.exemplo.com.br" className={`${fieldClass} mt-1`} />
                <span className={hintClass}>Sem https://, porta ou IP. Conexão na porta 2087.</span>
              </label>
              <label className="text-sm font-medium text-slate-700">Usuário WHM
                <input type="text" value={user} onChange={(event) => setUser(event.target.value)} maxLength={32} autoComplete="off" spellCheck={false} placeholder="root ou revendedor" className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-sm font-medium text-slate-700">Token WHM
                <input ref={tokenRef} type="password" autoComplete="new-password" maxLength={256} className={`${fieldClass} mt-1`} />
                <span className={hintClass}>{editing ? 'Há um token salvo. Deixe em branco para mantê-lo.' : 'Crie no WHM um token com o mínimo de permissões para listar contas e domínios.'}</span>
              </label>
            </div>
            {hostChanged && <p className="text-xs text-amber-800">Você alterou o servidor ou o usuário: digite o token novamente para salvar.</p>}
          </fieldset>
        )}
        {showMatrix && (
          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold text-slate-900">Conexão Matrix SPFBL deste servidor</legend>
            {editing && server.matrix_configured && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={removeMatrix} onChange={(event) => setRemoveMatrix(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                Remover a conexão Matrix deste servidor (o histórico já coletado continua).
              </label>
            )}
            {!removeMatrix && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Usuário Matrix
                  <input type="text" value={matrixUser} onChange={(event) => setMatrixUser(event.target.value)} maxLength={254} autoComplete="off" spellCheck={false} className={`${fieldClass} mt-1`} />
                </label>
                <label className="text-sm font-medium text-slate-700">Senha Matrix
                  <input ref={passwordRef} type="password" autoComplete="new-password" maxLength={1024} className={`${fieldClass} mt-1`} />
                  <span className={hintClass}>{editing && server.has_matrix_password ? 'Há uma senha salva. Deixe em branco para mantê-la.' : 'Opcional: sem ela o servidor só lista domínios e não coleta histórico.'}</span>
                </label>
              </div>
            )}
          </fieldset>
        )}
      </form>
    </FormDialog>
  );
}
