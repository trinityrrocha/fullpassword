import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const dialogs = [];
let backgroundState;
function registerDialog(node) {
  if (!dialogs.length) {
    const root = document.getElementById('root');
    backgroundState = {root, inert: root?.inert, overflow: document.body.style.overflow};
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
  }
  dialogs.push(node);
  dialogs.forEach(item => {item.inert = item !== dialogs.at(-1);});
  return () => {
    dialogs.splice(dialogs.indexOf(node), 1);
    dialogs.forEach(item => {item.inert = item !== dialogs.at(-1);});
    if (!dialogs.length && backgroundState) {
      if (backgroundState.root) backgroundState.root.inert = backgroundState.inert;
      document.body.style.overflow = backgroundState.overflow;
      backgroundState = undefined;
    }
  };
}

// Shared profile/team dialog: positioned panel, bounded body, persistent actions.
export default function FormDialog({title, description, children, footer, onClose, busy = false, forced = false, child = false, guardChanges = true, saved = false, panelAttribute = {}}) {
  const id = useId(), panel = useRef(null), overlay = useRef(null), closeRef = useRef(onClose), busyRef = useRef(busy);
  const [dirty, setDirty] = useState(false), [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => {if (!busy) {if (guardChanges && dirty && !saved) setConfirmClose(true); else onClose?.();}};
  useLayoutEffect(() => {closeRef.current = requestClose; busyRef.current = busy;});
  useEffect(() => {
    if (!dirty || !guardChanges || saved) return;
    const warn = event => {event.preventDefault();event.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, guardChanges, saved]);
  useEffect(() => {
    const previous = document.activeElement, unregister = registerDialog(overlay.current);
    (panel.current.querySelector('[data-initial-focus]') || panel.current.querySelector('input:not([readonly]):not([disabled]),select') || panel.current).focus();
    const keydown = event => {
      if (overlay.current?.inert) return;
      const activeDialog = document.activeElement?.closest('[role="dialog"]');
      if (activeDialog && activeDialog !== panel.current) return;
      if(event.key === 'Escape' && !forced && !busyRef.current) {event.preventDefault();closeRef.current?.();}
      if(event.key === 'Tab') {
        const fields = [...panel.current.querySelectorAll('input,select,textarea,button,[tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length && !node.closest('[hidden]'));
        if (!panel.current.contains(document.activeElement)) {event.preventDefault();fields[0]?.focus();return;}
        if(event.shiftKey && document.activeElement === fields[0]) {event.preventDefault();fields.at(-1)?.focus();}
        else if(!event.shiftKey && document.activeElement === fields.at(-1)) {event.preventDefault();fields[0]?.focus();}
      }
    };
    document.addEventListener('keydown',keydown);
    return () => {
      document.removeEventListener('keydown',keydown);unregister();
      if(previous?.isConnected) previous.focus();
    };
  }, [forced]);
  return <>{createPortal(<div ref={overlay} data-form-dialog onChangeCapture={() => setDirty(true)} className={`fixed inset-0 flex items-center justify-center p-4 ${child ? 'z-[60]' : 'z-50'}`}>
    <button type="button" tabIndex={-1} aria-hidden="true" data-dialog-backdrop disabled={busy || forced} onClick={requestClose} className="absolute inset-0 z-0 bg-slate-950/70" />
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={description ? id+'-description' : undefined} aria-busy={busy} tabIndex={-1} data-modal-panel data-focus-return data-form-dirty={dirty} {...panelAttribute}
      className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="min-w-0"><h2 id={id} className="text-base font-semibold">{title}</h2>{description && <p id={id+'-description'} className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>}</div>
        {!forced && <button type="button" disabled={busy} onClick={requestClose} aria-label={`Fechar ${title}`} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed dark:text-slate-300 dark:hover:bg-slate-800"><X aria-hidden="true" className="h-5 w-5" /></button>}
      </header>
      <div data-dialog-body className="min-h-0 overflow-y-auto p-4">{children}</div>
      {footer && <footer onClickCapture={event => {if(event.target.closest('[data-dialog-cancel]')) {event.preventDefault();event.stopPropagation();requestClose();}}} className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">{footer}</footer>}
    </section>
  </div>,document.body)}{confirmClose && <FormDialog title="Descartar alterações?" child guardChanges={false} onClose={() => setConfirmClose(false)} footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" data-initial-focus onClick={() => setConfirmClose(false)} className="rounded-md border px-3 py-2 text-sm">Continuar editando</button><button type="button" onClick={() => {setConfirmClose(false);onClose?.();}} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">Descartar</button></div>}><p className="text-sm">Você tem alterações não salvas. Deseja descartá-las?</p></FormDialog>}</>;
}
