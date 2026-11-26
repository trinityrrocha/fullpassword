import { useCallback, useEffect, useState } from 'react';
import { Globe, Plus, SearchAlert, Settings, Trash2 } from 'lucide-react';
import PaginationBar from '../components/PaginationBar';
import { AddDomainDialog, DomainDetailDialog, SettingsDialog } from '../components/domainManager/DomainDialogs';
import { checkDomain, listDomains, removeDomain } from '../services/domainManagerService';
import { describeError, formatDateTime } from '../utils/spfbl';
import { SOURCE_LABELS, TONE_CLASSES, errorLabel, expiryInfo, lookupLabel, sslLabel } from '../utils/domainManager';

const primaryButton = 'inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';
const secondaryButton = 'inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';
const iconButton = 'rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600';
const fieldClass = 'rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
const SORTS = Object.freeze([['name', 'Nome'], ['expiry', 'Vencimento'], ['checked', 'Última consulta']]);

export default function DomainManager() {
  const [data, setData] = useState({ domains: [], total: 0, page: 1, size: 20, settings: { check_interval_days: 7 } });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState('name');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [busyId, setBusyId] = useState(null);
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
      setDialog({ kind: 'detail', domain: result.domain, changes: result.changes });
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível consultar o domínio.') });
    } finally { setBusyId(null); }
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

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center text-xl font-semibold text-slate-900"><Globe className="mr-2 h-6 w-6 text-indigo-500" aria-hidden="true" />Domain Manager</h1>
          <p className="mt-1 text-sm text-slate-600">Vencimento, DNS e certificado SSL dos domínios, consultados automaticamente por RDAP.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDialog({ kind: 'settings' })} className={secondaryButton}><Settings className="mr-1.5 h-4 w-4" aria-hidden="true" />Consultas automáticas</button>
          <button type="button" onClick={() => setDialog({ kind: 'add' })} className={primaryButton}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Adicionar domínios</button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm font-medium text-slate-700">Buscar domínio
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} autoComplete="off" className={`${fieldClass} mt-1 w-full`} />
        </label>
        <label className="text-sm font-medium text-slate-700">Ordenar por
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className={`${fieldClass} mt-1 block`}>
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {message.text && (
        <p role={message.type === 'success' ? 'status' : 'alert'} className={`rounded-md border px-3 py-2 text-sm ${message.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</p>
      )}

      <p role="status" className="text-sm text-slate-600">
        {loading ? 'Carregando…' : data.total === 0 ? (term ? 'Nenhum domínio encontrado.' : 'Nenhum domínio na lista. Adicione um domínio ou ative o SPFBL para importar os dele.') : `${data.total} ${data.total === 1 ? 'domínio' : 'domínios'}.`}
      </p>

      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white" aria-label="Domínios">
        {data.domains.map((domain) => {
          const expiry = expiryInfo(domain.snapshot);
          const busy = busyId === domain.id;
          return (
            <li key={domain.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <div className="min-w-48 flex-1">
                <button type="button" onClick={() => setDialog({ kind: 'detail', domain })} className="break-all text-left text-sm font-medium text-indigo-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">{domain.name}</button>
                <p className="text-xs text-slate-600">{SOURCE_LABELS[domain.source] || domain.source} · {domain.snapshot ? `${lookupLabel(domain.snapshot)}${domain.snapshot.error_code ? ` — ${errorLabel(domain.snapshot.error_code)}` : ''}` : 'Aguardando consulta'}{domain.snapshot ? ` · ${formatDateTime(domain.snapshot.checked_at)}` : ''}</p>
              </div>
              <div className="w-40 text-sm">
                <span className="sr-only">Vencimento: </span>
                <span className={`font-medium ${TONE_CLASSES[expiry.tone]}`}>{expiry.text}</span>
                {expiry.note && <span className={`ml-1 text-xs ${TONE_CLASSES[expiry.tone]}`}>{expiry.note}</span>}
              </div>
              <div className="w-24 text-sm text-slate-700"><span className="sr-only">Certificado SSL: </span>{sslLabel(domain.snapshot?.ssl?.state)}</div>
              <div className="flex items-center gap-1">
                <button type="button" disabled={busy} onClick={() => check(domain)} title="Consultar agora" aria-label={`Consultar ${domain.name} agora`} className={iconButton}><SearchAlert className="h-5 w-5" aria-hidden="true" /></button>
                {domain.source === 'manual' && (confirmId === domain.id ? (
                  <span className="flex items-center gap-1 text-sm">
                    <button type="button" disabled={busy} onClick={() => remove(domain)} className="rounded px-2 py-1 font-medium text-red-800 underline">Remover</button>
                    <button type="button" disabled={busy} onClick={() => setConfirmId(null)} className="rounded px-2 py-1 font-medium text-slate-700 underline">Cancelar</button>
                  </span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setConfirmId(domain.id)} title="Remover da lista" aria-label={`Remover ${domain.name}`} className={iconButton}><Trash2 className="h-5 w-5" aria-hidden="true" /></button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <PaginationBar label="Paginação de domínios" page={data.page} pages={pages} total={data.total} pageSize={size} onPage={setPage} onPageSize={(next) => { setSize(next); setPage(1); }} />

      {dialog?.kind === 'add' && <AddDomainDialog onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === 'settings' && <SettingsDialog settings={data.settings} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog?.kind === 'detail' && <DomainDetailDialog domain={dialog.domain} changes={dialog.changes} onClose={() => setDialog(null)} />}
    </div>
  );
}
