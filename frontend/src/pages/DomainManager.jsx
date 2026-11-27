import { useCallback, useEffect, useState } from 'react';
import { Bell, Globe, Plus, RefreshCw, Search, SearchAlert, Settings, Settings2, ShieldQuestionMark, Trash2 } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import RecordGeneratorDialog from '../components/domainManager/RecordGeneratorDialog';
import PaginationBar from '../components/PaginationBar';
import { AddDomainDialog, AlertsDialog, DomainDetailDialog, SettingsDialog } from '../components/domainManager/DomainDialogs';
import { checkDomain, listDomains, removeDomain, syncDomains } from '../services/domainManagerService';
import { describeError, formatDateTime } from '../utils/spfbl';
import { SOURCE_LABELS, TONE_CLASSES, alertsLabel, mailMarker, errorLabel, expiryInfo, lookupLabel, sslLabel, syncSummary } from '../utils/domainManager';

const primaryButton = 'inline-flex h-10 items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';
const secondaryButton = 'inline-flex h-10 items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';
const iconButton = 'rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600';
const fieldClass = 'h-10 rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
const MAIL_TONES = Object.freeze({ ok: 'text-green-800', warning: 'text-amber-800', danger: 'text-red-800', muted: 'text-slate-600' });

export default function DomainManager() {
  const [data, setData] = useState({ domains: [], total: 0, page: 1, size: 20, role: null, settings: { check_interval_days: 7 } });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState('name');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [busyId, setBusyId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const next = await listDomains({ page, size, search: term, sort });
        if (active) { setData(next); setMessage((current) => (current.type === 'load' ? { type: '', text: '' } : current)); }
      } catch (error) {
        if (active) setMessage({ type: 'load', text: describeError(error, 'Não foi possível carregar os domínios.') });
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [page, size, term, sort, reloadTick]);
  useEffect(() => { const timer = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);

  const check = async (domain) => {
    setBusyId(domain.id); setMessage({ type: '', text: '' });
    try {
      const result = await checkDomain(domain.id);
      reload();
      setDialog({ kind: 'detail', domain: result.domain, changes: result.changes, mail: result.mail });
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível consultar o domínio.') });
    } finally { setBusyId(null); }
  };

  const sync = async () => {
    setSyncing(true); setMessage({ type: '', text: '' });
    try {
      setMessage(syncSummary(await syncDomains()));
      reload();
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível sincronizar os domínios.') });
    } finally { setSyncing(false); }
  };

  const remove = async (domain) => {
    setBusyId(domain.id); setMessage({ type: '', text: '' });
    try {
      await removeDomain(domain.id); setConfirmId(null); reload();
      setMessage({ type: 'success', text: `${domain.name} removido.` });
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível remover o domínio.') });
    } finally { setBusyId(null); }
  };

  const pages = Math.max(1, Math.ceil(data.total / data.size));
  // Only the Super Admin administers. An account with a grant reads, opens details and runs lookups on its own domains. Until the first
  // answer the role is unknown and no administration control is shown.
  const isAdmin = data.role === 'super_admin';
  // The columns are a grid shared by the header and every row, so the values line up. The SSL column goes away when the check is off.
  const sslOn = data.settings?.ssl_check_enabled !== false;
  const grid = sslOn ? 'md:grid-cols-[minmax(9rem,1fr)_10.5rem_6.5rem_8rem_8.5rem_6rem_7.5rem_6.5rem]' : 'md:grid-cols-[minmax(9rem,1fr)_10.5rem_6.5rem_8rem_8.5rem_7.5rem_6.5rem]';
  const sortHeader = (key, label) => (
    <button type="button" onClick={() => { setSort(key); setPage(1); }} aria-pressed={sort === key} title={`Ordenar por ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-1 rounded text-left text-xs font-semibold uppercase tracking-wide hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${sort === key ? 'text-indigo-700' : 'text-slate-600'}`}>
      {label}{sort === key && <span aria-hidden="true">↑</span>}<span className="sr-only">{sort === key ? ' (ordenado)' : ''}</span>
    </button>
  );
  const plainHeader = (label) => <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 pb-4 pt-3 md:px-6 md:pb-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle icon={Globe} description="Vencimento, DNS e certificado SSL dos domínios, consultados automaticamente por RDAP.">Domain Manager</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-48">
            <span className="sr-only">Buscar domínio</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} autoComplete="off" placeholder="Buscar domínio" className={`${fieldClass} w-full pl-8`} />
          </label>
          {isAdmin && <>
            <button type="button" onClick={() => setDialog({ kind: 'settings' })} aria-label="Configurações do Domain Manager" title="Configurações do Domain Manager" className={`${secondaryButton} px-2.5`}><Settings2 className="h-5 w-5" aria-hidden="true" /></button>
            <button type="button" disabled={syncing} onClick={sync} aria-label="Sincronizar domínios" title="Sincronizar domínios com os servidores WHM" className={`${secondaryButton} px-2.5`}><RefreshCw className={`h-5 w-5 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
            <button type="button" onClick={() => setDialog({ kind: 'generator' })} aria-label="Gerador de registros" title="Gerador de registros (DMARC e SPF)" className={`${secondaryButton} px-2.5`}><ShieldQuestionMark className="h-5 w-5" aria-hidden="true" /></button>
            <button type="button" onClick={() => setDialog({ kind: 'add' })} className={primaryButton}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Adicionar domínios</button>
          </>}
        </div>
      </header>

      {data.role === 'user' && <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Você tem acesso somente leitura aos domínios liberados para a sua conta: pode ver os detalhes e consultar cada um.</p>}

      {message.text && (
        <p role={message.type === 'success' ? 'status' : 'alert'} className={`rounded-md border px-3 py-2 text-sm ${message.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</p>
      )}

      <p role="status" className="text-sm text-slate-600">
        {loading ? 'Carregando…' : data.total === 0 ? (term ? 'Nenhum domínio encontrado.' : isAdmin ? 'Nenhum domínio na lista. Adicione um domínio ou ative o SPFBL para importar os dele.' : 'Nenhum domínio foi liberado para a sua conta.') : `${data.total} ${data.total === 1 ? 'domínio' : 'domínios'}.`}
      </p>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className={`hidden items-center gap-x-3 border-b border-slate-200 bg-slate-50 px-3 py-2 md:grid ${grid}`}>
          <div>{sortHeader('name', 'Domínio')}</div>
          <div>{sortHeader('expiry', 'Vencimento')}</div>
          <div>{plainHeader('SPF')}</div>
          <div>{plainHeader('DKIM')}</div>
          <div>{plainHeader('DMARC')}</div>
          {sslOn && <div>{plainHeader('SSL')}</div>}
          <div>{sortHeader('checked', 'Consulta')}</div>
          <div className="text-right"><span className="sr-only">Ações</span></div>
        </div>
        <ul aria-label="Domínios" className="divide-y divide-slate-200">
          {data.domains.map((domain) => {
            const expiry = expiryInfo(domain.snapshot);
            const busy = busyId === domain.id;
            const problem = domain.snapshot && (domain.snapshot.lookup_status !== 'ok' || domain.snapshot.error_code);
            const lookupText = `${SOURCE_LABELS[domain.source] || domain.source} · ${lookupLabel(domain.snapshot)}${domain.snapshot?.error_code ? ` — ${errorLabel(domain.snapshot.error_code)}` : ''}`;
            return (
              <li key={domain.id} data-domain-row className={`grid min-h-10 grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-1.5 md:h-10 md:py-0 ${grid}`}>
                <div className="col-span-2 flex min-w-0 items-center gap-1.5 md:col-span-1">
                  <button type="button" onClick={() => setDialog({ kind: 'detail', domain })} title={lookupText} className="truncate text-left text-sm font-medium text-indigo-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">{domain.name}</button>
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-medium uppercase text-slate-600">{SOURCE_LABELS[domain.source] || domain.source}</span>
                  {domain.alerts?.enabled && <span title={alertsLabel(domain.alerts)} className="shrink-0 text-indigo-700"><Bell className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{alertsLabel(domain.alerts)}</span></span>}
                </div>
                <div className="whitespace-nowrap text-sm">
                  <span className="sr-only">Vencimento: </span>
                  <span className={`font-medium ${TONE_CLASSES[expiry.tone]}`}>{expiry.text}</span>
                  {expiry.note && <span className={`ml-1 text-xs ${TONE_CLASSES[expiry.tone]}`}>{expiry.note}</span>}
                </div>
                <div data-mail-cell className="contents">
                  {['spf', 'dkim', 'dmarc'].map((kind) => {
                    const marker = mailMarker(kind, domain.mail);
                    return (
                      <span key={kind} title={marker.title} className={`flex items-center gap-1 whitespace-nowrap text-xs ${MAIL_TONES[marker.tone]}`}>
                        <span className="font-medium md:sr-only">{marker.label}</span><span aria-hidden="true">{marker.mark}</span><span className="sr-only">{marker.status}, </span><span>{marker.text}</span>
                      </span>
                    );
                  })}
                </div>
                {sslOn && <div className="whitespace-nowrap text-sm text-slate-700"><span className="sr-only">Certificado SSL: </span>{sslLabel(domain.snapshot?.ssl?.state)}</div>}
                <div className="whitespace-nowrap text-xs text-slate-600">
                  <span className="sr-only">Última consulta: </span>
                  {domain.snapshot ? formatDateTime(domain.snapshot.checked_at) : 'Aguardando'}
                  {problem && <span title={lookupText} className="ml-1 text-amber-700"><span aria-hidden="true">⚠</span><span className="sr-only"> {lookupText}</span></span>}
                </div>
                <div className="flex items-center justify-end gap-0.5">
                  {isAdmin && <button type="button" onClick={() => setDialog({ kind: 'alerts', domain })} title="Configurações do domínio" aria-label={`Configurações de ${domain.name}`} className={iconButton}><Settings className="h-5 w-5" aria-hidden="true" /></button>}
                  <button type="button" disabled={busy} onClick={() => check(domain)} title="Consultar agora" aria-label={`Consultar ${domain.name} agora`} className={iconButton}><SearchAlert className="h-5 w-5" aria-hidden="true" /></button>
                  {isAdmin && domain.source === 'manual' && (confirmId === domain.id ? (
                    <span className="flex items-center gap-1 text-sm">
                      <button type="button" disabled={busy} onClick={() => remove(domain)} className="rounded px-1.5 py-1 font-medium text-red-800 underline">Remover</button>
                      <button type="button" disabled={busy} onClick={() => setConfirmId(null)} className="rounded px-1.5 py-1 font-medium text-slate-700 underline">Cancelar</button>
                    </span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setConfirmId(domain.id)} title="Remover da lista" aria-label={`Remover ${domain.name}`} className={iconButton}><Trash2 className="h-5 w-5" aria-hidden="true" /></button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <PaginationBar label="Paginação de domínios" page={data.page} pages={pages} total={data.total} pageSize={size} onPage={setPage} onPageSize={(next) => { setSize(next); setPage(1); }} />

      {dialog?.kind === 'add' && <AddDomainDialog onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === 'settings' && <SettingsDialog settings={data.settings} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog?.kind === 'generator' && <RecordGeneratorDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'alerts' && <AlertsDialog domain={dialog.domain} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog?.kind === 'detail' && <DomainDetailDialog domain={dialog.domain} changes={dialog.changes} mail={dialog.mail} onClose={() => setDialog(null)} />}
    </div>
  );
}
