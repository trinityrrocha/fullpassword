import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, ListPlus } from 'lucide-react';
import api from '../services/api';
import { formatDateTimeShort } from '../utils/formatDateTimeShort';
import SettingsAccordionCard from './SettingsAccordionCard';

const ruleLabels = { allow: 'Whitelist', block: 'Blacklist permanente', temporary_block: 'Blacklist temporária' };
const durations = [[10, '10 minutos'], [15, '15 minutos'], [30, '30 minutos'], [60, '60 minutos'], [120, '2 horas'], [240, '4 horas'], [360, '6 horas'], [720, '12 horas'], [1440, '24 horas']];
const fieldClass = 'w-full rounded-md border border-slate-300 px-[9px] py-[6px] text-sm';

export default function ManualIpRulesCard() {
  const [form, setForm] = useState({ ip_address: '', rule_type: 'allow', duration_minutes: 60, reason: '' });
  const [filters, setFilters] = useState({ ip_address: '', rule_type: '' });
  const [rules, setRules] = useState([]);
  const [selectedRule, setSelectedRule] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const loadRules = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = { is_active: true };
      if (filters.ip_address) params.ip_address = filters.ip_address;
      if (filters.rule_type) params.rule_type = filters.rule_type;
      const response = await api.get('/system/ip-rules', { params });
      setRules(response.data.rules || []);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Não foi possível carregar as regras.' });
    } finally { setIsLoading(false); }
  }, [filters.ip_address, filters.rule_type]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const addRule = async (event) => {
    event.preventDefault();
    setIsLoading(true); setMessage(null);
    try {
      await api.post('/system/ip-rules', {
        ip_address: form.ip_address.trim(), rule_type: form.rule_type, reason: form.reason.trim(),
        ...(form.rule_type === 'temporary_block' ? { duration_minutes: Number(form.duration_minutes) } : {})
      });
      setForm((current) => ({ ...current, ip_address: '', reason: '' }));
      setMessage({ type: 'success', text: 'Regra adicionada com sucesso.' });
      await loadRules();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Não foi possível adicionar a regra.' });
    } finally { setIsLoading(false); }
  };

  const deactivateRule = async (id) => {
    setIsLoading(true); setMessage(null);
    try {
      await api.patch(`/system/ip-rules/${id}/deactivate`);
      setMessage({ type: 'success', text: 'Regra desativada.' });
      await loadRules();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Não foi possível desativar a regra.' });
    } finally { setIsLoading(false); }
  };

  return (
    <>
      <SettingsAccordionCard title="Blacklist / Whitelist Manual" icon={<ListPlus className="w-5 h-5 mr-2 text-indigo-500" />}>
      <div className="space-y-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="flex font-medium"><AlertTriangle className="mr-2 h-4 w-4 shrink-0" />Cuidado: bloquear um CIDR incorreto pode impedir acesso legítimo de uma rede inteira. O IP atual do Super Admin não pode ser bloqueado. Whitelist prevalece sobre blacklist.</p>
        </div>
        {message && <div className={`rounded-md border p-3 text-sm ${message.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</div>}
        <form onSubmit={addRule} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-700">IP ou CIDR<input required value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="45.4.109.122, 45.4.109.0/24 ou 2804:xxxx::/32" className={`${fieldClass} mt-1`} /></label>
          <label className="text-sm text-slate-700">Tipo<select value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value })} className={`${fieldClass} mt-1 bg-white`}><option value="allow">Whitelist</option><option value="block">Blacklist permanente</option><option value="temporary_block">Blacklist temporária</option></select></label>
          {form.rule_type === 'temporary_block' && <label className="text-sm text-slate-700">Duração<select value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} className={`${fieldClass} mt-1 bg-white`}>{durations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <label className="text-sm text-slate-700">Motivo (opcional)<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={500} className={`${fieldClass} mt-1`} /></label>
          <div className="md:col-span-2"><button disabled={isLoading} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Adicionar regra</button></div>
        </form>
        <div className="flex flex-col gap-3 sm:flex-row"><input value={filters.ip_address} onChange={(e) => setFilters({ ...filters, ip_address: e.target.value })} placeholder="Pesquisar por IP/CIDR" className={`${fieldClass} flex-1`} /><select value={filters.rule_type} onChange={(e) => setFilters({ ...filters, rule_type: e.target.value })} className={`${fieldClass} bg-white sm:w-64`}><option value="">Todos</option><option value="allow">Whitelist</option><option value="block">Blacklist permanente</option><option value="temporary_block">Blacklist temporária</option></select></div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr>{['IP/CIDR', 'Tipo', 'Motivo', 'Criado por', 'Criado em', 'Ação'].map((label) => <th key={label} className="px-2 py-2 text-left">{label}</th>)}</tr></thead>
            <tbody>{rules.length ? rules.map((rule) => {
              const isAllowed = rule.rule_type === 'allow';
              return (
                <tr key={rule.id} className="border-t">
                  <td className="px-2 py-[7px] font-mono">{rule.ip_address}</td>
                  <td className="px-2 py-[7px]"><span className="inline-flex items-center gap-1 text-xs"><span className={`h-2 w-2 rounded-full ${isAllowed ? 'bg-green-500' : 'bg-red-500'}`} />{isAllowed ? 'Whitelist' : 'Bloqueado'}</span></td>
                  <td className="px-2 py-[7px]"><button type="button" onClick={() => setSelectedRule(rule)} title="Ver motivo" aria-label={`Ver motivo da regra ${rule.ip_address}`} className="rounded p-1 text-indigo-600 hover:bg-indigo-50"><Eye className="h-4 w-4" /></button></td>
                  <td className="px-2 py-[7px]">{rule.created_by_email || '-'}</td>
                  <td className="whitespace-nowrap px-2 py-[7px]">{formatDateTimeShort(rule.created_at)}</td>
                  <td className="px-2 py-[7px]"><button type="button" onClick={() => deactivateRule(rule.id)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">Desativar regra</button></td>
                </tr>
              );
            }) : <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">{isLoading ? 'Carregando regras...' : 'Nenhuma regra encontrada.'}</td></tr>}</tbody>
          </table>
        </div>
      </div>
      </SettingsAccordionCard>
      {selectedRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="rule-reason-title" onClick={() => setSelectedRule(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 id="rule-reason-title" className="text-lg font-semibold text-slate-900">Motivo da regra</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="font-medium text-slate-500">IP/CIDR</dt><dd className="mt-1 font-mono text-slate-900">{selectedRule.ip_address}</dd></div>
              <div><dt className="font-medium text-slate-500">Tipo</dt><dd className="mt-1 text-slate-900">{ruleLabels[selectedRule.rule_type] || selectedRule.rule_type}</dd></div>
              <div><dt className="font-medium text-slate-500">Motivo</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{selectedRule.reason || 'Nenhum motivo informado.'}</dd></div>
            </dl>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setSelectedRule(null)} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Fechar</button></div>
          </div>
        </div>
      )}
    </>
  );
}
