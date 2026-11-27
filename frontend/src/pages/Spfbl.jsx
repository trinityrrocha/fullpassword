import { useCallback, useEffect, useState } from 'react';
import { Bug } from 'lucide-react';
import PageTitle from '../components/PageTitle';
import SpfblSettingsTab from '../components/spfbl/SpfblSettingsTab';
import SpfblAccessPanel from '../components/spfbl/SpfblAccessPanel';
import SpfblOwnScope from '../components/spfbl/SpfblOwnScope';
import SpfblDashboard from '../components/spfbl/SpfblDashboard';
import SpfblHistoryTabs from '../components/spfbl/SpfblHistoryTabs';
import SpfblRequests from '../components/spfbl/SpfblRequests';
import SpfblAudit from '../components/spfbl/SpfblAudit';
import { getOverview, listAccess, listDomains, listUsers, listWhmServers } from '../services/spfblService';
import { describeError } from '../utils/spfbl';

// Super Admin data (WHM servers, domains, grants, users) is loaded once and shared by the settings tab and the access tab.
function useAdminData(enabled, onOverviewChange) {
  const [servers, setServers] = useState([]);
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
  const loadServers = useCallback(async () => {
    try { setServers(await listWhmServers()); setErrors((e) => ({ ...e, servers: '' })); } catch (error) { setErrors((e) => ({ ...e, servers: describeError(error, 'Não foi possível carregar os servidores.') })); }
  }, []);
  const reloadAfterSync = useCallback(async () => { await Promise.all([loadDomains(), loadServers()]); }, [loadDomains, loadServers]);
  const loadAccess = useCallback(async () => {
    try { setGrants(await listAccess()); setErrors((e) => ({ ...e, access: '' })); } catch (error) { setErrors((e) => ({ ...e, access: describeError(error, 'Não foi possível carregar os acessos.') })); }
    await refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    (async () => {
      const [s, d, g, u] = await Promise.allSettled([listWhmServers(), listDomains(), listAccess(), listUsers()]);
      if (!active) return;
      if (s.status === 'fulfilled') setServers(s.value);
      if (d.status === 'fulfilled') setDomains(d.value);
      if (g.status === 'fulfilled') setGrants(g.value);
      if (u.status === 'fulfilled') setUsers(u.value);
      setErrors({
        servers: s.status === 'rejected' ? describeError(s.reason, 'Não foi possível carregar os servidores.') : '',
        domains: d.status === 'rejected' ? describeError(d.reason, 'Não foi possível carregar os domínios.') : '',
        access: g.status === 'rejected' ? describeError(g.reason, 'Não foi possível carregar os acessos.') : ''
      });
    })();
    return () => { active = false; };
  }, [enabled]);

  return { servers, domains, grants, users, errors, refreshOverview, loadDomains, loadAccess, reloadAfterSync };
}

const TABS = { dashboard: 'Dashboard', history: 'Histórico', requests: 'Solicitações', audit: 'Auditoria', access: 'Acessos', settings: 'Configurações do SPFBL' };
const tabsFor = (role) => Object.keys(TABS).filter((key) => (role === 'super_admin' || !['audit', 'settings'].includes(key)));
const tabLabel = (role, key) => (key === 'access' && role !== 'super_admin' ? 'Meu acesso' : TABS[key]);

export default function Spfbl() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
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
    <div className="mx-auto max-w-7xl space-y-5 px-4 pb-4 pt-3 md:px-6 md:pb-6">
      <header>
        <div className="flex items-start justify-between gap-3">
          <PageTitle icon={Bug} iconClassName="text-slate-500" description="Consulta e gestão de bloqueios de e-mail do Matrix SPFBL.">SPFBL</PageTitle>
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
      {overview && tab === 'history' && <SpfblHistoryTabs />}
      {overview && tab === 'requests' && <SpfblRequests />}
      {overview?.role === 'super_admin' && tab === 'audit' && <SpfblAudit />}
      {overview?.role === 'super_admin' && tab === 'access' && (
        <SpfblAccessPanel grants={adminData.grants} users={adminData.users} domains={adminData.domains} loadError={adminData.errors.access} onReload={adminData.loadAccess} />
      )}
      {overview?.role === 'user' && tab === 'access' && <SpfblOwnScope overview={overview} />}
      {overview?.role === 'super_admin' && tab === 'settings' && <SpfblSettingsTab overview={overview} data={adminData} />}
    </div>
  );
}
