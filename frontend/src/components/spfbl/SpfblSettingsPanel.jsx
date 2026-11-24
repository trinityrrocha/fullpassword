import { useRef, useState } from 'react';
import { Plug, Server } from 'lucide-react';
import { saveSettings, testMatrix, testWhm, syncDomains } from '../../services/spfblService';
import { buildMatrixPayload, buildWhmPayload, describeError, describeSync, syncSummary } from '../../utils/spfbl';

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';
const primaryButton = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
const secondaryButton = 'rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';

function Message({ message }) {
  if (!message.text) return null;
  return (
    <p role={message.type === 'error' ? 'alert' : 'status'} className={`whitespace-pre-line rounded-md border px-3 py-2 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
      {message.text}
    </p>
  );
}

function Section({ icon, title, description, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 className="flex items-center text-base font-semibold text-slate-900">{icon}{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// Secret inputs are uncontrolled and cleared after every submit: a saved secret is never sent back to the browser.
export default function SpfblSettingsPanel({ settings, onSettingsChange, onDomainsChanged, only = null }) {
  // onDomainsChanged reloads the catalogue AND the settings (last sync status).
  const matrixPasswordRef = useRef(null);
  const whmTokenRef = useRef(null);
  const [matrixUser, setMatrixUser] = useState(settings.matrix_user);
  const [whmHost, setWhmHost] = useState(settings.whm_host);
  const [whmUser, setWhmUser] = useState(settings.whm_user);
  const [busy, setBusy] = useState('');
  const [matrixMessage, setMatrixMessage] = useState({ type: '', text: '' });
  const [whmMessage, setWhmMessage] = useState({ type: '', text: '' });

  const run = async (name, setMessage, action) => {
    setBusy(name);
    setMessage({ type: '', text: '' });
    try { await action(); } catch (error) { setMessage({ type: 'error', text: describeError(error, 'Não foi possível concluir a operação.') }); } finally { setBusy(''); }
  };
  const clearSecret = (ref) => { if (ref.current) ref.current.value = ''; };

  const submitMatrix = (event) => {
    event.preventDefault();
    const payload = buildMatrixPayload({ user: matrixUser, password: matrixPasswordRef.current?.value || '' });
    return run('matrix-save', setMatrixMessage, async () => {
      const saved = await saveSettings(payload);
      clearSecret(matrixPasswordRef);
      onSettingsChange(saved);
      setMatrixUser(saved.matrix_user);
      setMatrixMessage({ type: 'success', text: 'Configuração do Matrix salva.' });
    });
  };
  const removeMatrix = () => run('matrix-remove', setMatrixMessage, async () => {
    const saved = await saveSettings({ remove_matrix_credentials: true });
    clearSecret(matrixPasswordRef);
    onSettingsChange(saved);
    setMatrixMessage({ type: 'success', text: 'Credenciais do Matrix removidas.' });
  });
  const runMatrixTest = () => run('matrix-test', setMatrixMessage, async () => {
    const result = await testMatrix();
    setMatrixMessage({ type: 'success', text: result.message || 'Conexão com o Matrix confirmada.' });
  });

  const submitWhm = (event) => {
    event.preventDefault();
    const payload = buildWhmPayload({ host: whmHost, user: whmUser, token: whmTokenRef.current?.value || '' });
    return run('whm-save', setWhmMessage, async () => {
      const saved = await saveSettings(payload);
      clearSecret(whmTokenRef);
      onSettingsChange(saved);
      setWhmHost(saved.whm_host);
      setWhmUser(saved.whm_user);
      setWhmMessage({ type: 'success', text: 'Configuração do WHM salva.' });
    });
  };
  const removeWhm = () => run('whm-remove', setWhmMessage, async () => {
    const saved = await saveSettings({ remove_whm_token: true });
    clearSecret(whmTokenRef);
    onSettingsChange(saved);
    setWhmMessage({ type: 'success', text: 'Token do WHM removido.' });
  });
  const runWhmTest = () => run('whm-test', setWhmMessage, async () => {
    const result = await testWhm();
    setWhmMessage({ type: 'success', text: `Conexão confirmada: ${result.accounts} contas e ${result.domains} domínios (${result.active} ativos). Nada foi gravado.` });
  });
  // The server records the outcome of every attempt (also a failure), so the lists and the status are reloaded either way.
  const runSync = () => run('whm-sync', setWhmMessage, async () => {
    try {
      const result = await syncDomains();
      setWhmMessage({ type: 'success', text: `Sincronizado: ${syncSummary(result)}` });
    } finally {
      await onDomainsChanged();
    }
  });

  const disabled = busy !== '';
  const unsavedWhm = whmHost.trim() !== settings.whm_host || whmUser.trim() !== settings.whm_user;

  return (
    <div className="space-y-6">
      {only !== 'whm' && <Section icon={<Plug className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />} title="Conexão Matrix SPFBL" description="Credenciais da conta Matrix usadas para consultar os bloqueios. Ficam cifradas no servidor e nunca voltam para o navegador.">
        <form className="space-y-4" onSubmit={submitMatrix} noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Usuário Matrix
              <input type="text" value={matrixUser} onChange={(event) => setMatrixUser(event.target.value)} maxLength={254} autoComplete="off" spellCheck={false} className={`${fieldClass} mt-1`} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Senha Matrix
              <input ref={matrixPasswordRef} type="password" autoComplete="new-password" maxLength={1024} className={`${fieldClass} mt-1`} aria-describedby="matrix-password-hint" />
              <span id="matrix-password-hint" className="mt-1 block text-xs font-normal text-slate-600">
                {settings.has_matrix_password ? 'Há uma senha salva. Deixe em branco para mantê-la.' : 'Nenhuma senha salva.'}
              </span>
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={disabled} className={primaryButton}>{busy === 'matrix-save' ? 'Salvando...' : 'Salvar'}</button>
            <button type="button" disabled={disabled || !settings.has_matrix_password} onClick={runMatrixTest} className={secondaryButton}>{busy === 'matrix-test' ? 'Testando...' : 'Testar conexão salva'}</button>
            {settings.has_matrix_password && <button type="button" disabled={disabled} onClick={removeMatrix} className={secondaryButton}>Remover credenciais</button>}
          </div>
          <Message message={matrixMessage} />
        </form>
      </Section>}

      {only !== 'matrix' && <Section icon={<Server className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />} title="Servidor WHM (cPanel)" description="Usado só para listar os domínios ativos (contas não suspensas). Somente leitura: crie no WHM um token com o mínimo de permissões necessárias para listar contas e domínios.">
        <form className="space-y-4" onSubmit={submitWhm} noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">
              Servidor (hostname)
              <input type="text" value={whmHost} onChange={(event) => setWhmHost(event.target.value)} maxLength={253} autoComplete="off" spellCheck={false} placeholder="servidor.exemplo.com.br" className={`${fieldClass} mt-1`} aria-describedby="whm-host-hint" />
              <span id="whm-host-hint" className="mt-1 block text-xs font-normal text-slate-600">Sem https://, porta ou IP. Conexão na porta 2087.</span>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Usuário WHM
              <input type="text" value={whmUser} onChange={(event) => setWhmUser(event.target.value)} maxLength={32} autoComplete="off" spellCheck={false} placeholder="root ou revendedor" className={`${fieldClass} mt-1`} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Token WHM
              <input ref={whmTokenRef} type="password" autoComplete="new-password" maxLength={256} className={`${fieldClass} mt-1`} aria-describedby="whm-token-hint" />
              <span id="whm-token-hint" className="mt-1 block text-xs font-normal text-slate-600">
                {settings.has_whm_token ? 'Há um token salvo. Deixe em branco para mantê-lo.' : 'Nenhum token salvo.'}
              </span>
            </label>
          </div>
          <p className="text-xs text-slate-600">{describeSync(settings.domain_sync_at, settings.domain_sync_status)}</p>
          {unsavedWhm && settings.has_whm_token && <p className="text-xs text-amber-800">Você alterou o servidor ou o usuário: digite o token novamente para salvar.</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={disabled} className={primaryButton}>{busy === 'whm-save' ? 'Salvando...' : 'Salvar'}</button>
            <button type="button" disabled={disabled || !settings.has_whm_token || unsavedWhm} onClick={runWhmTest} className={secondaryButton}>{busy === 'whm-test' ? 'Testando...' : 'Testar conexão'}</button>
            <button type="button" disabled={disabled || !settings.has_whm_token || unsavedWhm} onClick={runSync} className={secondaryButton}>{busy === 'whm-sync' ? 'Sincronizando...' : 'Sincronizar domínios'}</button>
            {settings.has_whm_token && <button type="button" disabled={disabled} onClick={removeWhm} className={secondaryButton}>Remover token</button>}
          </div>
          <Message message={whmMessage} />
        </form>
      </Section>}
    </div>
  );
}
