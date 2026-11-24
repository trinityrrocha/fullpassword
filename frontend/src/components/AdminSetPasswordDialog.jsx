import { useRef, useState } from 'react';
import FormDialog from './FormDialog';
import SecurePasswordInput from './SecurePasswordInput';
import api from '../services/api';

// Super Admin sets the LOGIN password of another account. The vault unlock secret is independent and untouched, so this never
// gives the administrator access to that person's vaults. The password is temporary: the owner changes it at the next login.
export default function AdminSetPasswordDialog({ member, minLength, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const close = () => { setPassword(''); onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current) return;
    if (!event.currentTarget.checkValidity()) { setError(`A senha deve ter ao menos ${minLength || 8} caracteres.`); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const { data } = await api.post(`/users/${member.id}/password`, { new_password: password });
      setPassword('');                    // never kept after the request
      setResult(data);
      onDone?.(data);
    } catch (failure) {
      setError(failure?.response?.data?.error || 'Não foi possível definir a senha.');
    } finally { lock.current = false; setBusy(false); }
  };

  const footer = result ? (
    <button type="button" onClick={close} className="min-h-9 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900">Fechar</button>
  ) : (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={close} disabled={busy} className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60">Cancelar</button>
      <button type="submit" form="adminSetPasswordForm" disabled={busy} className="min-h-9 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60">{busy ? 'Salvando…' : 'Definir senha'}</button>
    </div>
  );

  return (
    <FormDialog title={`Definir senha de ${member.name}`} description={member.email} onClose={close} busy={busy} child footer={footer}>
      {result ? (
        <div role="status" className="space-y-2 text-sm text-slate-800">
          <p className="font-medium text-emerald-800">{result.message}</p>
          <p>{result.sessions_revoked} sessão(ões) do usuário foram encerradas.</p>
          <p>{result.notification === 'sent' ? 'O usuário foi avisado por e-mail (a senha não vai no e-mail).' : 'O e-mail de aviso não foi enviado (SMTP desligado ou indisponível): avise o usuário por outro canal.'}</p>
        </div>
      ) : (
        <form id="adminSetPasswordForm" onSubmit={submit} noValidate className="space-y-3">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <SecurePasswordInput name="admin_new_password" label="Nova senha de login" minLength={minLength} value={password} onChange={(event) => setPassword(event.target.value)} required />
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            <li>Copie a senha agora e entregue por um canal seguro: ela não é exibida depois.</li>
            <li>É temporária: o usuário precisará trocá-la no próximo acesso, e todas as sessões dele serão encerradas.</li>
            <li>Muda só a senha de login. O segredo que desbloqueia os cofres é independente e não é alterado nem acessível a você.</li>
            <li>O MFA do usuário continua valendo. A ação é registrada na auditoria (sem a senha).</li>
          </ul>
        </form>
      )}
    </FormDialog>
  );
}
