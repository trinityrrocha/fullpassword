import { useState } from 'react';
import { Database, Globe, Server, Settings as SettingsIcon } from 'lucide-react';
import FormDialog from '../FormDialog';
import SpfblServersPanel from './SpfblServersPanel';
import SpfblDomainsPanel from './SpfblDomainsPanel';
import SpfblHistorySettings from './SpfblHistorySettings';
import { serverSummary } from '../../utils/spfbl';

const CARDS = [
  { key: 'servers', title: 'Servidores', icon: Server },
  { key: 'retention', title: 'Retenção do histórico', icon: Database },
  { key: 'domains', title: 'Domínios', icon: Globe }
];

const summaryOf = (key, servers, overview, history) => {
  if (key === 'servers') {
    const { total, withMatrix } = serverSummary(servers);
    return total === 0 ? 'Nenhum servidor' : `${total} ${total === 1 ? 'servidor' : 'servidores'} · ${withMatrix} com Matrix`;
  }
  if (key === 'retention') return history ? `${history.retention_days} dias · coleta a cada ${history.interval_hours} h` : 'Global, vale para todos os servidores';
  const without = overview.domains.without_server;
  return `${overview.domains.active} ativos de ${overview.domains.total}${without ? ` · ${without} sem servidor` : ''}`;
};

const DIALOGS = {
  servers: ['Servidores', 'Servidores cPanel (WHM) e a conexão Matrix SPFBL de cada um: cadastre, edite, sincronize os domínios ou remova.'],
  retention: ['Retenção do histórico', 'Parâmetros globais: valem para todos os servidores.'],
  domains: ['Domínios', 'Catálogo de domínios do SPFBL.']
};

// One small card per area; the gear opens that area's configuration in a dialog.
export default function SpfblSettingsTab({ overview, data }) {
  const [open, setOpen] = useState(null);
  const close = () => setOpen(null);
  const onReload = async () => { await data.reloadAfterSync(); await data.refreshOverview(); };
  return (
    <div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CARDS.map(({ key, title, icon: Icon }) => (
          <li key={key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <h2 className="flex items-center text-base font-semibold text-slate-900"><Icon className="mr-2 h-5 w-5 shrink-0 text-indigo-500" aria-hidden="true" />{title}</h2>
              <p className="mt-2 text-sm text-slate-600">{summaryOf(key, data.servers, overview, null)}</p>
            </div>
            <button type="button" onClick={() => setOpen(key)} aria-label={`Configurar ${title}`} title={`Configurar ${title}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <FormDialog title={DIALOGS[open][0]} description={DIALOGS[open][1]} onClose={close} size="xl" guardChanges={false}
          footer={<div className="flex justify-end"><button type="button" onClick={close} className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">Fechar</button></div>}>
          <div className="space-y-6">
            {open === 'servers' && <SpfblServersPanel servers={data.servers} loadError={data.errors.servers} onReload={onReload} />}
            {open === 'retention' && <SpfblHistorySettings />}
            {open === 'domains' && <SpfblDomainsPanel domains={data.domains} loadError={data.errors.domains} onReload={data.loadDomains} />}
          </div>
        </FormDialog>
      )}
    </div>
  );
}
