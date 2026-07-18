import { useEffect, useState } from 'react';
import api from '../services/api';

export default function PasswordPolicyCard() {
  const [months, setMonths] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/system/password-policy')
      .then(({ data }) => setMonths(data.password_change_notice_months ?? ''))
      .catch(() => setMessage('Não foi possível carregar a política de senha.'));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const { data } = await api.put('/system/password-policy', {
        password_change_notice_months: months === '' ? null : Number(months)
      });
      setMonths(data.password_change_notice_months ?? '');
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
          <input type="number" min="1" max="120" value={months} onChange={(event) => setMonths(event.target.value)} placeholder="Desabilitado" className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <span className="text-sm text-slate-500">meses</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Deixe vazio para não exibir aviso periódico. O aviso não bloqueia o login.</p>
      </div>
      <button type="button" onClick={save} disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar política'}</button>
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}
