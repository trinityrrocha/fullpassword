import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import SettingsAccordionCard from './SettingsAccordionCard';

const selectClass = 'border border-slate-300 rounded-md px-[9px] py-[6px] text-sm bg-white';
const defaultPolicy = { auto_block_enabled: true, failed_attempts_threshold: 5, observation_window_minutes: 15, block_duration_minutes: 30 };
const statusClass = { whitelisted: 'bg-green-100 text-green-800', permanently_blocked: 'bg-red-100 text-red-800', temporary_blocked: 'bg-amber-100 text-amber-800', normal: 'bg-slate-100 text-slate-700' };

export default function SecurityCard({ onViewAudit }) {
  const [policy, setPolicy] = useState(defaultPolicy);
  const [failures, setFailures] = useState([]);
  const [failurePagination, setFailurePagination] = useState({ page: 1, total_pages: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const showError = (error) => setMessage({ type: 'error', text: error.response?.data?.error || 'Não foi possível concluir a operação.' });
  const updatePolicyField = (field, value) => setPolicy((current) => ({ ...current, [field]: value }));

  const loadPolicy = useCallback(async () => {
    const response = await api.get('/system/login-security-policy');
    setPolicy(response.data.policy || defaultPolicy);
  }, []);

  const loadFailures = useCallback(async (page = 1) => {
    const response = await api.get('/system/login-failures', { params: { page, limit: 50 } });
    setFailures(response.data.items || []);
    setFailurePagination(response.data.pagination || { page, total_pages: 0 });
  }, []);

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
    if (action === 'audit') return onViewAudit?.({ action: 'login_failed', user_email: item.latest_email_attempted || '' });
  };

  return (
    <SettingsAccordionCard id="security-card" title="Segurança" icon={<ShieldCheck className="w-5 h-5 mr-2 text-indigo-500" />} headerAction={<button type="button" onClick={refresh} disabled={isLoading} className="text-indigo-600 disabled:opacity-50" title="Atualizar segurança"><RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} /></button>}>
      <div className="space-y-8">
        <div className="space-y-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-4">
          <p className="flex items-center font-medium"><AlertTriangle className="w-4 h-4 mr-2" /> Cuidado: bloquear IP incorreto pode impedir acesso legítimo.</p><p>O IP atual do Super Admin não pode ser bloqueado.</p><p>Whitelist prevalece sobre bloqueios automáticos e permanentes.</p>
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

        <section className="space-y-3"><h4 className="font-semibold text-slate-900">Tentativas de Login</h4><div className="overflow-x-auto border border-slate-200 rounded-lg"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{['IP', 'País', 'E-mail recente', 'Primeira tentativa', 'Última tentativa', 'Quantidade', 'Status atual', 'Ações'].map((l) => <th key={l} className="px-[9px] py-[9px] text-left">{l}</th>)}</tr></thead><tbody>{failures.length ? failures.map((item) => <tr key={item.ip_address} className="border-t"><td className="px-[9px] py-[9px] font-mono">{item.ip_address}</td><td className="px-[9px] py-[9px]">{item.country || '-'}</td><td className="px-[9px] py-[9px]">{item.latest_email_attempted || '-'}</td><td className="px-[9px] py-[9px] whitespace-nowrap">{new Date(item.first_attempt_at).toLocaleString('pt-BR')}</td><td className="px-[9px] py-[9px] whitespace-nowrap">{new Date(item.last_attempt_at).toLocaleString('pt-BR')}</td><td className="px-[9px] py-[9px]">{item.attempt_count}</td><td className="px-[9px] py-[9px]"><span className={`px-[6px] py-[3px] rounded-full text-xs ${statusClass[item.status]}`}>{item.status}</span></td><td className="px-[9px] py-[9px]"><select defaultValue="" onChange={(e) => { handleFailureAction(item, e.target.value); e.target.value = ''; }} className={selectClass}><option value="" disabled>Ações</option><option value="temporary_block">Bloquear temporariamente</option><option value="block">Bloquear permanentemente</option><option value="allow">Adicionar à whitelist</option><option value="audit">Ver eventos na auditoria</option></select></td></tr>) : <tr><td colSpan={8} className="px-[9px] py-[18px] text-center text-slate-500">Nenhuma tentativa encontrada.</td></tr>}</tbody></table></div>
          <div className="flex justify-between"><button onClick={() => loadFailures(failurePagination.page - 1)} disabled={failurePagination.page <= 1} className="text-sm disabled:opacity-40">Anterior</button><span className="text-sm">Página {failurePagination.page} de {Math.max(1, failurePagination.total_pages)}</span><button onClick={() => loadFailures(failurePagination.page + 1)} disabled={failurePagination.page >= failurePagination.total_pages} className="text-sm disabled:opacity-40">Próxima</button></div>
        </section>
      </div>
    </SettingsAccordionCard>
  );
}
