import { useState } from 'react';
import { AlertTriangle, Loader2, Upload } from 'lucide-react';
import api from '../services/api';

export default function BackupRestoreCard() {
  const [file, setFile] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [summary, setSummary] = useState(null);
  const [validatedFile, setValidatedFile] = useState(null);
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const [loading, setLoading] = useState('');

  const isBackupValidated = Boolean(file && validatedFile === file);

  const resetValidation = () => {
    setValidatedFile(null);
    setSummary(null);
    setFeedback({ type: '', message: '' });
  };

  const getApiErrorMessage = (error, fallback) => {
    const responseData = error.response?.data;
    const message = typeof responseData?.message === 'string' ? responseData.message.trim() : '';
    const details = typeof responseData?.details === 'string' ? responseData.details.trim() : '';
    const legacyError = typeof responseData?.error === 'string' && !responseData.error.startsWith('BACKUP_')
      ? responseData.error.trim()
      : '';
    const responseMessage = [message, details].filter((value, index, values) => value && values.indexOf(value) === index).join(' ');

    if (responseMessage) return responseMessage;
    if (legacyError) return legacyError;
    if (!error.response && error.message) return error.message;
    return fallback;
  };

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
    setFeedback({ type: 'progress', message: 'Validando arquivo de backup...' });
    setSummary(null);
    setValidatedFile(null);
    setLoading('dry-run');
    try {
      const { data } = await api.post('/system/backup/restore/dry-run', buildForm(false));
      setSummary(data);
      setValidatedFile(file);
      setFeedback({ type: 'success', message: 'Arquivo validado com sucesso. Nenhum dado foi alterado.' });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'Não foi possível validar o backup. Verifique o arquivo e tente novamente.')
      });
    } finally {
      setLoading('');
    }
  };

  const runRestore = async () => {
    if (!isBackupValidated) {
      setFeedback({ type: 'error', message: 'Valide o arquivo atual antes de iniciar a restauração.' });
      return;
    }
    if (confirmation !== 'RESTAURAR BACKUP') {
      setFeedback({ type: 'error', message: 'Digite exatamente RESTAURAR BACKUP para confirmar.' });
      return;
    }
    if (!window.confirm('Esta ação pode substituir os dados atuais. Continuar com a restauração?')) return;
    setLoading('restore');
    setFeedback({ type: 'progress', message: 'Restaurando backup... Não feche esta tela.' });
    try {
      const { data } = await api.post('/system/backup/restore', buildForm(true));
      if (data.summary) setSummary(data.summary);
      setPassphrase('');
      setConfirmation('');
      setValidatedFile(null);
      setFeedback({
        type: 'success',
        message: data.message || 'Backup restaurado com sucesso.'
      });
      if (data.session_invalidated) {
        window.setTimeout(() => {
          window.location.href = '/login';
        }, 1800);
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'Não foi possível restaurar o backup. Verifique o arquivo e tente novamente.')
      });
    } finally {
      setLoading('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border-l-4 border-red-500 bg-red-50 p-3 text-xs text-red-800">
        <p className="flex font-semibold"><AlertTriangle className="mr-2 h-4 w-4 shrink-0" />Esta ação pode substituir dados atuais. Um backup automático criptografado será criado antes da restauração.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-slate-700">Arquivo de backup criptografado</label>
          <input type="file" accept=".enc.json,application/json" disabled={Boolean(loading)} onChange={(event) => { setFile(event.target.files?.[0] || null); resetValidation(); }} className="mt-1 block w-full text-sm text-slate-600 disabled:opacity-60" />
          <p className="mt-1 text-xs text-slate-500">Somente arquivos .enc.json, com limite de 50 MB.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Frase de descriptografia</label>
          <input type="password" autoComplete="off" disabled={Boolean(loading)} value={passphrase} onChange={(event) => { setPassphrase(event.target.value); resetValidation(); }} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-60" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Confirmação textual</label>
          <input type="text" disabled={Boolean(loading)} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="RESTAURAR BACKUP" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-60" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={runDryRun} disabled={Boolean(loading)} className="inline-flex items-center rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
          {loading === 'dry-run' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {loading === 'dry-run' ? 'Validando arquivo...' : 'Validar arquivo'}
        </button>
        <button type="button" onClick={runRestore} disabled={Boolean(loading) || !isBackupValidated || confirmation !== 'RESTAURAR BACKUP'} className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {loading === 'restore' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading === 'restore' ? 'Restaurando backup...' : 'Restaurar backup'}
        </button>
      </div>
      {summary && (
        <div className="rounded-md bg-slate-50 p-4 text-sm">
          <p><strong>Data:</strong> {summary.generated_at ? new Date(summary.generated_at).toLocaleString() : 'Não informada'}</p>
          <p><strong>Gerado por:</strong> {summary.generated_by || 'Não informado'}</p>
          <p><strong>Versão:</strong> {summary.version}</p>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{summary.tables?.map((item) => <span key={item.table}>{item.table}: {item.records} registros</span>)}</div>
          {summary.warnings?.map((warning) => <p key={warning} className="mt-2 text-amber-700">{warning}</p>)}
        </div>
      )}
      {feedback.message && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center rounded-md border px-3 py-2 text-sm ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : feedback.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800'
          }`}
        >
          {feedback.type === 'progress' && <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />}
          {feedback.message}
        </div>
      )}
    </div>
  );
}
