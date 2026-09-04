import { useState } from 'react';
import { Edit2, Trash2, X } from 'lucide-react';
import CopyButton from './CopyButton';
import ReadOnlyDetailsModal from './ReadOnlyDetailsModal';
import { applyPortDraft, connectionLabel, connectionShortLabel, createPortDraft, editablePortDirection, getServerPorts, hasPortDraft, PORT_DIRECTIONS, removeServerPort, sanitizeServerPort, serverHostHref, WINDOWS_PORT_PROTOCOLS } from '../utils/serverPorts';

const fieldClass = 'h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
const buttonClass = 'h-9 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';
const compactFieldClass = 'h-8 w-10 min-w-0 shrink-0 appearance-none rounded-md border border-slate-300 bg-white px-0.5 text-center text-[10px] leading-none text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export default function ServerPortsPanel({ server, onChange, windows = false, protocols = WINDOWS_PORT_PROTOCOLS, readOnly = false, draft, setDraft, disabled = false }) {
  const [showList, setShowList] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const connections = server.connections || [];
  const ports = getServerPorts(server);
  const selectedConnection = draft?.connectionId || connections[0]?.id || '';
  const updateDraft = (changes) => { setDraft({ ...draft, connectionId: selectedConnection, ...changes }); setError(''); };
  const addPort = () => {
    try {
      onChange(applyPortDraft(server, { ...draft, connectionId: selectedConnection }, windows));
      setDraft(createPortDraft(selectedConnection));
      setError('');
    } catch (failure) { setError(failure.message); }
  };
  const editPort = (rule) => {
    if (hasPortDraft(draft)) { setError('Adicione ou cancele o rascunho atual antes de editar outra porta.'); setShowList(false); return; }
    setDraft({ ...rule, direction: editablePortDirection(rule.direction), editing: { source: rule.source, index: rule.index } });
    setShowList(false);
  };
  const filtered = ports.filter((rule) => [
    rule.name, rule.portNumber, rule.direction, rule.protocol, rule.host, rule.isTs ? 'TS Sim' : 'Não',
    connectionLabel(connections.find((connection) => connection.id === rule.connectionId), connections)
  ].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return (
    <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{windows ? 'Portas e TS' : 'Portas'}</h4>
      {!readOnly && (
        <fieldset disabled={disabled} className="rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap" data-server-port-form>
            <select aria-label="Conexão da porta" title={connectionLabel(connections.find((connection) => connection.id === selectedConnection), connections)} className={compactFieldClass} disabled={!connections.length} value={selectedConnection} onChange={(e) => updateDraft({ connectionId: e.target.value })}>
              <option value="" title="Selecione a conexão">—</option>
              {connections.map((connection) => <option key={connection.id} value={connection.id} title={connectionLabel(connection, connections)}>{connectionShortLabel(connection, connections)}</option>)}
            </select>
            <input aria-label="Porta" title="Porta (1 a 65535)" placeholder="Porta" className={compactFieldClass} inputMode="numeric" maxLength={5} value={draft.portNumber} onChange={(e) => updateDraft({ portNumber: sanitizeServerPort(e.target.value) })} />
            <select aria-label="Entrada/Saída" title={draft.direction} className={compactFieldClass} value={draft.direction} onChange={(e) => updateDraft({ direction: e.target.value })}>{PORT_DIRECTIONS.map((option) => <option key={option} value={option} title={option}>{option === 'Entrada' ? 'Ent.' : 'Saí.'}</option>)}</select>
            <select aria-label="Protocolo" title={draft.protocol} className={compactFieldClass} value={draft.protocol} onChange={(e) => updateDraft({ protocol: e.target.value })}>{[...new Set([...protocols, draft.protocol])].map((option) => <option key={option} value={option} title={option}>{option === 'TCP/UDP' ? 'T/U' : option}</option>)}</select>
            {windows && <label className="inline-flex h-8 shrink-0 items-center gap-1 text-xs text-slate-600 dark:text-slate-300" title="Terminal Service">
              <input type="checkbox" aria-label="TS" className="h-3.5 w-3.5 accent-indigo-600" checked={draft.isTs} onChange={(e) => updateDraft({ isTs: e.target.checked, host: e.target.checked ? draft.host : '' })} /> TS
            </label>}
            {(!windows || draft.isTs) && <input aria-label="Host/DDNS" title="Host/DDNS" placeholder="Host/DDNS" className="h-8 min-w-0 flex-1 basis-28 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:basis-0" value={draft.host} onChange={(e) => updateDraft({ host: e.target.value })} />}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button type="button" data-vault-action={draft.editing ? 'edit' : 'add'} disabled={!connections.length} className="h-8 shrink-0 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" onClick={addPort}>{draft.editing ? 'Aplicar edição' : 'Adicionar'}</button>
              {hasPortDraft(draft) && <button type="button" title="Cancelar rascunho" aria-label="Cancelar rascunho" className="inline-flex h-8 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200" onClick={() => { setDraft(createPortDraft(selectedConnection)); setError(''); }}><X className="h-3.5 w-3.5" /></button>}
            </div>
          </div>
          {!connections.length && <p className="mt-2 text-xs text-slate-500">Cadastre uma conexão antes de adicionar portas.</p>}
          {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </fieldset>
      )}
      <button type="button" className={buttonClass} onClick={() => { setSearch(''); setShowList(true); }}>Exibir portas configuradas ({ports.length})</button>
      {showList && <ReadOnlyDetailsModal title={`Portas — ${server.name || 'Servidor'}`} onClose={() => setShowList(false)}>
        <input type="search" data-vault-search="true" aria-label="Pesquisar portas" placeholder="Pesquisar portas..." className={fieldClass} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="space-y-2">
          {!filtered.length && <p className="text-sm text-slate-500">Nenhuma porta encontrada.</p>}
          {filtered.map((rule) => <div key={`${rule.source}-${rule.index}`} className="space-y-2 break-words rounded-md border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
            {rule.name && <p>{rule.name}</p>}
            <p title={connectionLabel(connections.find((connection) => connection.id === rule.connectionId), connections)}>Conexão: {connectionShortLabel(connections.find((connection) => connection.id === rule.connectionId), connections)}</p>
            <div className="flex flex-wrap items-center gap-2"><span>Porta: {rule.portNumber}</span><CopyButton value={rule.portNumber} label="Copiar porta" /><span>Entrada/Saída: {rule.direction} · Protocolo: {rule.protocol}</span>{windows && <span>TS: {rule.isTs ? 'Sim' : 'Não'}</span>}</div>
            {rule.host && (!windows || rule.isTs) && <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 break-all">Host/DDNS: {rule.isTs && serverHostHref(rule.host) ? <a className="hover:underline" href={serverHostHref(rule.host)} target="_blank" rel="noopener noreferrer">{rule.host}</a> : rule.host}</span><CopyButton value={rule.host} label="Copiar Host/DDNS" /></div>}
            {!readOnly && <div className="flex gap-2">
              <button type="button" data-vault-action="edit" disabled={disabled} aria-label="Editar porta" className={buttonClass} onClick={() => editPort(rule)}><Edit2 className="h-4 w-4" /></button>
              <button type="button" disabled={disabled || Boolean(draft.editing)} aria-label="Excluir porta" className="text-red-600 dark:text-red-400" onClick={() => { if (window.confirm('Excluir esta porta? A alteração será aplicada ao salvar o servidor.')) onChange(removeServerPort(server, rule)); }}><Trash2 className="h-4 w-4" /></button>
            </div>}
          </div>)}
        </div>
      </ReadOnlyDetailsModal>}
    </section>
  );
}
