import { Monitor, Moon, Sun } from 'lucide-react';
import useTheme from '../hooks/useTheme';

const themeIcons = {
  light: Sun,
  dark: Moon,
  system: Monitor
};

export default function ThemeToggle({ compact = false }) {
  const { theme, setTheme } = useTheme();
  const ThemeIcon = themeIcons[theme] || Monitor;

  return (
    <label className="relative inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      <ThemeIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Tema</span>
      <select
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
        aria-label="Selecionar tema da interface"
        title="Tema da interface"
        className={`${compact ? 'w-[76px]' : 'w-[86px]'} h-7 cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-slate-700 outline-none focus:ring-0 dark:text-slate-100`}
      >
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
        <option value="system">Sistema</option>
      </select>
    </label>
  );
}
