export const normalizeNavigationPreferences = (user) => ({
  menu_position: user?.menu_position === 'top' ? 'top' : 'side',
  menu_display: user?.menu_display === 'icons' ? 'icons' : 'labels'
});
