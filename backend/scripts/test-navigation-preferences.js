const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
Object.assign(process.env, {
  DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'TEST_DB_PASSWORD_1234567890', DB_NAME: 'test',
  JWT_SECRET: 'TEST_JWT_SECRET_1234567890'.repeat(4),
  ADMIN_BOOTSTRAP_TOKEN: 'TEST_BOOTSTRAP_TOKEN_1234567890'.repeat(3),
  SUPER_ADMIN_EMAIL: 'admin@example.com', APP_ORIGIN: 'https://example.com'
});
const db = require('../src/config/database');
const { normalizeNavigationPreferences, validNavigationPreferences, ensureNavigationPreferences } = require('../src/config/navigationPreferences');
const { listOwnSessions, listAllSessions } = require('../src/controllers/sessionController');
const { updateProfile } = require('../src/controllers/userController');
const { me } = require('../src/controllers/authController');
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

async function run() {
  assert.deepEqual(normalizeNavigationPreferences({}), { menu_position: 'side', menu_display: 'labels' });
  assert.deepEqual(normalizeNavigationPreferences({ menu_position: null, menu_display: '<css>' }), { menu_position: 'side', menu_display: 'labels' });
  for (const menu_position of ['side', 'top']) for (const menu_display of ['labels', 'icons']) {
    assert.equal(validNavigationPreferences({ menu_position, menu_display }), true);
  }
  for (const invalid of [null, '', 'TOP', '<script>', {}, []]) {
    for (const field of ['menu_position', 'menu_display']) {
      const res = response();
      await updateProfile({ user: { id: 'a' }, body: { [field]: invalid } }, res);
      assert.equal(res.code, 400);
    }
  }
  const schema = [];
  await ensureNavigationPreferences({ query: async sql => schema.push(sql) });
  const migration = fs.readFileSync(path.join(__dirname, '../../database/migrations/19_add_user_navigation_preferences.sql'), 'utf8').replace(/\s+/g, ' ');
  for (const sql of schema) assert.ok(migration.includes(sql), 'Migration and runtime schema must match');

  const users = { a: { id: 'a', name: 'A', email: 'a@example.com', menu_position: 'side', menu_display: 'labels' }, b: { id: 'b', name: 'B', email: 'b@example.com', menu_position: 'top', menu_display: 'labels' } };
  db.pool.connect = async () => ({ release() {}, async query(sql, params = []) {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.startsWith('SELECT email,')) return { rows: [users[params[0]]] };
    if (sql.startsWith('UPDATE users SET name')) { assert.equal(params[2], 'a'); return { rows: [] }; }
    if (sql.startsWith('UPDATE users SET menu_position')) {
      assert.equal(params[2], 'a', 'Only authenticated user may change preferences');
      users[params[2]].menu_position = params[0] ?? users[params[2]].menu_position;
      users[params[2]].menu_display = params[1] ?? users[params[2]].menu_display;
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id,')) return { rows: [users[params[0]]] };
    throw new Error('Unexpected profile query: ' + sql);
  } });
  const profile = response();
  await updateProfile({ user: { id: 'a' }, body: { id: 'b', name: 'A', email: 'a@example.com', menu_position: 'side', menu_display: 'icons' } }, profile);
  assert.equal(profile.code, 200);
  assert.equal(profile.body.session_invalidated, false);
  assert.equal(users.a.menu_display, 'icons');
  assert.equal(users.b.menu_display, 'labels');
  db.query = async (sql, params) => { assert.match(sql, /menu_position, menu_display/); assert.match(sql, /WHERE id = \$1/); return { rows: [users[params[0]]] }; };
  for (const id of ['a', 'b']) {
    const res = response(); await me({ user: { id } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(normalizeNavigationPreferences(res.body.user), normalizeNavigationPreferences(users[id]));
  }

  for (const total of [0, 5, 12, 30, 80]) for (const requested of [1, 3, 6, 100]) {
    const capped = Math.min(total, 30);
    const page = Math.min(requested, Math.max(1, Math.ceil(capped / 5)));
    db.query = async (sql, params) => {
      assert.equal(params[0], 'a');
      if (sql.includes('COUNT(*)')) { assert.match(sql, /LIMIT 30/); return { rows: [{ total: capped }] }; }
      assert.match(sql, /ORDER BY s.last_seen_at DESC NULLS LAST/);
      assert.deepEqual(params, ['a', 5, (page - 1) * 5]);
      return { rows: Array.from({ length: Math.min(5, Math.max(0, capped - params[2])) }, (_, index) => ({ id: index, token_version: 0, current_token_version: 0 })) };
    };
    const res = response(); await listOwnSessions({ user: { id: 'a' }, query: { page: requested, limit: 5 } }, res);
    assert.equal(res.body.sessions.length <= 5, true);
    assert.deepEqual(res.body.pagination, { page, limit: 5, total: capped, total_pages: Math.ceil(capped / 5) });
  }
  db.query = async sql => { assert.match(sql, /ORDER BY s.created_at DESC/); return { rows: [] }; };
  const legacy = response(); await listOwnSessions({ user: { id: 'a' }, query: {} }, legacy); assert.ok(Array.isArray(legacy.body));
  for (const query of [{ page: '-1' }, { page: 'x' }, { limit: 500 }]) {
    const res = response(); await listOwnSessions({ user: { id: 'a' }, query }, res); assert.equal(res.code, 400);
  }
  db.query = async (sql, params) => {
    assert.doesNotMatch(sql, /LIMIT 30/);
    if (sql.includes('COUNT(*)')) return { rows: [{ total: 100 }] };
    if (sql.includes('LIMIT $1')) assert.deepEqual(params, [10, 0]);
    return { rows: [] };
  };
  const admin = response(); await listAllSessions({ user: { id: 'a', role: 'admin', is_super_admin: true }, query: { page: 1 } }, admin);
  assert.equal(admin.body.pagination.total, 100);
  console.log('Navigation preferences/profile isolation, auth serialization, schema and session pagination passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.pool.end());
