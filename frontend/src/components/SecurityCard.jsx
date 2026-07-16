import { useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

const selectClass = 'border border-slate-300 rounded-md px-3 py-2 text-sm bg-white';

export default function SecurityCard() {
  const [policy, setPolicy] = useState({
    auto_block_enabled: true,
    failed_attempts_threshold: 5,
    observation_window_minutes: 15,
    block_duration_minutes: 30
  });
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleType, setRuleType] = useState('');

  const updatePolicy = (field, value) => setPolicy((current) => ({ ...current, [field]: value }));

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
      <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
        <h3 className="text-lg leading-6 font-medium text-slate-900 flex items-center">
          <ShieldCheck className="w-5 h-5 mr-2 text-indigo-500" /> Segurança
        </h3>
      </div>
      <div className="p-6 space-y-8">
        <div className="space-y-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-4">
          <p className="flex items-center font-medium"><AlertTriangle className="w-4 h-4 mr-2" /> Cuidado: bloquear IP incorreto pode impedir acesso legítimo.</p>
          <p>O IP atual do Super Admin não pode ser bloqueado.</p>
          <p>Whitelist prevalece sobre bloqueios automáticos e permanentes.</p>
        </div>

        <section className="space-y-4">
          <h4 className="font-semibold text-slate-900">Política de Login</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm text-slate-700">Tentativas falhadas para bloquear
              <select value={policy.failed_attempts_threshold} onChange={(event) => updatePolicy('failed_attempts_threshold', Number(event.target.value))} className={`${selectClass} mt-1 w-full`}>
                {[5, 10, 15].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-700">Janela de contagem
              <select value={policy.observation_window_minutes} onChange={(event) => updatePolicy('observation_window_minutes', Number(event.target.value))} className={`${selectClass} mt-1 w-full`}>
                {[10, 15, 30, 60].map((value) => <option key={value} value={value}>{value} minutos</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-700">Tempo de bloqueio automático
              <select value={policy.block_duration_minutes} onChange={(event) => updatePolicy('block_duration_minutes', Number(event.target.value))} className={`${selectClass} mt-1 w-full`}>
                {[[10, '10 minutos'], [15, '15 minutos'], [30, '30 minutos'], [60, '60 minutos'], [120, '2 horas'], [240, '4 horas'], [360, '6 horas'], [720, '12 horas'], [1440, '24 horas']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-700">Bloqueio automático
              <select value={policy.auto_block_enabled ? 'enabled' : 'disabled'} onChange={(event) => updatePolicy('auto_block_enabled', event.target.value === 'enabled')} className={`${selectClass} mt-1 w-full`}>
                <option value="enabled">Ativado</option><option value="disabled">Desativado</option>
              </select>
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="font-semibold text-slate-900">Tentativas de Login</h4>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{['IP', 'País', 'E-mail recente', 'Primeira tentativa', 'Última tentativa', 'Quantidade', 'Status atual', 'Ações'].map((label) => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead><tbody><tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Nenhuma tentativa carregada.</td></tr></tbody></table>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="font-semibold text-slate-900">Blacklist / Whitelist</h4>
          <div className="flex flex-col sm:flex-row gap-3">
            <input value={ruleSearch} onChange={(event) => setRuleSearch(event.target.value)} placeholder="Pesquisar por IP" className="border border-slate-300 rounded-md px-3 py-2 text-sm flex-1" />
            <select value={ruleType} onChange={(event) => setRuleType(event.target.value)} className={selectClass}><option value="">Todos</option><option value="block">Blacklist</option><option value="allow">Whitelist</option></select>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{['IP', 'Tipo', 'Motivo', 'Criado por', 'Criado em', 'Status', 'Ação'].map((label) => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead><tbody><tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Nenhuma regra carregada.</td></tr></tbody></table>
          </div>
        </section>
      </div>
    </div>
  );
}
