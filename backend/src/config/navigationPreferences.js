const normalizeNavigationPreferences = (user = {}) => ({
  menu_position: user.menu_position === 'top' ? 'top' : 'side',
  menu_display: user.menu_display === 'icons' ? 'icons' : 'labels'
});

const validNavigationPreferences = (input) => (
  (input.menu_position === undefined || ['side', 'top'].includes(input.menu_position))
  && (input.menu_display === undefined || ['labels', 'icons'].includes(input.menu_display))
);

const ensureNavigationPreferences = async (client) => {
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_position TEXT NOT NULL DEFAULT 'side' CHECK (menu_position IN ('side', 'top'))");
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_display TEXT NOT NULL DEFAULT 'labels' CHECK (menu_display IN ('labels', 'icons'))");
};

module.exports = { normalizeNavigationPreferences, validNavigationPreferences, ensureNavigationPreferences };
