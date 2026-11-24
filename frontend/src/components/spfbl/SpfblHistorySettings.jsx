import { useCallback, useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { collectHistoryNow, getHistorySettings, saveHistorySettings } from '../../services/spfblService';
import { describeError, formatDay, formatIsoShort, formatNumber } from '../../utils/spfbl';

const fieldClass = 'rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100';
const primaryButton = 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';
const secondaryButton = 'rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';

// Retention (30/60/90 days) and the hour of the daily collection. Shortening the retention deletes stored rows: the server asks
// for a confirmation that says how many, and this form shows it before anything is sent again.
export default function SpfblHistorySettings() {
  const [data, setData] = useState(null);
  const [retention, setRetention] = useState('30');
  const [hour, setHour] = useState('3');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  const apply = useCallback((next) => { setData(next); setRetention(String(next.retention_days)); setHour(String(next.schedule_hour)); }, []);
  useEffect(() => {
    let active = true;
    getHistorySettings()
      .then((next) => { if (active) apply(next); })
      .catch((error) => { if (active) setMessage({ type: 'error', text: describeError(error, 'Não foi possível carregar a retenção do histórico.') }); });
    return () => { active = false; };
  }, [apply]);

  const save = async (confirmShrink = false) => {
    setBusy('save'); setMessage({ type: '', text: '' });
    try {
      const saved = await saveHistorySettings({ retention_days: Number(retention), schedule_hour: Number(hour), ...(confirmShrink ? { confirm_shrink: true } : {}) });
      apply(saved); setConfirm(null);
      setMessage({ type: 'success', text: saved.deleted ? `Salvo. ${formatNumber(saved.deleted)} registros antigos foram apagados.` : 'Configuração do histórico salva.' });
    } catch (error) {
      const body = error?.response?.data;
      if (body?.code === 'SPFBL_HISTORY_SHRINK_CONFIRM') setConfirm(body);
      else setMessage({ type: 'error', text: describeError(error, 'Não foi possível salvar a configuração do histórico.') });
    } finally { setBusy(''); }
  };
  const collect = async () => {
    setBusy('collect'); setMessage({ type: '', text: '' });
    try {
      await collectHistoryNow();
      setMessage({ type: 'success', text: 'Coleta iniciada em segundo plano. Acompanhe pela Auditoria.' });
      setData((current) => (current ? { ...current, running: true } : current));
    } catch (error) { setMessage({ type: 'error', text: describeError(error, 'Não foi possível iniciar a coleta.') }); } finally { setBusy(''); }
  };

  const changed = data && (Number(retention) !== data.retention_days || Number(hour) !== data.schedule_hour);
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-labelledby="spfbl-history-settings-title">
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 id="spfbl-history-settings-title" className="flex items-center text-base font-semibold text-slate-900"><Database className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />Histórico armazenado</h2>
        <p className="mt-1 text-sm text-slate-600">O servidor consulta o Matrix 1 vez por dia e guarda os registros dos domínios cadastrados pelo período escolhido.</p>
      </header>
      <div className="space-y-4 p-4">
        {!data && !message.text && <p role="status" className="text-sm text-slate-600">Carregando...</p>}
        {data && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Guardar por
                <select value={retention} onChange={(event) => { setRetention(event.target.value); setConfirm(null); }} disabled={busy !== ''} className={`${fieldClass} mt-1 block w-full`}>
                  {data.retention_options.map((days) => <option key={days} value={days}>{days} dias</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">
                Coletar todo dia às
                <select value={hour} onChange={(event) => setHour(event.target.value)} disabled={busy !== ''} className={`${fieldClass} mt-1 block w-full`}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-600">Horário de Brasília (America/Sao_Paulo).</span>
              </label>
            </div>
            <p className="text-xs text-slate-600">
              {formatNumber(data.stored.rows)} registros armazenados{data.stored.oldest_at ? ` (desde ${formatIsoShort(data.stored.oldest_at)})` : ''}.
              {' '}Última coleta agendada: {data.last_run_date ? formatDay(data.last_run_date) : 'nenhuma ainda'}.{data.running ? ' Há uma coleta em andamento.' : ''}
            </p>
            {confirm && (
              <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Reduzir a retenção apagará {formatNumber(confirm.rows_to_delete)} registros do histórico armazenado. Isso não pode ser desfeito.
                <button type="button" disabled={busy !== ''} onClick={() => save(true)} className="ml-3 rounded-md border border-amber-700 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100">Confirmar e apagar</button>
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy !== '' || !changed} onClick={() => save(false)} className={primaryButton}>{busy === 'save' ? 'Salvando...' : 'Salvar'}</button>
              <button type="button" disabled={busy !== '' || data.running} onClick={collect} className={secondaryButton}>{busy === 'collect' ? 'Iniciando...' : 'Coletar agora'}</button>
            </div>
          </>
        )}
        {message.text && <p role={message.type === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{message.text}</p>}
      </div>
    </section>
  );
}
