export const THEME_STORAGE_KEY = 'fullpassword-theme';
export const VALID_THEMES = Object.freeze(['light', 'dark']);

export const normalizeTheme = (value) => VALID_THEMES.includes(value) ? value : 'light';

export const readStoredTheme = (storage = globalThis.localStorage) => {
  try {
    const storedTheme = storage?.getItem(THEME_STORAGE_KEY);
    const normalizedTheme = normalizeTheme(storedTheme);
    if (storedTheme !== null && storedTheme !== normalizedTheme) {
      storage?.setItem(THEME_STORAGE_KEY, normalizedTheme);
    }
    return normalizedTheme;
  } catch {
    return 'light';
  }
};

export const resolveTheme = (theme) => normalizeTheme(theme);

export const getNextTheme = (theme) => normalizeTheme(theme) === 'dark' ? 'light' : 'dark';

export const applyTheme = (
  theme,
  {
    root = globalThis.document?.documentElement
  } = {}
) => {
  const normalizedTheme = normalizeTheme(theme);
  const resolvedTheme = resolveTheme(normalizedTheme);
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
