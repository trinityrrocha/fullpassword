import { useId, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import FormDialog from '../FormDialog';
import { createWhmServer, updateWhmServer, validateMatrixCredentials, validateWhmCredentials } from '../../services/spfblService';
import { SERVER_KINDS, buildMatrixValidation, buildServerPayload, buildWhmValidation, describeError } from '../../utils/spfbl';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const hintClass = 'mt-1 block text-xs font-normal text-slate-600';
const validateButton = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';
const NOT_CHECKED = { type: '', text: '' };

// ONE dialog for a server and its Matrix connection (the connection belongs to the server). Each credential has its own
// "Validar credenciais" button that checks what is typed without saving anything; the server is only stored by "Salvar".
// Secret inputs are uncontrolled and never prefilled.
export default function SpfblServerDialog({ server, onClose, onSaved }) {
  const id = useId();
  const editing = Boolean(server);
  const tokenRef = useRef(null);
  const passwordRef = useRef(null);
  const [name, setName] = useState(server?.name || '');
  const [kind, setKind] = useState(server?.kind || 'cpanel');
  const [host, setHost] = useState(server?.host || '');
  const [user, setUser] = useState(server?.whm_user || 'root');
  const [matrixUser, setMatrixUser] = useState(server?.matrix_user || '');
  const [removeMatrix, setRemoveMatrix] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [whmCheck, setWhmCheck] = useState(NOT_CHECKED);
  const [matrixCheck, setMatrixCheck] = useState(NOT_CHECKED);

  const hostChanged = editing && (host.trim() !== server.host || user.trim() !== server.whm_user);
  // Any edit of a credential field makes the earlier answer stale.
  const touchWhm = (set) => (event) => { set(event.target.value); setWhmCheck(NOT_CHECKED); };
  const touchMatrix = (set) => (event) => { set(event.target.value); setMatrixCheck(NOT_CHECKED); };

  const validateWhm = async () => {
    setBusy('whm'); setWhmCheck(NOT_CHECKED);
    try {
      const result = await validateWhmCredentials(buildWhmValidation({ id: server?.id, host, user, token: tokenRef.current?.value }));
      setWhmCheck({ type: 'success', text: `Credenciais validadas: ${result.accounts} contas, ${result.domains} domínios (${result.active} ativos). Nada foi gravado.` });
    } catch (failure) { setWhmCheck({ type: 'error', text: describeError(failure, 'Não foi possível validar as credenciais do servidor.') }); } finally { setBusy(''); }
  };
  const validateMatrix = async () => {
    setBusy('matrix'); setMatrixCheck(NOT_CHECKED);
    try {
      const result = await validateMatrixCredentials(buildMatrixValidation({ id: server?.id, matrixUser, matrixPassword: passwordRef.current?.value }));
      setMatrixCheck({ type: 'success', text: `Credenciais validadas. ${result.message || ''}`.trim() });
    } catch (failure) { setMatrixCheck({ type: 'error', text: describeError(failure, 'Não foi possível validar as credenciais do Matrix.') }); } finally { setBusy(''); }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy('save'); setError('');
    const payload = buildServerPayload({ name, kind, host, user, token: tokenRef.current?.value, matrixUser, matrixPassword: passwordRef.current?.value });
    if (editing && removeMatrix) { delete payload.matrix_user; delete payload.matrix_password; payload.remove_matrix = true; }
    try {
      const saved = editing ? await updateWhmServer(server.id, payload) : await createWhmServer(payload);
      if (tokenRef.current) tokenRef.current.value = '';
      if (passwordRef.current) passwordRef.current.value = '';
      onSaved(saved);
    } catch (failure) { setError(describeError(failure, 'Não foi possível salvar o servidor.')); setBusy(''); }
  };

  const check = (state) => state.text && (
    <p role={state.type === 'error' ? 'alert' : 'status'} className={`flex items-start gap-1.5 text-sm ${state.type === 'error' ? 'text-red-800' : 'text-green-800'}`}>
      {state.type === 'success' && <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}<span className="whitespace-pre-line">{state.text}</span>
    </p>
  );
  const formId = `${id}-form`;
  const saving = busy === 'save';
  return (
    <FormDialog title={editing ? `Editar servidor ${server.name}` : 'Adicionar servidor'} onClose={onClose} busy={saving} child size="xl"
      description="O servidor lista os domínios (somente leitura) e tem a sua conexão Matrix SPFBL. Token e senhas ficam cifrados no servidor e nunca voltam ao navegador."
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" data-dialog-cancel disabled={saving} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button type="submit" form={formId} disabled={busy !== ''} className="inline-flex min-w-32 items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving ? <><Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : 'Salvar'}
          </button>
        </div>
      )}>
      <form id={formId} noValidate onSubmit={submit} className="space-y-5">
        {error && <p role="alert" className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Nome do servidor
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="off" className={`${fieldClass} mt-1`} />
          </label>
          <label className="text-sm font-medium text-slate-700">Tipo de servidor
            <select value={kind} onChange={(event) => setKind(event.target.value)} className={`${fieldClass} mt-1`}>
              {SERVER_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-900">Acesso ao servidor (lista de domínios)</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">Endereço (hostname)
              <input type="text" value={host} onChange={touchWhm(setHost)} maxLength={253} autoComplete="off" spellCheck={false} placeholder="servidor.exemplo.com.br" className={`${fieldClass} mt-1`} />
              <span className={hintClass}>Sem https://, porta ou IP. Conexão na porta 2087.</span>
            </label>
            <label className="text-sm font-medium text-slate-700">Usuário
              <input type="text" value={user} onChange={touchWhm(setUser)} maxLength={32} autoComplete="off" spellCheck={false} placeholder="root ou revendedor" className={`${fieldClass} mt-1`} />
            </label>
            <label className="text-sm font-medium text-slate-700">Token
              <input ref={tokenRef} type="password" autoComplete="new-password" maxLength={256} onChange={() => setWhmCheck(NOT_CHECKED)} className={`${fieldClass} mt-1`} />
              <span className={hintClass}>{editing ? 'Há um token salvo. Deixe em branco para mantê-lo.' : 'Token do WHM com o mínimo de permissões para listar contas e domínios.'}</span>
            </label>
          </div>
          {hostChanged && <p className="text-xs text-amber-800">Você alterou o servidor ou o usuário: digite o token novamente.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy !== ''} onClick={validateWhm} className={validateButton}>{busy === 'whm' ? 'Validando...' : 'Validar credenciais do servidor'}</button>
            {check(whmCheck)}
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-900">Conexão Matrix SPFBL deste servidor</legend>
          {editing && server.matrix_configured && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={removeMatrix} onChange={(event) => setRemoveMatrix(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
              Remover a conexão Matrix deste servidor (o histórico já coletado continua).
            </label>
          )}
          {!removeMatrix && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Usuário Matrix
                  <input type="text" value={matrixUser} onChange={touchMatrix(setMatrixUser)} maxLength={254} autoComplete="off" spellCheck={false} className={`${fieldClass} mt-1`} />
                </label>
                <label className="text-sm font-medium text-slate-700">Senha Matrix
                  <input ref={passwordRef} type="password" autoComplete="new-password" maxLength={1024} onChange={() => setMatrixCheck(NOT_CHECKED)} className={`${fieldClass} mt-1`} />
                  <span className={hintClass}>{editing && server.has_matrix_password ? 'Há uma senha salva. Deixe em branco para mantê-la.' : 'Opcional: sem a conexão o servidor só lista domínios e não coleta histórico.'}</span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy !== ''} onClick={validateMatrix} className={validateButton}>{busy === 'matrix' ? 'Validando...' : 'Validar credenciais do Matrix'}</button>
                {check(matrixCheck)}
              </div>
            </>
          )}
        </fieldset>
      </form>
    </FormDialog>
  );
}
