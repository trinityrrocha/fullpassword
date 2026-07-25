import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, KeyRound, ShieldAlert } from 'lucide-react';
import SecurePasswordInput from '../components/SecurePasswordInput';
import api from '../services/api';
import { createPasswordResetCryptoIdentity } from '../services/passwordResetCryptoService';

let transientResetToken = '';

const captureResetToken = (searchParams) => {
  const tokenFromUrl = searchParams.get('token') || '';
  if (tokenFromUrl) transientResetToken = tokenFromUrl;
  return transientResetToken;
};

const clearTransientResetToken = () => {
  transientResetToken = '';
};

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const tokenRef = useRef(captureResetToken(searchParams));
  const [validation, setValidation] = useState({ loading: true, valid: false });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sensitiveCleanupTimerRef = useRef(null);

  useEffect(() => {
    window.clearTimeout(sensitiveCleanupTimerRef.current);
    const token = tokenRef.current;
    if (token) {
      window.history.replaceState(null, '', '/reset-password');
    }

    let active = true;
    api.post('/auth/password-reset/validate', { token })
      .then(({ data }) => {
        if (!data?.valid) {
          tokenRef.current = '';
          clearTransientResetToken();
        }
        if (active) setValidation({ loading: false, ...data });
      })
      .catch(() => {
        tokenRef.current = '';
        clearTransientResetToken();
        if (active) setValidation({ loading: false, valid: false, error: 'Link inválido ou expirado.' });
      });
    return () => {
      active = false;
      sensitiveCleanupTimerRef.current = window.setTimeout(() => {
        tokenRef.current = '';
        clearTransientResetToken();
      }, 0);
    };
  }, []);

  const clearSensitiveState = () => {
    setNewPassword('');
    setConfirmPassword('');
    setConfirmation('');
    setMfaCode('');
    tokenRef.current = '';
    clearTransientResetToken();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (newPassword.length < 12) {
      setError('A nova senha deve ter ao menos 12 caracteres.');
      return;
    }
    if (confirmation !== 'RESETAR ACESSO') {
      setError('Digite RESETAR ACESSO para confirmar.');
      return;
    }
    if (validation.requires_mfa && !mfaCode.trim()) {
      setError('Informe o código MFA ou um código de recuperação.');
      return;
    }

    setIsSubmitting(true);
    try {
      const cryptoIdentity = await createPasswordResetCryptoIdentity(newPassword);
      const response = await api.post('/auth/password-reset/complete', {
        token: tokenRef.current,
        new_password: newPassword,
        confirmation,
        ...(useRecoveryCode ? { recovery_code: mfaCode } : { mfa_code: mfaCode }),
        ...cryptoIdentity
      });
      clearSensitiveState();
      setSuccess(response.data?.message || 'Acesso redefinido com sucesso. Entre novamente com a nova senha.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Não foi possível redefinir o acesso. Solicite um novo link e tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (validation.loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-600">Validando link de recuperação...</p>
      </main>
    );
  }

  if (!validation.valid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section role="alert" className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6 text-center shadow">
          <ShieldAlert className="mx-auto h-10 w-10 text-red-500" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-semibold text-slate-900">Link inválido ou expirado</h1>
          <p className="mt-2 text-sm text-slate-600">Solicite uma nova recuperação de acesso.</p>
          <Link to="/forgot-password" className="mt-5 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">
            Solicitar novo link
          </Link>
        </section>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-lg border border-emerald-200 bg-white p-6 text-center shadow">
          <KeyRound className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-semibold text-slate-900">Acesso redefinido</h1>
          <p className="mt-2 text-sm text-slate-600">{success}</p>
          <p className="mt-2 text-sm text-slate-600">
            Alguns cofres podem precisar ser ressincronizados por um administrador.
          </p>
          <Link to="/login" className="mt-5 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Ir para o login
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <section className="mx-auto w-full max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow">
        <h1 className="text-2xl font-semibold text-slate-900">Redefinir acesso à conta</h1>
        <p className="mt-1 text-sm text-slate-600">Conta: {validation.email_masked}</p>

        <div className="mt-5 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Atenção: esta ação cria uma nova identidade criptográfica.</p>
          <p>Esta recuperação redefine o acesso à conta, mas não recupera sua senha mestre antiga.</p>
          <p>
            Por segurança Zero-Knowledge, esta redefinição não recupera sua senha mestre antiga.
          </p>
          <p>
            Ao continuar, sua conta receberá uma nova identidade criptográfica. Cofres anteriormente compartilhados
            com você poderão precisar ser ressincronizados por um administrador antes de ficarem acessíveis novamente.
            Esta operação não descriptografa cofres antigos.
          </p>
          <p>
            Códigos de recuperação servem para validar MFA quando necessário. Eles não descriptografam cofres.
          </p>
          {validation.privileged_account && (
            <p className="font-semibold">
              Esta conta possui privilégios administrativos. Cofres dependentes da identidade antiga poderão precisar ser ressincronizados.
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <SecurePasswordInput
            name="new-password"
            label="Nova senha"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Mínimo de 12 caracteres"
            required
            showCopyButton={false}
            autoComplete="new-password"
            maxLength={1024}
          />
          <SecurePasswordInput
            name="confirm-password"
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repita a nova senha"
            required
            enableGenerator={false}
            showCopyButton={false}
            autoComplete="new-password"
            maxLength={1024}
          />

          {validation.requires_mfa && (
            <div>
              <label htmlFor="password-reset-mfa" className="block text-sm font-medium text-slate-700">
                {useRecoveryCode ? 'Código de recuperação MFA' : 'Código do autenticador'}
              </label>
              <input
                id="password-reset-mfa"
                type="text"
                autoComplete="one-time-code"
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                maxLength={useRecoveryCode ? 19 : 12}
                required
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm"
              />
              <button
                type="button"
                onClick={() => {
                  setUseRecoveryCode((value) => !value);
                  setMfaCode('');
                }}
                className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                {useRecoveryCode ? 'Usar código do autenticador' : 'Usar código de recuperação MFA'}
              </button>
              <p className="mt-2 text-xs text-slate-600">
                {useRecoveryCode
                  ? 'O código de recuperação valida seu MFA. Ele não recupera sua senha antiga e não descriptografa cofres.'
                  : 'Se você perdeu acesso ao aplicativo autenticador, use um dos códigos de recuperação gerados no PDF ao ativar o MFA.'}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="reset-confirmation" className="block text-sm font-medium text-slate-700">
              Digite <span className="font-mono font-semibold">RESETAR ACESSO</span> para continuar
            </label>
            <input
              id="reset-confirmation"
              type="text"
              autoComplete="off"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm shadow-sm"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || confirmation !== 'RESETAR ACESSO'}
            className="flex w-full items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
            {isSubmitting ? 'Redefinindo acesso...' : 'Redefinir acesso'}
          </button>
        </form>
      </section>
    </main>
  );
}
