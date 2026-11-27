import { Link } from 'react-router-dom';
import { formatDateTime, formatDay } from '../../utils/spfbl';
import { CARD_NEEDS, ago, backupTone, formatBytes, healthPercent, mailSegments, providerLabel, seenFor } from '../../utils/dashboard';

const TONE = Object.freeze({
  ok: { text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  warning: { text: 'text-amber-700', chip: 'bg-amber-50 text-amber-900 ring-amber-200', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  danger: { text: 'text-red-700', chip: 'bg-red-50 text-red-800 ring-red-200', dot: 'bg-red-500', bar: 'bg-red-500' },
  info: { text: 'text-sky-700', chip: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500', bar: 'bg-sky-500' },
  muted: { text: 'text-slate-600', chip: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-300' }
});
// Horizontal bars are drawn in SVG (widths are attributes): the CSP forbids inline style attributes.
const FILL = Object.freeze({ ok: 'fill-emerald-500', warning: 'fill-amber-500', danger: 'fill-red-500', bad: 'fill-red-400' });
const Bar = ({ segments, total }) => {
  const shown = segments.filter(([, n]) => n > 0);
  const widths = shown.map(([, n]) => (n / Math.max(1, total)) * 100);
  return (
    <svg viewBox="0 0 100 1" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      {shown.map(([tone], index) => <rect key={tone} x={widths.slice(0, index).reduce((sum, width) => sum + width, 0)} y="0" width={widths[index]} height="1" className={FILL[tone]} />)}
    </svg>
  );
};
const Chip = ({ tone = 'muted', children }) => <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone].chip}`}>{children}</span>;
const Stat = ({ label, value, tone = 'muted', hint }) => (
  <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60" title={hint}>
    <dd className={`text-2xl font-semibold tabular-nums leading-tight ${value > 0 && tone !== 'muted' ? TONE[tone].text : 'text-slate-900 dark:text-slate-100'}`}>{value}</dd>
    <dt className="text-xs text-slate-600 dark:text-slate-400">{label}</dt>
  </div>
);
const Empty = ({ children }) => <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700">{children}</p>;
const Row = ({ children }) => <li className="flex items-center justify-between gap-3 py-1.5 text-sm">{children}</li>;

// ---------- the eight cards ----------
function DomainsHealth({ data }) {
  const percent = healthPercent(data);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const tone = data.total === 0 ? 'muted' : percent >= 80 ? 'ok' : percent >= 50 ? 'warning' : 'danger';
  const kinds = [['spf', 'SPF'], ['dkim', 'DKIM'], ['dmarc', 'DMARC']];
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`${percent}% dos domínios saudáveis`}>
          <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden="true">
            <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-700" />
            <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(circumference * percent) / 100} ${circumference}`} className={tone === 'ok' ? 'stroke-emerald-500' : tone === 'warning' ? 'stroke-amber-500' : tone === 'danger' ? 'stroke-red-500' : 'stroke-slate-300'} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{percent}%</span>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400"><strong className="text-slate-900 dark:text-slate-100">{data.healthy}</strong> de {data.total} {data.total === 1 ? 'domínio está' : 'domínios estão'} saudáveis: sem vencimento próximo e com SPF, DKIM e DMARC válidos.</p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Vencidos" value={data.expired} tone="danger" />
        <Stat label="Vencem em 30 dias" value={data.expiring} tone="warning" />
        <Stat label="SSL com problema" value={data.ssl_problem} tone="warning" />
      </dl>
      <div className="space-y-1.5">
        {kinds.map(([kind, label]) => {
          const seg = mailSegments(data.mail?.[kind], data.total);
          const total = Math.max(1, data.total);
          return (
            <div key={kind} className="flex items-center gap-2 text-xs" title={`${label}: ${seg.ok} válidos, ${seg.warning} com aviso, ${seg.bad} com falha ou ausentes, ${seg.unknown} sem verificação`}>
              <span className="w-12 font-medium text-slate-700 dark:text-slate-300">{label}</span>
              <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                <Bar segments={[['ok', seg.ok], ['warning', seg.warning], ['danger', seg.bad]]} total={total} />
              </span>
              <span className="w-24 text-right tabular-nums text-slate-600 dark:text-slate-400">{seg.ok} ok · {seg.warning + seg.bad} atenção</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Three aligned columns: the domain, its date and the days left (just the number, in a coloured pill: the column title says the rest).
const EXPIRY_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-x-3';
function DomainExpirations({ data }) {
  if (data.items.length === 0) return <Empty>Nenhum domínio com data de vencimento.</Empty>;
  return (
    <div>
      <div className={`${EXPIRY_COLUMNS} border-b border-slate-100 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800`}>
        <span>Domínio</span><span>Vencimento</span><span className="text-center">Restam</span>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {data.items.map((item) => {
          const tone = item.days_left < 0 ? 'danger' : item.days_left <= 30 ? 'warning' : 'ok';
          const spoken = item.days_left < 0 ? `venceu há ${-item.days_left} ${item.days_left === -1 ? 'dia' : 'dias'}` : item.days_left === 0 ? 'vence hoje' : `faltam ${item.days_left} ${item.days_left === 1 ? 'dia' : 'dias'}`;
          return (
            <li key={item.name} className={`${EXPIRY_COLUMNS} py-1.5 text-sm`}>
              <span className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100" title={item.name}>{item.name}</span>
              <span className="text-xs tabular-nums text-slate-600 dark:text-slate-400">{formatDay(item.expires_on)}</span>
              <span className="flex justify-center"><span title={spoken} aria-label={spoken} className={`inline-flex min-w-9 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${TONE[tone].chip}`}><span aria-hidden="true">{item.days_left}</span></span></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SecurityAlerts({ data }) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <p className="text-sm text-slate-600 dark:text-slate-400"><strong className={`text-2xl font-semibold tabular-nums ${data.total > 0 ? 'text-amber-700' : 'text-slate-900 dark:text-slate-100'}`}>{data.total}</strong> {data.total === 1 ? 'ocorrência' : 'ocorrências'} nos últimos {data.window_days} dias</p>
      {data.items.length === 0 ? <Empty>Nenhum alerta de segurança.</Empty> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 py-1.5 text-sm">
              <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE[item.severity === 'error' ? 'danger' : item.severity === 'warning' ? 'warning' : item.severity === 'success' ? 'ok' : 'info'].dot}`} />
              <span className="min-w-0 flex-1"><Link to={item.target_url} className="block truncate font-medium text-slate-900 hover:text-indigo-700 dark:text-slate-100" title={item.summary}>{item.title}</Link><span className="block truncate text-xs text-slate-500">{item.summary}</span></span>
              <span className="shrink-0 text-xs text-slate-500" title={formatDateTime(item.created_at)}>{ago(item.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UnlockRequests({ data }) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-400"><strong className={`text-3xl font-semibold tabular-nums ${data.pending > 0 ? 'text-amber-700' : 'text-slate-900 dark:text-slate-100'}`}>{data.pending}</strong> {data.pending === 1 ? 'solicitação aguardando' : 'solicitações aguardando'}</p>
        {data.oldest_at && <span className="text-xs text-slate-500" title={formatDateTime(data.oldest_at)}>a mais antiga: {ago(data.oldest_at)}</span>}
      </div>
      {data.items.length === 0 ? <Empty>Nada pendente.</Empty> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.items.map((item) => <Row key={`${item.domain}-${item.requested_at}`}><span className="min-w-0 truncate" title={item.sender}><span className="font-medium text-slate-900 dark:text-slate-100">{item.domain}</span> <span className="text-xs text-slate-500">{item.sender}</span></span><span className="flex shrink-0 items-center gap-2">{item.reopened && <Chip tone="warning">reaberta</Chip>}<span className="text-xs text-slate-500">{ago(item.requested_at)}</span></span></Row>)}
        </ul>
      )}
    </div>
  );
}

function SpamSenders({ data }) {
  if (data.items.length === 0) return <Empty>Nenhum bloqueio nos últimos {data.window_days} dias.</Empty>;
  const max = Math.max(...data.items.map((item) => item.blocked));
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {data.items.map((item) => (
        <li key={item.sender_domain} className="py-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100" title={item.sender_domain}>{item.sender_domain}</span>
            <span className="shrink-0 tabular-nums text-slate-700 dark:text-slate-300">{item.blocked} <span className="text-xs text-slate-500">bloqueios</span></span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true"><Bar segments={[['bad', Math.max(item.blocked, max * 0.04)]]} total={max} /></span>
            <span className="shrink-0 text-xs text-slate-500" title={`Primeiro: ${formatDateTime(item.first_at)} · Último: ${formatDateTime(item.last_at)}`}>há {seenFor(item.first_at, item.last_at)} · {item.targets} {item.targets === 1 ? 'domínio' : 'domínios'}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LoginActivity({ data }) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      <Stat label="Logins com sucesso (24 h)" value={data.success} />
      <Stat label="Falhas de login (24 h)" value={data.failed} tone="warning" />
      <Stat label="IPs com falha" value={data.failed_ips} tone="warning" hint="Quantos endereços diferentes erraram a senha nas últimas 24 horas" />
      <Stat label="Bloqueios ativos" value={data.active_blocks} tone="danger" hint={`${data.auto_blocks} bloqueio(s) automático(s) nas últimas 24 horas`} />
    </dl>
  );
}

function RecentLogins({ data }) {
  if (data.items.length === 0) return <Empty>Nenhum login registrado.</Empty>;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {data.items.map((item, index) => <Row key={`${item.created_at}-${index}`}><span className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100" title={item.user_email}>{item.user_email || '—'}</span><span className="flex shrink-0 items-center gap-2 text-xs text-slate-500"><span className="font-mono">{item.ip_address || '—'}</span><span title={formatDateTime(item.created_at)}>{ago(item.created_at)}</span></span></Row>)}
    </ul>
  );
}

function LastBackup({ data }) {
  const tone = backupTone(data);
  const success = data.last_success;
  const failedAfter = data.last_run?.status === 'failed' && (!success || new Date(data.last_run.at) > new Date(success.at));
  return (
    <div className="flex flex-1 flex-col gap-3">
      {success ? (
        <div>
          <p className="flex flex-wrap items-center gap-2"><span className={`text-2xl font-semibold ${TONE[tone].text}`}>{ago(success.at)}</span><Chip tone={tone}>{tone === 'ok' ? 'em dia' : 'atenção'}</Chip></p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400" title={formatDateTime(success.at)}>{formatDateTime(success.at)} · {providerLabel(success.provider)}{success.size_bytes ? ` · ${formatBytes(success.size_bytes)}` : ''} · {success.trigger === 'manual' ? 'manual' : 'agendado'}</p>
        </div>
      ) : <Empty>Nenhum backup concluído ainda.</Empty>}
      {failedAfter && <p role="status" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">A última tentativa ({providerLabel(data.last_run.provider)}, {ago(data.last_run.at)}) falhou.</p>}
    </div>
  );
}

const BODIES = Object.freeze({ domains_health: DomainsHealth, domain_expirations: DomainExpirations, security_alerts: SecurityAlerts, unlock_requests: UnlockRequests, spam_senders: SpamSenders, login_activity: LoginActivity, recent_logins: RecentLogins, last_backup: LastBackup });

// One card's content: the module off, a failure of its own, or its data. The shell (title, handle) is drawn by the page.
export function CardBody({ id, card }) {
  if (!card) return <Empty>Sem dados.</Empty>;
  if (!card.available) return <Empty>Ative o módulo {CARD_NEEDS[id]} em Configurações para ver este cartão.</Empty>;
  if (card.error) return <Empty>Não foi possível carregar este cartão. Tente atualizar.</Empty>;
  const Body = BODIES[id];
  return <Body data={card.data} />;
}
