import { Moon, Sun } from 'lucide-react';
import useTheme from '../hooks/useTheme';
import { getNextTheme } from '../utils/theme';

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Ativar tema claro' : 'Ativar tema escuro';
  const ThemeIcon = isDark ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => setTheme(getNextTheme(theme))}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white p-0 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-slate-800 dark:hover:text-amber-200 dark:focus-visible:ring-offset-slate-900"
    >
      <ThemeIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
  );
}
