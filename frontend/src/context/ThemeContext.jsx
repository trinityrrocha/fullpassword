import { useEffect, useMemo, useState } from 'react';
import { applyTheme, normalizeTheme, persistTheme, readStoredTheme } from '../utils/theme';
import ThemeContext from './themeContextStore';

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState(() => applyTheme(readStoredTheme()));

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setResolvedTheme(applyTheme(theme, { systemIsDark: mediaQuery.matches }));
    syncTheme();
    if (theme !== 'system') return undefined;
    mediaQuery.addEventListener('change', syncTheme);
    return () => mediaQuery.removeEventListener('change', syncTheme);
  }, [theme]);

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme: (nextTheme) => {
      const normalizedTheme = normalizeTheme(nextTheme);
      persistTheme(normalizedTheme);
      setThemeState(normalizedTheme);
    }
  }), [resolvedTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
