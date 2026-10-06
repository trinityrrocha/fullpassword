import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import { openSharedItem } from '../services/sharedItemService';
import { ReadOnlyAttachments } from './ReadOnlyDetailsModal';

function ReadOnlyValue({name,value}) {
  const [revealed,setRevealed]=useState(false);
  if(value && typeof value==='object') return <dl className="space-y-2 border-l border-slate-200 pl-3 dark:border-slate-700">
    {Object.entries(value).map(([key,entry])=><div key={key}><dt className="font-medium">{key}</dt><dd><ReadOnlyValue name={key} value={entry} /></dd></div>)}
  </dl>;
  const sensitive=/password|senha|secret|token/i.test(name);
  return <span className="break-all">{sensitive && !revealed ? '••••••••' : String(value ?? '-')}
    {sensitive && <button type="button" aria-pressed={revealed} onClick={()=>setRevealed(current=>!current)} className="ml-2 cursor-pointer rounded border px-2 py-1 focus-visible:outline focus-visible:outline-2">{revealed ? 'Ocultar' : 'Mostrar'}</button>}
  </span>;
}
export default function SharedItemsPanel() {
  const {user,identityKeys}=useAuth();
  const [items,setItems]=useState([]),[snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const abort=useRef(null), epoch=useRef(0);
  useClearOnVaultLock(()=>{epoch.current+=1;abort.current?.abort();setSnapshot(null);setBusy(false);setError('');});
  useEffect(()=>{
    const controller=new AbortController();
    api.get('/crypto/shared-items',{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setItems(data.items);}).catch(()=>{if(!controller.signal.aborted)setError('Não foi possível carregar os itens compartilhados.');});
    return ()=>{controller.abort();abort.current?.abort();};
  },[]);
  const open=async item=>{
    abort.current?.abort();abort.current=new AbortController();
    const signal=abort.current.signal, generation=epoch.current;
    setBusy(true);setError('');setSnapshot(null);
    try {
      const value=await openSharedItem({api,itemId:item.id,user,keys:identityKeys,signal});
      if(!signal.aborted && generation===epoch.current)setSnapshot(value);
    } catch {if(!signal.aborted && generation===epoch.current)setError('Item indisponível. Desbloqueie sua identidade ou solicite a migração ao proprietário.');}
    finally {if(!signal.aborted && generation===epoch.current)setBusy(false);}
  };
  if(!items.length && !error) return null;
  return <section aria-label="Itens compartilhados diretamente" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
    <h2 className="font-semibold">Itens compartilhados diretamente</h2>
    <p>Somente leitura. Este acesso não libera o restante do cofre.</p>
    {!identityKeys && <p>Desbloqueie sua identidade para visualizar estes itens.</p>}
    <ul className="space-y-2">{items.map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
      <span>{item.client_name} — {item.category}</span>
      <button type="button" disabled={busy || !identityKeys || !item.migrated} onClick={()=>open(item)} className="cursor-pointer rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50">{item.migrated ? 'Visualizar item' : 'Migração pendente'}</button>
    </li>)}</ul>
    <div role="status" aria-live="polite">{busy ? 'Descriptografando item…' : ''}</div>
    {error && <p role="alert">{error}</p>}
    {snapshot && <div className="space-y-3">
      <button type="button" onClick={()=>setSnapshot(null)} className="cursor-pointer rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2">Fechar item</button>
      <ReadOnlyValue key={snapshot.sourceId} name="item" value={snapshot.data} />
      {snapshot.attachment && <ReadOnlyAttachments files={Array.isArray(snapshot.attachment) ? snapshot.attachment : [snapshot.attachment]} />}
    </div>}
  </section>;
}
