import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Puzzle } from 'lucide-react';
import SettingsAccordionCard from './SettingsAccordionCard';
import { listModules, setModuleEnabled } from '../services/spfblService';
import { describeError, MODULES_CHANGED_EVENT } from '../utils/spfbl';

const MODULE_PAGES = Object.freeze({ spfbl: { href: '/spfbl', label: 'Abrir o SPFBL' } });

function ModuleRow({ module, busy, onToggle }) {
  const id = useId();
  const page = MODULE_PAGES[module.key];
  return (
    <li className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 id={`${id}-name`} className="text-sm font-semibold text-slate-900">{module.name}</h3>
        <p id={`${id}-description`} className="mt-1 text-sm text-slate-600">{module.description}</p>
        {module.enabled && page && (
          <Link to={page.href} className="mt-2 inline-block text-sm font-medium text-indigo-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
            {page.label}
          </Link>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`text-sm font-medium ${module.enabled ? 'text-green-700' : 'text-slate-600'}`}>{module.enabled ? 'Ativo' : 'Inativo'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={module.enabled}
          aria-labelledby={`${id}-name`}
          aria-describedby={`${id}-description`}
          disabled={busy}
          onClick={() => onToggle(module)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 ${module.enabled ? 'bg-indigo-600' : 'bg-slate-400'}`}
        >
          <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${module.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </li>
  );
}

// Super Admin only (the page decides). Pessimistic: the switch moves only after the server confirms, and the
// server asks for a fresh reauthentication through the shared api client.
export default function ModulesCard() {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    let active = true;
    listModules()
      .then((list) => { if (active) setModules(list); })
      .catch((error) => { if (active) setMessage({ type: 'error', text: describeError(error, 'Não foi possível carregar os módulos.') }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const toggle = async (module) => {
    const next = !module.enabled;
    setBusyKey(module.key);
    setMessage({ type: '', text: '' });
    try {
      const saved = await setModuleEnabled(module.key, next);
      setModules((current) => current.map((item) => (item.key === saved.key ? { ...item, ...saved } : item)));
      window.dispatchEvent(new Event(MODULES_CHANGED_EVENT));
      setMessage({ type: 'success', text: saved.enabled ? `${saved.name} ativado. O ícone aparece no menu.` : `${saved.name} desativado. O ícone saiu do menu e o acesso foi encerrado.` });
    } catch (error) {
      setMessage({ type: 'error', text: describeError(error, 'Não foi possível alterar o módulo.') });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <SettingsAccordionCard
      id="system-modules"
      title="Módulos"
      description="Ative recursos opcionais do sistema. Cada módulo ativo aparece no menu."
      icon={<Puzzle className="mr-2 h-5 w-5 text-indigo-500" aria-hidden="true" />}
      badge={<span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Super Admin</span>}
    >
      {loading ? (
        <p className="text-sm text-slate-500">Carregando módulos...</p>
      ) : (
        <div className="space-y-4">
          {modules.length === 0 && !message.text && <p className="text-sm text-slate-600">Nenhum módulo disponível.</p>}
          <ul className="space-y-3" aria-label="Módulos disponíveis">
            {modules.map((module) => (
              <ModuleRow key={module.key} module={module} busy={busyKey === module.key} onToggle={toggle} />
            ))}
          </ul>
          {message.text && (
            <p
              role={message.type === 'error' ? 'alert' : 'status'}
              className={`whitespace-pre-line rounded-md border px-3 py-2 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}
    </SettingsAccordionCard>
  );
}
