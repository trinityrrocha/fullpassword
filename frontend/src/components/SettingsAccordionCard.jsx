import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function SettingsAccordionCard({ id, title, icon, badge, headerAction, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section id={id} className="w-full max-w-[781px] mx-auto bg-white shadow rounded-lg overflow-hidden border border-slate-200">
      <div className="flex h-11 items-center border-b border-slate-200 bg-slate-50">
        <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="flex h-11 min-w-0 flex-1 items-center justify-between px-4 py-0 text-left">
          <span className="min-w-0 truncate">
            <span className="flex min-w-0 items-center truncate text-base font-medium leading-none text-slate-900">{icon}{title}</span>
          </span>
          <span className="ml-4 flex shrink-0 items-center gap-3">{badge}<ChevronDown className={`h-5 w-5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></span>
        </button>
        {headerAction && <div className="flex h-11 shrink-0 items-center pr-4" onClick={(event) => event.stopPropagation()}>{headerAction}</div>}
      </div>
      {isOpen && <div className="p-6">{children}</div>}
    </section>
  );
}
