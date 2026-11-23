import { useCallback, useEffect, useRef, useState } from 'react';
import SpfblStatusBar from './SpfblStatusBar';
import { getDashboard, refreshHistory } from '../../services/spfblService';
import { COVERAGE_NOTE, describeError, formatDay, formatNumber } from '../../utils/spfbl';

const POLL_MS = 3000;
const CATEGORY_LABELS = [['banimento', 'Banimento'], ['segurança', 'Segurança'], ['inexistência', 'Inexistência']];

function Card({ label, children, note }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label={label}>
      <h3 className="text-sm text-slate-600">{label}</h3>
      <div className="mt-2 text-3xl font-bold text-slate-900">{children}</div>
      {note && <p className="mt-2 text-xs text-slate-600">{note}</p>}
    </section>
  );
}

function Ranking({ title, subtitle, items }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label={title}>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
      {items.length === 0 ? <p className="mt-4 text-sm text-slate-600">Nenhuma tentativa bloqueada no período.</p> : (
        <ol className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
          {items.map((item, index) => (
            <li key={item.name} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-6 text-xs text-slate-500">{String(index + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 break-all text-slate-900">{item.name}</span>
              <strong className="text-slate-900">{formatNumber(item.count)}</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function SpfblDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const next = await getDashboard();
      setData(next); setError('');
      clearTimeout(timer.current);
      if (next.state.loading) timer.current = setTimeout(load, POLL_MS);
    } catch (failure) { setError(describeError(failure, 'Não foi possível carregar o dashboard.')); }
  }, []);
  useEffect(() => { load(); return () => clearTimeout(timer.current); }, [load]);

  const refresh = async () => {
    setBusy(true);
    try { await refreshHistory(); await load(); } catch (failure) { setError(describeError(failure, 'Não foi possível atualizar agora.')); } finally { setBusy(false); }
  };

  if (error && !data) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-600">Carregando...</p>;
  const max = Math.max(1, ...CATEGORY_LABELS.map(([key]) => data.categories[key]));
  const top = data.domains[0];
  return (
    <div className="space-y-4">
      <SpfblStatusBar state={data.state} busy={busy} onRefresh={refresh} />
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <p className="text-sm text-slate-600">Período: {formatDay(data.period.start)} até {formatDay(data.period.end)} (America/Sao_Paulo). A retenção do fornecedor pode não cobrir os sete dias. Rankings contam tentativas bloqueadas pelo motivo original, mesmo após liberação.</p>
      {data.domains_scope.length === 0 && <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Nenhum domínio ativo liberado para você ainda. Fale com o administrador.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card label="Tentativas consultadas" note="Registros no período recuperado">{formatNumber(data.total)}</Card>
        <Card label="Bloqueios registrados" note="Banimento, segurança e inexistência">{formatNumber(data.blocked)}</Card>
      </div>
      <Card label="Domínio com mais incidência" note={top ? `${formatNumber(top.count)} tentativas bloqueadas` : 'Sem bloqueios no período'}>
        <span className="break-all text-2xl">{top ? top.name : '—'}</span>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label="Bloqueios por motivo">
          <h3 className="text-lg font-semibold text-slate-900">Bloqueios por motivo</h3>
          <p className="mt-1 text-sm text-slate-600">Número de tentativas · classificação do portal</p>
          <ul className="mt-4 space-y-4">
            {CATEGORY_LABELS.map(([key, label]) => (
              <li key={key}>
                <div className="flex justify-between text-sm"><span className="text-slate-900">{label}</span><strong>{formatNumber(data.categories[key])}</strong></div>
                <progress className="mt-1 h-3 w-full appearance-none overflow-hidden rounded [&::-webkit-progress-bar]:bg-slate-100 [&::-webkit-progress-value]:bg-blue-700 [&::-moz-progress-bar]:bg-blue-700" max={max} value={data.categories[key]} aria-label={`${label}: ${data.categories[key]}`} />
              </li>
            ))}
          </ul>
        </section>
        <Ranking title="Top 10 domínios" subtitle="Domínios dos destinatários · mais bloqueios" items={data.domains} />
      </div>
      <Ranking title="Top 10 destinatários" subtitle="Endereços com mais tentativas bloqueadas" items={data.recipients} />
    </div>
  );
}
