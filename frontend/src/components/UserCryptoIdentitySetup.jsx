import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { hasUserCryptoIdentity } from '../services/userCryptoIdentityService';
import usePasswordPolicy from '../hooks/usePasswordPolicy';
import SecurePasswordInput from './SecurePasswordInput';

export default function UserCryptoIdentitySetup() {
  const {policy,error:policyError,reload:reloadPolicy}=usePasswordPolicy();
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { user, ensureCurrentUserCryptoIdentity, logout } = useAuth();
  const mfaEnabled = user?.mfa_enabled === true;

  const setupRequired = Boolean(
    user
    && user.must_change_password !== true
    && !hasUserCryptoIdentity(user)
  );

  if (!setupRequired) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (!policy) {setError('Aguarde o carregamento da política de senhas.');return;}

    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('master_password') || '');
    const unlockSecret = String(values.get('unlock_secret') || '');
    if (unlockSecret !== values.get('unlock_confirm')) { setError('Os segredos de desbloqueio não coincidem.'); return; }
    const mfaCode = mfaEnabled ? String(values.get('mfa_code') || '') : undefined;
    form.reset();
    setError('');
    setIsSaving(true);
    try {
      const result = await ensureCurrentUserCryptoIdentity(password, unlockSecret, mfaCode);
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
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-600">
              Crie um segredo de desbloqueio diferente da senha de login. Ele nunca é enviado ao servidor. Guarde-o com segurança: redefinir a senha de login não recupera este segredo. Os cofres antigos serão migrados pelo proprietário ao serem abertos.
            </p>
            <div>
              <SecurePasswordInput
                id="crypto-identity-password"
                name="master_password"
                label="Senha de login atual"
                showCopyButton={false}
                enableGenerator={false}
                required
                autoFocus
                autoComplete="current-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <SecurePasswordInput name="unlock_secret" label="Novo segredo de desbloqueio" minLength={policy?.vault_min_length} placeholder={policy?`Mínimo de ${policy.vault_min_length} caracteres`:'Carregando política…'} required autoComplete="new-password" showCopyButton={false} />
            <SecurePasswordInput name="unlock_confirm" label="Confirmar segredo de desbloqueio" required autoComplete="new-password" showCopyButton={false} enableGenerator={false} />
            {policyError&&<p role="alert">{policyError} <button type="button" onClick={reloadPolicy} className="text-indigo-600 underline">Tentar novamente</button></p>}
            {mfaEnabled && <label className="block text-sm">Código MFA atual
              <input name="mfa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-full rounded border p-2" />
            </label>}
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
            <button type="submit" disabled={isSaving||!policy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {isSaving ? 'Configurando...' : 'Concluir configuração'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
