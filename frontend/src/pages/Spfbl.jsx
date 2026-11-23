import { useCallback, useEffect, useState } from 'react';
import { Bug } from 'lucide-react';
import SpfblSettingsPanel from '../components/spfbl/SpfblSettingsPanel';
import SpfblDomainsPanel from '../components/spfbl/SpfblDomainsPanel';
import SpfblAccessPanel from '../components/spfbl/SpfblAccessPanel';
import SpfblOwnScope from '../components/spfbl/SpfblOwnScope';
import SpfblDashboard from '../components/spfbl/SpfblDashboard';
import SpfblHistory from '../components/spfbl/SpfblHistory';
import SpfblRequests from '../components/spfbl/SpfblRequests';
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

function AdminView({ overview, onOverviewChange }) {
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
  }, []);

  return (
    <div className="space-y-6">
      <Summary overview={overview} />
      {errors.settings && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errors.settings}</p>}
      {settings && (
        <SpfblSettingsPanel
          settings={settings}
          onSettingsChange={(next) => { setSettings(next); refreshOverview(); }}
          onDomainsChanged={reloadAfterSync}
        />
      )}
      <SpfblDomainsPanel domains={domains} loadError={errors.domains} onReload={loadDomains} />
      <SpfblAccessPanel grants={grants} users={users} domains={domains} loadError={errors.access} onReload={loadAccess} />
    </div>
  );
}

const TABS = { dashboard: 'Dashboard', history: 'Histórico', requests: 'Solicitações', settings: 'Configuração', access: 'Meu acesso' };

export default function Spfbl() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('dashboard');

  useEffect(() => {
    let active = true;
    getOverview()
      .then((data) => { if (active) setOverview(data); })
      .catch((failure) => { if (active) setError(describeError(failure, 'Não foi possível abrir o módulo SPFBL.')); });
    return () => { active = false; };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="flex items-center text-2xl font-bold text-slate-900"><Bug className="mr-2 h-6 w-6 text-indigo-500" aria-hidden="true" />SPFBL</h1>
        <p className="mt-1 text-sm text-slate-600">Consulta e gestão de bloqueios de e-mail do Matrix SPFBL.</p>
      </header>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!overview && !error && <p role="status" className="text-sm text-slate-600">Carregando...</p>}
      {overview && (
        <nav aria-label="Seções do SPFBL" className="flex flex-wrap gap-1 border-b border-slate-200">
          {Object.keys(TABS).filter((key) => (overview.role === 'super_admin' ? key !== 'access' : key !== 'settings')).map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
              className={`min-h-9 border-b-2 px-3 text-sm font-medium ${tab === key ? 'border-blue-800 text-blue-800' : 'border-transparent text-slate-700 hover:text-slate-900'}`}>{TABS[key]}</button>
          ))}
        </nav>
      )}
      {overview && tab === 'dashboard' && <SpfblDashboard />}
      {overview && tab === 'history' && <SpfblHistory />}
      {overview && tab === 'requests' && <SpfblRequests />}
      {overview?.role === 'super_admin' && tab === 'settings' && <AdminView overview={overview} onOverviewChange={setOverview} />}
      {overview?.role === 'user' && tab === 'access' && <SpfblOwnScope overview={overview} />}
    </div>
  );
}
