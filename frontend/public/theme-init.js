(function initializeTheme() {
  var storageKey = 'fullpassword-theme';
  var validThemes = ['light', 'dark'];
  var theme = 'light';

  try {
    var savedTheme = window.localStorage.getItem(storageKey);
    if (validThemes.indexOf(savedTheme) !== -1) {
      theme = savedTheme;
    } else if (savedTheme !== null) {
      window.localStorage.setItem(storageKey, theme);
    }
  } catch {
    theme = 'light';
  }

  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
})();
