import { useState } from 'react';
import { Globe, Plug, Server, Settings as SettingsIcon } from 'lucide-react';
import FormDialog from '../FormDialog';
import SpfblServersPanel from './SpfblServersPanel';
import SpfblMatrixPanel from './SpfblMatrixPanel';
import SpfblDomainsPanel from './SpfblDomainsPanel';
import SpfblHistorySettings from './SpfblHistorySettings';
import { serverSummary } from '../../utils/spfbl';

const CARDS = [
  { key: 'matrix', title: 'Conexão Matrix', icon: Plug },
  { key: 'whm', title: 'Servidor WHM', icon: Server },
  { key: 'domains', title: 'Domínios', icon: Globe }
];

const summaryOf = (key, servers, overview) => {
  const { total, withMatrix } = serverSummary(servers);
  if (key === 'matrix') return total === 0 ? 'Nenhuma conexão' : `${withMatrix} de ${total} ${total === 1 ? 'servidor' : 'servidores'}`;
  if (key === 'whm') return total === 0 ? 'Nenhum servidor' : `${total} ${total === 1 ? 'servidor' : 'servidores'}`;
  const without = overview.domains.without_server;
  return `${overview.domains.active} ativos de ${overview.domains.total}${without ? ` · ${without} sem servidor` : ''}`;
};

// One small card per area; the gear opens that area's configuration in a dialog.
export default function SpfblSettingsTab({ overview, data }) {
  const [open, setOpen] = useState(null);
  const close = () => setOpen(null);
  const dialogTitle = { matrix: 'Conexão Matrix', whm: 'Servidor WHM (cPanel)', domains: 'Domínios' }[open];
  const onReload = async () => { await data.reloadAfterSync(); await data.refreshOverview(); };
  return (
    <div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CARDS.map(({ key, title, icon: Icon }) => (
          <li key={key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <h2 className="flex items-center text-base font-semibold text-slate-900"><Icon className="mr-2 h-5 w-5 shrink-0 text-indigo-500" aria-hidden="true" />{title}</h2>
              <p className="mt-2 text-sm text-slate-600">{summaryOf(key, data.servers, overview)}</p>
            </div>
            <button type="button" onClick={() => setOpen(key)} aria-label={`Configurar ${title}`} title={`Configurar ${title}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <FormDialog title={dialogTitle} onClose={close} size="xl" guardChanges={false}
          description={open === 'matrix' ? 'Uma conexão Matrix por servidor WHM, mais a retenção e a frequência da coleta do histórico.' : open === 'whm' ? 'Cadastre, edite ou remova servidores. Somente leitura: lista os domínios ativos.' : 'Catálogo de domínios do SPFBL.'}
          footer={<div className="flex justify-end"><button type="button" onClick={close} className="min-h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">Fechar</button></div>}>
          <div className="space-y-6">
            {open === 'whm' && <SpfblServersPanel servers={data.servers} loadError={data.errors.servers} onReload={onReload} />}
            {open === 'matrix' && <SpfblMatrixPanel servers={data.servers} onReload={onReload} />}
            {open === 'matrix' && <SpfblHistorySettings />}
            {open === 'domains' && <SpfblDomainsPanel domains={data.domains} loadError={data.errors.domains} onReload={data.loadDomains} />}
          </div>
        </FormDialog>
      )}
    </div>
  );
}
