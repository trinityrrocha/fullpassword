import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function SettingsAccordionCard({ id, title, icon, description, badge, headerAction, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section id={id} className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
      <div className="flex items-center border-b border-slate-200 bg-slate-50">
        <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center justify-between px-6 py-5 text-left">
          <span className="min-w-0">
            <span className="text-lg leading-6 font-medium text-slate-900 flex items-center">{icon}{title}</span>
            {description && <span className="mt-1 block text-sm text-slate-500">{description}</span>}
          </span>
          <span className="ml-4 flex shrink-0 items-center gap-3">{badge}<ChevronDown className={`h-5 w-5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></span>
        </button>
        {headerAction && <div className="pr-6" onClick={(event) => event.stopPropagation()}>{headerAction}</div>}
      </div>
      {isOpen && <div className="p-6">{children}</div>}
    </section>
  );
}
