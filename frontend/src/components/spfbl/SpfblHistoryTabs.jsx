import { useState } from 'react';
import SpfblHistory from './SpfblHistory';
import SpfblSent from './SpfblSent';

const SUBTABS = Object.freeze([['received', 'Recebidos'], ['sent', 'Enviados']]);

// The history has two views: what the domain received (the SPFBL history) and what it sent (read live from the WHM server).
export default function SpfblHistoryTabs() {
  const [tab, setTab] = useState('received');
  const move = (event, index) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = SUBTABS[(index + step + SUBTABS.length) % SUBTABS.length][0];
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`history-subtab-${next}`)?.focus());
  };
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Tipo de histórico" className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
        {SUBTABS.map(([key, label], index) => (
          <button key={key} id={`history-subtab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls="history-subtab-panel" tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={(event) => move(event, index)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id="history-subtab-panel" aria-labelledby={`history-subtab-${tab}`}>{tab === 'received' ? <SpfblHistory /> : <SpfblSent />}</div>
    </div>
  );
}
