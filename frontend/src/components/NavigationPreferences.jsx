import { PanelLeft, PanelTop, List, LayoutGrid } from 'lucide-react';

export default function NavigationPreferences({ value, onChange }) {
  return <section className="space-y-2 border-t border-slate-200 pt-3">
    <h4 className="text-sm font-medium text-slate-900">Preferências da interface</h4>
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {[
        ['menu_position', 'Posição do menu', [['side', 'Lateral', PanelLeft], ['top', 'Superior', PanelTop]]],
        ['menu_display', 'Exibição dos itens', [['labels', 'Descrição', List], ['icons', 'Ícones', LayoutGrid]]]
      ].map(([field, legend, options]) => <fieldset key={field}>
        <legend className="mb-1 text-xs text-slate-600">{legend}</legend>
        <div className="flex gap-1">
          {options.map(([option, label, Icon]) => <label key={option} className="cursor-pointer">
            <input type="radio" name={field} value={option} checked={value[field] === option} onChange={() => onChange(field, option)} className="peer sr-only" />
            <span className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 px-2 text-xs text-slate-700 peer-checked:border-indigo-600 peer-checked:bg-indigo-50 peer-checked:text-indigo-700 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:peer-checked:bg-indigo-950 dark:peer-checked:text-indigo-200"><Icon className="h-3.5 w-3.5" />{label}</span>
          </label>)}
        </div>
      </fieldset>)}
    </div>
  </section>;
}
