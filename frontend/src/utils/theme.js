export const THEME_STORAGE_KEY = 'fullpassword-theme';
export const VALID_THEMES = Object.freeze(['light', 'dark', 'system']);

export const normalizeTheme = (value) => VALID_THEMES.includes(value) ? value : 'system';

export const readStoredTheme = (storage = globalThis.localStorage) => {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
};

export const resolveTheme = (theme, systemIsDark = false) => {
  const normalizedTheme = normalizeTheme(theme);
  if (normalizedTheme === 'system') return systemIsDark ? 'dark' : 'light';
  return normalizedTheme;
};

export const applyTheme = (
  theme,
  {
    root = globalThis.document?.documentElement,
    systemIsDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  } = {}
) => {
  const normalizedTheme = normalizeTheme(theme);
  const resolvedTheme = resolveTheme(normalizedTheme, systemIsDark);
  root?.classList.toggle('dark', resolvedTheme === 'dark');
  if (root) {
    root.dataset.theme = normalizedTheme;
  }
  return resolvedTheme;
};

export const persistTheme = (theme, storage = globalThis.localStorage) => {
  const normalizedTheme = normalizeTheme(theme);
  try {
    storage?.setItem(THEME_STORAGE_KEY, normalizedTheme);
  } catch {
    // A preferência continua válida apenas durante a sessão quando o storage está indisponível.
  }
  return normalizedTheme;
};
