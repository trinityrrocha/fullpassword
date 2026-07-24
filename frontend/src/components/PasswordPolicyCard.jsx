import { useEffect, useState } from 'react';
import api from '../services/api';

const PASSWORD_NOTICE_OPTIONS = [3, 6, 12];
const normalizeNoticeMonths = (value) => {
  const months = Number(value);
  return PASSWORD_NOTICE_OPTIONS.includes(months) ? months : 6;
};

export default function PasswordPolicyCard() {
  const [months, setMonths] = useState(6);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/system/password-policy')
      .then(({ data }) => setMonths(normalizeNoticeMonths(data.password_change_notice_months)))
      .catch(() => setMessage('Não foi possível carregar a política de senha.'));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const { data } = await api.put('/system/password-policy', {
        password_change_notice_months: Number(months)
      });
      setMonths(normalizeNoticeMonths(data.password_change_notice_months));
      setMessage('Política de senha atualizada.');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Não foi possível atualizar a política.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Requisitos obrigatórios</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Mínimo de 12 caracteres</li><li>Letra maiúscula e minúscula</li>
          <li>Número e caractere especial</li><li>Senhas comuns são bloqueadas</li>
        </ul>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Notificar recomendação de troca após</label>
        <div className="mt-1 flex items-center gap-2">
          <select value={months} onChange={(event) => setMonths(Number(event.target.value))} className="w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>1 ano</option>
          </select>
        </div>
        <p className="mt-1 text-xs text-slate-500">O aviso é apenas uma recomendação e não bloqueia o login.</p>
      </div>
      <button type="button" onClick={save} disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar política'}</button>
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}
