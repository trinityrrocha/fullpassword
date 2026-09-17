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

const assertNavigationPreferencesSchema = async (client) => {
  const { rows: columns } = await client.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users'
      AND column_name IN ('menu_position', 'menu_display')
  `);
  const expected = { menu_position: ['side', 'top'], menu_display: ['labels', 'icons'] };
  if (Object.keys(expected).some(name => !columns.some(column => column.column_name === name))) {
    throw Object.assign(new Error('Schema obrigatório de preferências ausente.'), { code: 'NAVIGATION_PREFERENCES_SCHEMA_MISSING' });
  }
  const { rows: checks } = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND contype = 'c' AND convalidated
  `);
  for (const [name, values] of Object.entries(expected)) {
    const column = columns.find(item => item.column_name === name);
    const definition = `CHECK((${name}=ANY(ARRAY['${values[0]}'::text,'${values[1]}'::text])))`;
    if (column.data_type !== 'text' || column.is_nullable !== 'NO'
      || column.column_default !== `'${values[0]}'::text`
      || !checks.some(check => check.definition.replace(/\s+/g, '') === definition)) {
      throw Object.assign(new Error('Schema obrigatório de preferências incompatível.'), { code: 'NAVIGATION_PREFERENCES_SCHEMA_INVALID' });
    }
  }
};

const isMissingNavigationColumn = (error) => error?.code === '42703'
  && /\b(menu_position|menu_display)\b/.test(String(error.column || error.message || ''));

module.exports = { normalizeNavigationPreferences, validNavigationPreferences, ensureNavigationPreferences, assertNavigationPreferencesSchema, isMissingNavigationColumn };
