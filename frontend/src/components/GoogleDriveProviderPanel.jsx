import { useCallback, useEffect, useState } from 'react';
import { Link, Save, Unlink } from 'lucide-react';
import api from '../services/api';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import { safeLogError } from '../utils/safeLogger';

const EMPTY_FORM = Object.freeze({ clientId: '', clientSecret: '', redirectUri: '' });
const fieldClass = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';

export default function GoogleDriveProviderPanel({ providerStatus, onChanged, busy, setBusy, setFeedback }) {
  const suggestedRedirectUri = providerStatus?.redirect_uri || '';
  const [oauthConfig, setOauthConfig] = useState({
    configured: false,
    source: null,
    client_id_masked: null,
    redirect_uri: suggestedRedirectUri
  });
  const [form, setForm] = useState({ ...EMPTY_FORM, redirectUri: suggestedRedirectUri });
  const [editing, setEditing] = useState(false);

  useClearOnVaultLock(() => {
    setForm((current) => ({ ...current, clientSecret: '' }));
  });

  const loadOAuthConfig = useCallback(async () => {
    try {
      const { data } = await api.get('/integrations/google-drive/oauth-config');
      setOauthConfig(data);
      setForm({
        ...EMPTY_FORM,
        redirectUri: data.redirect_uri || suggestedRedirectUri
      });
    } catch (error) {
      safeLogError('Falha sanitizada ao carregar OAuth Google Drive.', error);
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível carregar a configuração OAuth.' });
    }
  }, [suggestedRedirectUri, setFeedback]);

  useEffect(() => {
    const timer = window.setTimeout(loadOAuthConfig, 0);
    return () => window.clearTimeout(timer);
  }, [loadOAuthConfig]);

  const perform = async (name, operation, successMessage) => {
    setBusy(name);
    setFeedback({ type: '', text: '' });
    try {
      await operation();
      setFeedback({ type: 'success', text: successMessage });
      await Promise.all([loadOAuthConfig(), onChanged()]);
      return true;
    } catch (error) {
      safeLogError('Falha sanitizada na configuração Google Drive.', error);
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível concluir a operação.' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const saveOAuth = async (event) => {
    event.preventDefault();
    if (!form.clientId.trim() || !form.clientSecret || !form.redirectUri.trim()) {
      setFeedback({ type: 'error', text: 'Preencha Client ID, Client Secret e Redirect URI.' });
      return;
    }
    const success = await perform(
      'google-oauth-save',
      () => api.put('/integrations/google-drive/oauth-config', {
        client_id: form.clientId.trim(),
        client_secret: form.clientSecret,
        redirect_uri: form.redirectUri.trim()
      }),
      'Configuração OAuth salva com segurança.'
    );
    if (success) {
      setForm((current) => ({ ...current, clientId: '', clientSecret: '' }));
      setEditing(false);
    }
  };

  const connect = async () => {
    setBusy('google-connect');
    try {
      const { data } = await api.get('/integrations/google-drive/oauth/start');
      window.location.assign(data.authorization_url);
    } catch (error) {
      setFeedback({ type: 'error', text: error.response?.data?.error || 'Não foi possível iniciar a conexão OAuth.' });
      setBusy('');
    }
  };

  const disconnect = () => {
    if (!window.confirm('Desconectar a conta Google Drive? Os backups existentes serão preservados.')) return;
    perform(
      'google-disconnect',
      () => api.post('/cloud-backup/disconnect', { provider: 'google_drive' }),
      'Google Drive desconectado.'
    );
  };

  const removeOAuth = () => {
    if (!window.confirm('Remover a configuração OAuth salva? A conta Google precisa estar desconectada.')) return;
    perform(
      'google-oauth-remove',
      () => api.delete('/integrations/google-drive/oauth-config'),
      'Configuração OAuth removida.'
    );
  };

  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="font-medium text-slate-900">Google Drive</h3>
        <p className="mt-1 text-sm text-slate-600">
          OAuth server-side com escopo mínimo drive.file. O refresh token permanece criptografado.
        </p>
      </div>

      {(!oauthConfig.configured || editing) && !providerStatus?.connected && (
        <form onSubmit={saveOAuth} className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50 p-4">
          <p className="text-sm text-slate-700">
            Crie no Google Cloud um OAuth Client do tipo Web Application e cadastre exatamente a Redirect URI abaixo.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Client ID</span>
            <input className={`${fieldClass} w-full`} value={form.clientId} maxLength={512} autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Client Secret</span>
            <input className={`${fieldClass} w-full`} type="password" value={form.clientSecret} maxLength={1024} autoComplete="new-password" onChange={(event) => setForm((current) => ({ ...current, clientSecret: event.target.value }))} />
            <span className="mt-1 block text-xs text-slate-500">Criptografado no banco e nunca exibido novamente.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Redirect URI</span>
            <input className={`${fieldClass} w-full font-mono text-xs`} type="url" value={form.redirectUri} autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, redirectUri: event.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              <Save className="mr-2 h-4 w-4" /> Salvar configuração OAuth
            </button>
            {editing && <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-2 text-sm text-slate-600">Cancelar</button>}
          </div>
        </form>
      )}

      {oauthConfig.configured && !editing && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <p className="font-medium">OAuth Google Drive configurado.</p>
          <p className="mt-1 text-xs">
            Origem: {oauthConfig.source === 'database' ? 'configuração salva no sistema' : 'fallback do servidor'}
            {oauthConfig.client_id_masked ? ` · Client ID: ${oauthConfig.client_id_masked}` : ''}
          </p>
          <p className="mt-1 break-all font-mono text-xs">{oauthConfig.redirect_uri}</p>
          {!providerStatus?.connected && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm">Editar OAuth</button>
              {oauthConfig.source === 'database' && <button type="button" onClick={removeOAuth} disabled={Boolean(busy)} className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-50">Remover OAuth</button>}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {providerStatus?.connected ? `Conectado como: ${providerStatus.google_email || 'conta Google autorizada'}` : 'Conta Google não conectada'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Pasta: {providerStatus?.drive_folder_name || 'FullPassword Backups'}</p>
        </div>
        {providerStatus?.connected ? (
          <button type="button" onClick={disconnect} disabled={Boolean(busy)} className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-50">
            <Unlink className="mr-2 h-4 w-4" /> Desconectar
          </button>
        ) : (
          <button type="button" onClick={connect} disabled={!oauthConfig.configured || Boolean(busy)} className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            <Link className="mr-2 h-4 w-4" /> Conectar Google Drive
          </button>
        )}
      </div>
    </div>
  );
}
