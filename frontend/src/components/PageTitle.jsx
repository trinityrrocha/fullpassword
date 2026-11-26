import { useId } from 'react';
import { Info } from 'lucide-react';

// The page title with its one-line description kept out of the way: it opens as a tooltip on hover or keyboard focus (and stays readable
// to screen readers through aria-describedby), so the space under the title goes to the content. The button sits beside the heading,
// not inside it, so the heading's own name stays just the title.
export default function PageTitle({ icon: Icon, iconClassName = 'text-indigo-500', description, children }) {
  const id = useId();
  return (
    <div className="relative flex items-center gap-2">
      {Icon && <Icon className={`h-6 w-6 shrink-0 ${iconClassName}`} aria-hidden="true" />}
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{children}</h1>
      {description && (
        <span className="group inline-flex">
          <button type="button" aria-label={`Sobre ${typeof children === 'string' ? children : 'esta página'}`} aria-describedby={id}
            className="rounded-full p-0.5 text-slate-400 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:hover:text-slate-200">
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
          <span id={id} role="tooltip" className="pointer-events-none absolute left-0 top-full z-[60] mt-1.5 w-72 max-w-full rounded-md bg-slate-800 px-3 py-2 text-xs font-normal leading-snug text-white opacity-0 shadow-lg group-hover:opacity-100 group-focus-within:opacity-100">{description}</span>
        </span>
      )}
    </div>
  );
}
