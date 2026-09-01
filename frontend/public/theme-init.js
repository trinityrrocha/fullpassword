(function initializeTheme() {
  var storageKey = 'fullpassword-theme';
  var validThemes = ['light', 'dark', 'system'];
  var theme = 'system';

  try {
    var savedTheme = window.localStorage.getItem(storageKey);
    if (validThemes.indexOf(savedTheme) !== -1) {
      theme = savedTheme;
    } else if (savedTheme !== null) {
      window.localStorage.setItem(storageKey, theme);
    }
  } catch {
    theme = 'system';
  }

  var systemIsDark = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
  var isDark = theme === 'dark' || (theme === 'system' && systemIsDark);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.dataset.theme = theme;
})();
