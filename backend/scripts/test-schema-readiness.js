const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
Object.assign(process.env, {
  DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'TEST_ONLY_PASSWORD', DB_NAME: 'test',
  JWT_SECRET: 'TEST_ONLY_JWT_'.repeat(8), ADMIN_BOOTSTRAP_TOKEN: 'TEST_BOOTSTRAP_'.repeat(6),
  APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid', NODE_ENV: 'production',
  BACKEND_APP_COMMIT: 'a'.repeat(40)
});
const db = require('../src/config/database');
const { ensureSecuritySchema } = require('../src/config/securitySchema');
const { assertNavigationPreferencesSchema, isMissingNavigationColumn } = require('../src/config/navigationPreferences');
const { updateProfile } = require('../src/controllers/userController');
const { checkHealth } = require('./check-health');
const { SCHEMA_VERSION } = require('../src/config/runtimeReadiness');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const pg = new PGlite({ extensions: { uuid_ossp } });
const commands = [];
let failAlter = false;
const query = async (sql, params) => {
  commands.push(sql.trim());
  if (failAlter && sql.startsWith('ALTER TABLE users')) throw Object.assign(new Error('Simulated DDL denied'), { code: '42501' });
  return pg.query(sql, params);
};
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
async function run() {
  await pg.exec(fs.readFileSync(path.join(__dirname, '../../database/init.sql'), 'utf8'));
  const id = '00000000-0000-0000-0000-000000000001';
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt) VALUES ($1,'Old user','old@example.invalid','TEST_HASH','TEST_WRAPPED','TEST_SALT')", [id]);
  await assert.rejects(assertNavigationPreferencesSchema(db), { code: 'NAVIGATION_PREFERENCES_SCHEMA_MISSING' });
  await ensureSecuritySchema();
  const first = (await pg.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  assert.equal(first.menu_position, 'side'); assert.equal(first.menu_display, 'labels');
  assert.equal(first.id, id); assert.equal(first.email, 'old@example.invalid');
  assert.equal(first.hash_senha_login, 'TEST_HASH'); assert.equal(first.wrapped_key, 'TEST_WRAPPED');
  assert.equal(first.crypto_salt, 'TEST_SALT');
  const constraints = await pg.query("SELECT conname FROM pg_constraint WHERE conrelid='users'::regclass ORDER BY conname");
  await ensureSecuritySchema();
  assert.deepEqual((await pg.query('SELECT * FROM users WHERE id=$1', [id])).rows[0], first);
  assert.deepEqual((await pg.query("SELECT conname FROM pg_constraint WHERE conrelid='users'::regclass ORDER BY conname")).rows, constraints.rows);
  const migration = fs.readFileSync(path.join(__dirname, '../../database/migrations/19_add_user_navigation_preferences.sql'), 'utf8');
  await pg.exec(migration); await pg.exec(migration);
  await assertNavigationPreferencesSchema(db);
  for (const [field, value] of [['menu_position','bad'],['menu_display','bad'],['menu_position',null]]) {
    await assert.rejects(pg.query(`UPDATE users SET ${field}=$1 WHERE id=$2`, [value,id]));
  }
  const request = body => ({ user: { id }, body: { name: 'Old user', email: 'old@example.invalid', ...body } });
  let res = response();
  await updateProfile(request({ menu_position: 'top', menu_display: 'icons', id: 'not-the-user' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.session_invalidated, false);
  res = response(); await updateProfile(request({ name: 'New name' }), res); assert.equal(res.code, 200);
  assert.equal(res.body.user.menu_position, 'top'); assert.equal(res.body.user.menu_display, 'icons');
  res = response(); await updateProfile(request({ menu_display: 'arbitrary' }), res); assert.equal(res.code,400);
  // Reproduce an old schema; even the final profile SELECT must remain inside the transaction.
  await pg.exec('ALTER TABLE users DROP COLUMN menu_position; ALTER TABLE users DROP COLUMN menu_display;');
  res = response(); await updateProfile(request({ name: 'Must roll back' }), res);
  assert.equal(res.code,503); assert.equal(res.body.code,'DATABASE_SCHEMA_OUTDATED');
  assert.equal((await pg.query('SELECT name FROM users WHERE id=$1',[id])).rows[0].name,'New name');
  assert.equal(isMissingNavigationColumn({code:'42703',message:'column unrelated does not exist'}),false);
  // Test actual startup ordering without opening a port or starting schedulers.
  const { app, startServer } = require('../src/server');
  const health = app._router.stack.find(layer => layer.route?.path === '/api/health').route.stack[0].handle;
  res = response(); await health({}, res); assert.equal(res.code, 503);
  let listens = 0; let exitCode;
  app.listen = () => { assert.equal(commands.at(-1),'COMMIT'); listens++; return 'LISTENING'; };
  const originalExit = process.exit;
  process.exit = code => { exitCode = code; };
  try {
    assert.equal(await startServer(),'LISTENING'); // old schema automatically repaired
    assert.equal(await startServer(),'LISTENING'); // already current
    failAlter = true; await startServer();
    assert.equal(exitCode,1); assert.equal(listens,2); assert.equal(commands.at(-1),'ROLLBACK');
    res = response(); await health({}, res); assert.equal(res.code, 503);
    failAlter = false;
    assert.equal(await startServer(), 'LISTENING');
  } finally { process.exit = originalExit; }
  await assertNavigationPreferencesSchema(db);
  res=response(); await health({},res); assert.equal(res.code,200);
  const valid = { status:'ok', schema_ready:true, schema_version:SCHEMA_VERSION, commit:'a'.repeat(40) };
  await checkHealth('a'.repeat(40),true,async () => ({ok:true,json:async()=>valid}));
  for(const body of [{status:'ok'}, {...valid,schema_ready:false}, {...valid,commit:'b'.repeat(40)}, {...valid,schema_version:'old'}]) {
    await assert.rejects(checkHealth('a'.repeat(40),false,async()=>({ok:true,json:async()=>body})));
  }
  await pg.exec("ALTER TABLE users ALTER COLUMN menu_position DROP NOT NULL");
  await assert.rejects(assertNavigationPreferencesSchema(db),{code:'NAVIGATION_PREFERENCES_SCHEMA_INVALID'});
  res=response(); await health({},res); assert.equal(res.code,503);
  console.log('PostgreSQL embedded: old schema migration, idempotence, constraints/defaults, profile rollback, startup ordering/failure and readiness passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await pg.close();await db.pool.end();});
