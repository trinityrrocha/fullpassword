import { useState } from 'react';
import { AlertTriangle, Loader2, Upload } from 'lucide-react';
import api from '../services/api';

export default function BackupRestoreCard() {
  const [file, setFile] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState('');

  const buildForm = (includeConfirmation) => {
    if (!file) throw new Error('Selecione um arquivo .enc.json.');
    if (passphrase.length < 16) throw new Error('A frase de descriptografia deve ter ao menos 16 caracteres.');
    const form = new FormData();
    form.append('backup', file);
    form.append('passphrase', passphrase);
    if (includeConfirmation) form.append('confirmation', confirmation);
    return form;
  };

  const runDryRun = async () => {
    setMessage('');
    setSummary(null);
    setLoading('dry-run');
    try {
      const { data } = await api.post('/system/backup/restore/dry-run', buildForm(false));
      setSummary(data);
      setMessage('Simulação concluída. Nenhum dado foi alterado.');
    } catch (error) {
      setMessage(error.response?.data?.error || error.message || 'Não foi possível simular a restauração.');
    } finally {
      setLoading('');
    }
  };

  const runRestore = async () => {
    setMessage('');
    if (confirmation !== 'RESTAURAR BACKUP') return setMessage('Digite exatamente RESTAURAR BACKUP para confirmar.');
    if (!window.confirm('Esta ação pode substituir os dados atuais. Continuar com a restauração?')) return;
    setLoading('restore');
    try {
      const { data } = await api.post('/system/backup/restore', buildForm(true));
      setPassphrase('');
      setConfirmation('');
      setMessage(data.message || 'Backup restaurado.');
      if (data.session_invalidated) window.location.href = '/login';
    } catch (error) {
      setMessage(error.response?.data?.error || error.message || 'Não foi possível restaurar o backup.');
    } finally {
      setLoading('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-800">
        <p className="flex font-semibold"><AlertTriangle className="mr-2 h-5 w-5" />Esta ação pode substituir dados atuais.</p>
        <p className="mt-1">Um backup automático criptografado será criado antes da restauração.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Arquivo de backup criptografado</label>
        <input type="file" accept=".enc.json,application/json" onChange={(event) => { setFile(event.target.files?.[0] || null); setSummary(null); }} className="mt-1 block w-full text-sm text-slate-600" />
        <p className="mt-1 text-xs text-slate-500">Somente arquivos .enc.json, com limite de 50 MB.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Frase de descriptografia</label>
        <input type="password" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <button type="button" onClick={runDryRun} disabled={Boolean(loading)} className="inline-flex items-center rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
        {loading === 'dry-run' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Simular restauração
      </button>
      {summary && (
        <div className="rounded-md bg-slate-50 p-4 text-sm">
          <p><strong>Data:</strong> {summary.generated_at ? new Date(summary.generated_at).toLocaleString() : 'Não informada'}</p>
          <p><strong>Gerado por:</strong> {summary.generated_by || 'Não informado'}</p>
          <p><strong>Versão:</strong> {summary.version}</p>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{summary.tables?.map((item) => <span key={item.table}>{item.table}: {item.records} registros</span>)}</div>
          {summary.warnings?.map((warning) => <p key={warning} className="mt-2 text-amber-700">{warning}</p>)}
        </div>
      )}
      <div className="border-t border-slate-200 pt-4">
        <label className="block text-sm font-medium text-slate-700">Confirmação textual</label>
        <input type="text" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="RESTAURAR BACKUP" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button type="button" onClick={runRestore} disabled={Boolean(loading) || confirmation !== 'RESTAURAR BACKUP'} className="mt-3 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {loading === 'restore' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Restaurar backup
        </button>
      </div>
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}
