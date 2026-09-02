import { useEffect, useMemo, useState } from 'react';
import { applyTheme, normalizeTheme, persistTheme, readStoredTheme } from '../utils/theme';
import ThemeContext from './themeContextStore';

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo(() => ({
    theme,
    resolvedTheme: theme,
    setTheme: (nextTheme) => {
      const normalizedTheme = normalizeTheme(nextTheme);
      persistTheme(normalizedTheme);
      setThemeState(normalizedTheme);
    }
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
