import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, GripVertical, LayoutDashboard, RefreshCw, SlidersHorizontal } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import { CardBody } from '../components/dashboard/DashboardCards';
import { CARD_ICONS, CARD_LINKS, cardHint } from '../components/dashboard/cardMeta';
import DashboardSettingsDialog from '../components/dashboard/DashboardSettingsDialog';
import { getDashboard, resetDashboardLayout, saveDashboardLayout } from '../services/dashboardService';
import { CARD_TITLES, DEFAULT_LAYOUT, moveBefore, moveStep, normalizeLayout, sameLayout, visibleOrder } from '../utils/dashboard';
import { describeError, formatDateTime } from '../utils/spfbl';

const iconButton = 'inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600';
const REFRESH_MS = 2 * 60 * 1000;

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [announce, setAnnounce] = useState('');
  const [tick, setTick] = useState(0);
  const saveTimer = useRef(null);
  const latest = useRef(DEFAULT_LAYOUT);
  useEffect(() => { latest.current = layout; });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const next = await getDashboard();
        if (!active) return;
        setData(next); setError('');
        // A refresh never overwrites a layout the person is in the middle of changing.
        setLayout((current) => (saveTimer.current ? current : normalizeLayout(next.layout)));
      } catch (failure) { if (active) setError(describeError(failure, 'Não foi possível carregar o dashboard.')); } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [tick]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setTick((value) => value + 1); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const refresh = () => { setLoading(true); setTick((value) => value + 1); };

  // Drag and keyboard moves apply at once and are saved a moment later, once, with the final order.
  const persist = (next) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      try { setLayout(normalizeLayout(await saveDashboardLayout(latest.current))); setNotice(''); } catch { setNotice('Não foi possível salvar a nova ordem. Ela vale só até recarregar a página.'); }
    }, 500);
    setLayout(next);
  };
  const saveFromDialog = async (draft) => {
    clearTimeout(saveTimer.current); saveTimer.current = null;
    setLayout(normalizeLayout(await (sameLayout(draft, DEFAULT_LAYOUT) ? resetDashboardLayout() : saveDashboardLayout(draft))));
    setNotice('');
  };

  const shown = visibleOrder(layout);
  const onDrop = (event, targetId) => {
    event.preventDefault();
    if (dragId && dragId !== targetId) persist({ ...layout, order: moveBefore(layout.order, dragId, targetId) });
    setDragId(null); setOverId(null);
  };
  const onHandleKey = (event, id) => {
    const delta = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = moveStep(layout, id, delta);
    if (next === layout) return;
    persist(next);
    setAnnounce(`${CARD_TITLES[id]} movido para a posição ${visibleOrder(next).indexOf(id) + 1} de ${shown.length}.`);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 pb-4 pt-3 md:px-6 md:pb-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle icon={LayoutDashboard} description="Resumo do que precisa de atenção: domínios, segurança, bloqueios de e-mail e backups. Arraste os cartões para reorganizar.">Dashboard</PageTitle>
        <div className="flex items-center gap-2">
          {data?.generated_at && <span className="hidden text-xs text-slate-500 sm:inline">Atualizado em {formatDateTime(data.generated_at)}</span>}
          <button type="button" onClick={refresh} aria-label="Atualizar dashboard" title="Atualizar" className={iconButton}><RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Configurar dashboard" title="Configurar dashboard" className={iconButton}><SlidersHorizontal className="h-5 w-5" aria-hidden="true" /></button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {loading && !data && <p role="status" className="text-sm text-slate-600">Carregando…</p>}

      {data && shown.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-600">Nenhum cartão visível. Use o ícone de configurações para escolher o que exibir.</p>
      )}

      {data && shown.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-label="Cartões do dashboard">
          {shown.map((id) => {
            const Icon = CARD_ICONS[id];
            const hint = cardHint(id);
            return (
              <li key={id} data-dashboard-card={id} onDragOver={(event) => { if (dragId) { event.preventDefault(); setOverId(id); } }} onDrop={(event) => onDrop(event, id)}
                className={`flex min-h-64 flex-col rounded-xl border bg-white shadow-sm transition-shadow dark:bg-slate-900 ${overId === id && dragId !== id ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200 dark:border-slate-800'} ${dragId === id ? 'opacity-50' : ''}`}>
                <div draggable onDragStart={(event) => { setDragId(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); event.dataTransfer.setDragImage(event.currentTarget.closest('li'), 16, 16); }} onDragEnd={() => { setDragId(null); setOverId(null); }}
                  className="flex cursor-grab items-center gap-2 border-b border-slate-100 px-3 py-2.5 active:cursor-grabbing dark:border-slate-800">
                  <button type="button" onKeyDown={(event) => onHandleKey(event, id)} aria-label={`Mover ${CARD_TITLES[id]}. Use as setas do teclado.`} title="Arraste para mover" className="rounded p-0.5 text-slate-400 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">
                    <GripVertical className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={hint || undefined}>{CARD_TITLES[id]}</h2>
                  <Link to={CARD_LINKS[id]} aria-label={`Abrir ${CARD_TITLES[id]}`} title="Abrir" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"><ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
                </div>
                <div className="flex flex-1 flex-col p-3">
                  {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
                  <CardBody id={id} card={data.cards[id]} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {settingsOpen && <DashboardSettingsDialog layout={layout} onClose={() => setSettingsOpen(false)} onSave={saveFromDialog} />}
    </div>
  );
}
