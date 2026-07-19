import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';
import SettingsAccordionCard from './SettingsAccordionCard';

const selectClass = 'border border-slate-300 rounded-md px-[9px] py-[6px] text-sm bg-white';
const defaultPolicy = { auto_block_enabled: true, failed_attempts_threshold: 5, observation_window_minutes: 15, block_duration_minutes: 30 };
const failureStatus = (status) => {
  if (status === 'whitelisted' || status === 'whitelist') return { label: 'Whitelist', dotClass: 'bg-green-500' };
  if (['permanently_blocked', 'temporary_blocked', 'blocked', 'blacklist'].includes(status)) return { label: 'Bloqueado', dotClass: 'bg-red-500' };
  return { label: 'Normal', dotClass: 'bg-slate-400' };
};

export default function SecurityCard() {
  const [policy, setPolicy] = useState(defaultPolicy);
  const [failures, setFailures] = useState([]);
  const [failurePagination, setFailurePagination] = useState({ page: 1, limit: 10, total_pages: 0 });
  const [failureLimit, setFailureLimit] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const showError = (error) => setMessage({ type: 'error', text: error.response?.data?.error || 'Não foi possível concluir a operação.' });
  const updatePolicyField = (field, value) => setPolicy((current) => ({ ...current, [field]: value }));

  const loadPolicy = useCallback(async () => {
    const response = await api.get('/system/login-security-policy');
    setPolicy(response.data.policy || defaultPolicy);
  }, []);

  const loadFailures = useCallback(async (page = 1) => {
    const response = await api.get('/system/login-failures', { params: { page, limit: failureLimit } });
    setFailures(response.data.items || []);
    setFailurePagination(response.data.pagination || { page, limit: failureLimit, total_pages: 0 });
  }, [failureLimit]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try { await Promise.all([loadPolicy(), loadFailures()]); } catch (error) { showError(error); } finally { setIsLoading(false); }
  }, [loadFailures, loadPolicy]);

  useEffect(() => { refresh(); }, [refresh]);

  const savePolicy = async () => {
    setIsLoading(true); setMessage(null);
    try {
      const response = await api.put('/system/login-security-policy', policy);
      setPolicy(response.data.policy);
      setMessage({ type: 'success', text: 'Política de login atualizada.' });
    } catch (error) { showError(error); } finally { setIsLoading(false); }
  };

  const createRule = async (ipAddress, rule_type) => {
    setIsLoading(true); setMessage(null);
    try {
      await api.post('/system/ip-rules', { ip_address: ipAddress, rule_type, reason: 'Ação manual do Super Admin', ...(rule_type === 'temporary_block' ? { duration_minutes: 60 } : {}) });
      setMessage({ type: 'success', text: 'Regra de IP criada.' });
      await loadFailures();
    } catch (error) { showError(error); } finally { setIsLoading(false); }
  };

  const handleFailureAction = (item, action) => {
    if (action === 'temporary_block') return createRule(item.ip_address, 'temporary_block');
    if (action === 'block') return createRule(item.ip_address, 'block');
    if (action === 'allow') return createRule(item.ip_address, 'allow');
  };

  return (
    <SettingsAccordionCard id="security-card" title="Segurança" icon={<ShieldCheck className="w-5 h-5 mr-2 text-indigo-500" />} headerAction={<button type="button" onClick={refresh} disabled={isLoading} className="text-indigo-600 disabled:opacity-50" title="Atualizar segurança"><RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} /></button>}>
      <div className="space-y-8">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="flex items-start font-medium"><AlertTriangle className="mr-2 h-4 w-4 shrink-0" />Cuidado: bloquear IP incorreto pode impedir acesso legítimo. O IP atual do Super Admin não pode ser bloqueado. Whitelist prevalece sobre bloqueios automáticos e permanentes.</p>
        </div>
        {message && <div className={`rounded-md border p-3 text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>{message.text}</div>}

        <section className="space-y-4">
          <h4 className="font-semibold text-slate-900">Política de Login</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm text-slate-700">Tentativas falhadas para bloquear<select value={policy.failed_attempts_threshold} onChange={(e) => updatePolicyField('failed_attempts_threshold', Number(e.target.value))} className={`${selectClass} mt-1 w-full`}>{[5, 10, 15].map((v) => <option key={v}>{v}</option>)}</select></label>
            <label className="text-sm text-slate-700">Janela de contagem<select value={policy.observation_window_minutes} onChange={(e) => updatePolicyField('observation_window_minutes', Number(e.target.value))} className={`${selectClass} mt-1 w-full`}>{[10, 15, 30, 60].map((v) => <option key={v} value={v}>{v} minutos</option>)}</select></label>
            <label className="text-sm text-slate-700">Tempo de bloqueio automático<select value={policy.block_duration_minutes} onChange={(e) => updatePolicyField('block_duration_minutes', Number(e.target.value))} className={`${selectClass} mt-1 w-full`}>{[[10, '10 minutos'], [15, '15 minutos'], [30, '30 minutos'], [60, '60 minutos'], [120, '2 horas'], [240, '4 horas'], [360, '6 horas'], [720, '12 horas'], [1440, '24 horas']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="text-sm text-slate-700">Bloqueio automático<select value={policy.auto_block_enabled ? 'enabled' : 'disabled'} onChange={(e) => updatePolicyField('auto_block_enabled', e.target.value === 'enabled')} className={`${selectClass} mt-1 w-full`}><option value="enabled">Ativado</option><option value="disabled">Desativado</option></select></label>
          </div>
          <button type="button" onClick={savePolicy} disabled={isLoading} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm disabled:opacity-50">Salvar política</button>
        </section>

        <section className="space-y-3">
          <h4 className="font-semibold text-slate-900">Tentativas de Login</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50"><tr>{['IP', 'E-mail', 'Última tentativa', 'Status atual', 'Ações'].map((label) => <th key={label} className="px-2 py-2 text-left">{label}</th>)}</tr></thead>
              <tbody>{failures.length ? failures.map((item) => {
                const status = failureStatus(item.status);
                return (
                  <tr key={item.ip_address} className="border-t">
                    <td className="px-2 py-[7px] font-mono">{item.ip_address}</td>
                    <td className="px-2 py-[7px]">{item.latest_email_attempted || '-'}</td>
                    <td className="whitespace-nowrap px-2 py-[7px]">{formatDateTimeShort(item.last_attempt_at)}</td>
                    <td className="px-2 py-[7px]"><span className="inline-flex items-center gap-1 text-xs"><span className={`h-2 w-2 rounded-full ${status.dotClass}`} />{status.label}</span></td>
                    <td className="px-2 py-[7px]"><select defaultValue="" onChange={(e) => { handleFailureAction(item, e.target.value); e.target.value = ''; }} className="w-40 max-w-[160px] rounded border border-slate-300 bg-white px-2 py-1 text-xs"><option value="" disabled>Ações</option><option value="temporary_block">Bloquear temporariamente</option><option value="block">Bloquear permanentemente</option><option value="allow">Adicionar à whitelist</option></select></td>
                  </tr>
                );
              }) : <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-500">Nenhuma tentativa encontrada.</td></tr>}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => loadFailures(failurePagination.page - 1)} disabled={failurePagination.page <= 1} className="text-sm disabled:opacity-40">Anterior</button>
            <div className="flex items-center gap-3"><span className="text-sm">Página {failurePagination.page} de {Math.max(1, failurePagination.total_pages)}</span><label className="flex items-center gap-1 text-xs text-slate-600">Por página<select value={failureLimit} onChange={(e) => setFailureLimit(Number(e.target.value))} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"><option value={10}>10</option><option value={30}>30</option></select></label></div>
            <button onClick={() => loadFailures(failurePagination.page + 1)} disabled={failurePagination.page >= failurePagination.total_pages} className="text-sm disabled:opacity-40">Próxima</button>
          </div>
        </section>
      </div>
    </SettingsAccordionCard>
  );
}
