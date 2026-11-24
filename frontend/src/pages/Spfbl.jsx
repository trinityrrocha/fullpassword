import { useCallback, useEffect, useState } from 'react';
import { Bug, Settings as SettingsIcon } from 'lucide-react';
import FormDialog from '../components/FormDialog';
import SpfblSettingsPanel from '../components/spfbl/SpfblSettingsPanel';
import SpfblDomainsPanel from '../components/spfbl/SpfblDomainsPanel';
import SpfblAccessPanel from '../components/spfbl/SpfblAccessPanel';
import SpfblOwnScope from '../components/spfbl/SpfblOwnScope';
import SpfblDashboard from '../components/spfbl/SpfblDashboard';
import SpfblHistory from '../components/spfbl/SpfblHistory';
import SpfblRequests from '../components/spfbl/SpfblRequests';
import SpfblAudit from '../components/spfbl/SpfblAudit';
import { getOverview, getSettings, listAccess, listDomains, listUsers } from '../services/spfblService';
import { describeError } from '../utils/spfbl';

function Summary({ overview }) {
  const items = [
    ['Matrix', overview.matrix_configured ? 'Configurado' : 'Não configurado'],
    ['WHM', overview.whm_configured ? 'Configurado' : 'Não configurado'],
    ['Domínios ativos', `${overview.domains.active} de ${overview.domains.total}`],
    ['Usuários com acesso', String(overview.users_with_access)]
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <dt className="text-xs font-medium text-slate-600">{label}</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Super Admin data (settings, domains, grants, users) is loaded once and shared by the settings modal and the access tab.
function useAdminData(enabled, onOverviewChange) {
  const [settings, setSettings] = useState(null);
  const [domains, setDomains] = useState([]);
  const [grants, setGrants] = useState([]);
  const [users, setUsers] = useState([]);
  const [errors, setErrors] = useState({});

  const refreshOverview = useCallback(async () => {
    try { onOverviewChange(await getOverview()); } catch { /* the panels keep their own state */ }
  }, [onOverviewChange]);
  const loadDomains = useCallback(async () => {
    try { setDomains(await listDomains()); setErrors((e) => ({ ...e, domains: '' })); } catch (error) { setErrors((e) => ({ ...e, domains: describeError(error, 'Não foi possível carregar os domínios.') })); }
    await refreshOverview();
  }, [refreshOverview]);
  const loadSettings = useCallback(async () => {
    try { setSettings(await getSettings()); } catch { /* the previous values stay on screen */ }
  }, []);
  const reloadAfterSync = useCallback(async () => { await Promise.all([loadDomains(), loadSettings()]); }, [loadDomains, loadSettings]);
  const loadAccess = useCallback(async () => {
    try { setGrants(await listAccess()); setErrors((e) => ({ ...e, access: '' })); } catch (error) { setErrors((e) => ({ ...e, access: describeError(error, 'Não foi possível carregar os acessos.') })); }
    await refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    (async () => {
      const [s, d, g, u] = await Promise.allSettled([getSettings(), listDomains(), listAccess(), listUsers()]);
      if (!active) return;
      if (s.status === 'fulfilled') setSettings(s.value);
      if (d.status === 'fulfilled') setDomains(d.value);
      if (g.status === 'fulfilled') setGrants(g.value);
      if (u.status === 'fulfilled') setUsers(u.value);
      setErrors({
        settings: s.status === 'rejected' ? describeError(s.reason, 'Não foi possível carregar a configuração.') : '',
        domains: d.status === 'rejected' ? describeError(d.reason, 'Não foi possível carregar os domínios.') : '',
        access: g.status === 'rejected' ? describeError(g.reason, 'Não foi possível carregar os acessos.') : ''
      });
    })();
    return () => { active = false; };
  }, [enabled]);

  return { settings, setSettings, domains, grants, users, errors, refreshOverview, loadDomains, loadAccess, reloadAfterSync };
}

// Connection and catalogue settings live behind the gear icon: they are set once and rarely touched.
function SettingsDialog({ overview, data, onClose }) {
  return (
    <FormDialog title="Configurações do SPFBL" description="Conexão Matrix, servidor WHM (cPanel) e catálogo de domínios." onClose={onClose} size="xl" guardChanges={false}
      footer={<div className="flex justify-end"><button type="button" onClick={onClose} className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">Fechar</button></div>}>
      <div className="space-y-6">
        <Summary overview={overview} />
        {data.errors.settings && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{data.errors.settings}</p>}
        {data.settings && (
          <SpfblSettingsPanel settings={data.settings} onSettingsChange={(next) => { data.setSettings(next); data.refreshOverview(); }} onDomainsChanged={data.reloadAfterSync} />
        )}
        <SpfblDomainsPanel domains={data.domains} loadError={data.errors.domains} onReload={data.loadDomains} />
      </div>
    </FormDialog>
  );
}

const TABS = { dashboard: 'Dashboard', history: 'Histórico', requests: 'Solicitações', audit: 'Auditoria', access: 'Acessos' };
const tabsFor = (role) => Object.keys(TABS).filter((key) => (role === 'super_admin' || !['audit'].includes(key)));
const tabLabel = (role, key) => (key === 'access' && role !== 'super_admin' ? 'Meu acesso' : TABS[key]);

export default function Spfbl() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const adminData = useAdminData(overview?.role === 'super_admin', setOverview);
  const [tab, setTab] = useState(() => { const wanted = new URLSearchParams(window.location.search).get('tab'); return TABS[wanted] ? wanted : 'dashboard'; });

  useEffect(() => {
    let active = true;
    getOverview()
      .then((data) => { if (active) setOverview(data); })
      .catch((failure) => { if (active) setError(describeError(failure, 'Não foi possível abrir o módulo SPFBL.')); });
    return () => { active = false; };
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <header>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center text-2xl font-bold text-slate-900"><Bug className="mr-2 h-6 w-6 text-slate-500" aria-hidden="true" />SPFBL</h1>
            <p className="mt-1 text-sm text-slate-600">Consulta e gestão de bloqueios de e-mail do Matrix SPFBL.</p>
          </div>
          {overview?.role === 'super_admin' && (
            <button type="button" onClick={() => setShowSettings(true)} aria-label="Configurações do SPFBL" title="Configurações do SPFBL" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!overview && !error && <p role="status" className="text-sm text-slate-600">Carregando...</p>}
      {overview && (
        <nav aria-label="Seções do SPFBL" className="flex flex-wrap gap-1 border-b border-slate-200">
          {tabsFor(overview.role).map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
              className={`min-h-9 border-b-2 px-3 text-sm font-medium ${tab === key ? 'border-blue-800 text-blue-800' : 'border-transparent text-slate-700 hover:text-slate-900'}`}>{tabLabel(overview.role, key)}</button>
          ))}
        </nav>
      )}
      {overview && tab === 'dashboard' && <SpfblDashboard role={overview.role} />}
      {overview && tab === 'history' && <SpfblHistory />}
      {overview && tab === 'requests' && <SpfblRequests />}
      {overview?.role === 'super_admin' && tab === 'audit' && <SpfblAudit />}
      {overview?.role === 'super_admin' && tab === 'access' && (
        <SpfblAccessPanel grants={adminData.grants} users={adminData.users} domains={adminData.domains} loadError={adminData.errors.access} onReload={adminData.loadAccess} />
      )}
      {overview?.role === 'user' && tab === 'access' && <SpfblOwnScope overview={overview} />}
      {showSettings && overview?.role === 'super_admin' && <SettingsDialog overview={overview} data={adminData} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
