import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { hasUserCryptoIdentity } from '../services/userCryptoIdentityService';

export default function UserCryptoIdentitySetup() {
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { user, ensureCurrentUserCryptoIdentity, logout } = useAuth();

  const setupRequired = Boolean(
    user
    && user.must_change_password !== true
    && !hasUserCryptoIdentity(user)
  );

  if (!setupRequired) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;

    const form = event.currentTarget;
    const password = String(new FormData(form).get('master_password') || '');
    form.reset();
    setError('');
    setIsSaving(true);
    try {
      const result = await ensureCurrentUserCryptoIdentity(password);
      if (!result.success) setError(result.error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    window.location.assign('/login');
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-labelledby="crypto-identity-title">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-5 text-center">
          <KeyRound className="mx-auto h-10 w-10 text-indigo-600" />
          <h2 id="crypto-identity-title" className="mt-3 text-lg font-semibold text-slate-900">
            Configuração de segurança necessária
          </h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-600">
              Sua conta precisa concluir a geração das chaves criptográficas para poder receber cofres compartilhados. Informe sua senha mestre para concluir a configuração.
            </p>
            <div>
              <label htmlFor="crypto-identity-password" className="mb-1 block text-sm font-medium text-slate-700">
                Senha mestre
              </label>
              <input
                id="crypto-identity-password"
                name="master_password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
            <button type="button" onClick={handleLogout} disabled={isSaving} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </button>
            <button type="submit" disabled={isSaving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {isSaving ? 'Configurando...' : 'Concluir configuração'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
