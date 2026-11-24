// Super Admin sets another account's LOGIN password: authorization, policy, sessions, audit, e-mail and an untouched crypto identity.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const argon2 = require('argon2');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
Object.assign(process.env, {
  DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'TEST_ONLY_PASSWORD', DB_NAME: 'test',
  JWT_SECRET: 'TEST_ONLY_JWT_'.repeat(8), ADMIN_BOOTSTRAP_TOKEN: 'TEST_BOOTSTRAP_'.repeat(6),
  APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid', NODE_ENV: 'production',
  BACKEND_APP_COMMIT: 'a'.repeat(40), CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64')
});
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const db = require('../src/config/database');
const { ensureSecuritySchema } = require('../src/config/securitySchema');
const emailService = require('../src/services/emailService');
const mails = [];
emailService.sendEmail = async (mail) => { if (mail.to === 'nomail@example.invalid') throw new Error('smtp'); mails.push(mail); };
const controller = require('../src/controllers/userController');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });
const response = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const call = async (user, id, body) => { const res = response(); await controller.setUserPassword({ user, params: { id }, body, get: () => 'agent', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res); return res; };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function run() {
  await pg.exec(read('database/init.sql')); await ensureSecuritySchema();
  const ids = { root: id(1), other: id(2), plain: id(3), nomail: id(4), boss: id(5) };
  const seed = (key, email, superAdmin, role) => pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,public_key,encrypted_private_key,is_active,is_super_admin,role) VALUES ($1,$2,$3,$4,'WRAPPED_SENTINEL','SALT_SENTINEL','PUBKEY_SENTINEL','PRIVKEY_SENTINEL',TRUE,$5,$6)",
    [ids[key], key, email, 'OLD_HASH', superAdmin, role]);
  await seed('root', 'root@example.invalid', true, 'admin'); await seed('boss', 'boss@example.invalid', true, 'admin'); await seed('other', 'other@example.invalid', false, 'admin');
  await seed('plain', 'plain@example.invalid', false, 'user'); await seed('nomail', 'nomail@example.invalid', false, 'user');
  const root = { id: ids.root, email: 'root@example.invalid', role: 'admin', is_super_admin: true };
  const strong = 'Temp-Pass_9f3k!Zq72xLm';

  // authorization and validation
  let res = await call({ id: ids.other, role: 'admin', is_super_admin: false }, ids.plain, { new_password: strong }); assert.equal(res.code, 403, 'an ordinary administrator cannot');
  res = await call({ id: ids.plain, role: 'user', is_super_admin: false }, ids.other, { new_password: strong }); assert.equal(res.code, 403);
  res = await call(root, ids.root, { new_password: strong }); assert.equal(res.code, 409); assert.equal(res.body.code, 'SELF_PASSWORD_USE_PROFILE');
  res = await call(root, ids.boss, { new_password: strong }); assert.equal(res.code, 403); assert.equal(res.body.code, 'SUPER_ADMIN_TARGET', 'another Super Admin is not reachable');
  res = await call(root, id(99), { new_password: strong }); assert.equal(res.code, 404);
  for (const bad of [undefined, '', 123, 'x'.repeat(1025)]) { res = await call(root, ids.plain, { new_password: bad }); assert.equal(res.code, 400, String(bad)); }
  res = await call(root, ids.plain, { new_password: 'short' }); assert.equal(res.code, 400); assert.equal(res.body.code, 'WEAK_PASSWORD', 'the password policy applies');
  assert.equal((await pg.query('SELECT hash_senha_login FROM users WHERE id=$1', [ids.plain])).rows[0].hash_senha_login, 'OLD_HASH', 'a refused request changes nothing');

  // success: new hash, temporary, sessions ended, reset links consumed, identity untouched, audit without the password, e-mail without it
  await pg.query("INSERT INTO user_sessions(id,user_id,token_version,session_hash,expires_at,idle_expires_at) VALUES ($1,$2,0,'h1',now()+interval '1 day',now()+interval '1 day'),($3,$2,0,'h2',now()+interval '1 day',now()+interval '1 day')", [id(201), ids.plain, id(202)]);
  await pg.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [ids.plain, 'a'.repeat(64)]);
  const before = (await pg.query('SELECT token_version FROM users WHERE id=$1', [ids.plain])).rows[0].token_version;
  res = await call(root, ids.plain, { new_password: strong });
  assert.equal(res.code, 200, JSON.stringify(res.body)); assert.equal(res.body.sessions_revoked, 2); assert.equal(res.body.notification, 'sent');
  const row = (await pg.query('SELECT * FROM users WHERE id=$1', [ids.plain])).rows[0];
  assert.equal(await argon2.verify(row.hash_senha_login, strong), true); assert.match(row.hash_senha_login, /^\$argon2id\$/);
  assert.equal(row.must_change_password, true, 'the password is temporary'); assert.equal(row.token_version, before + 1);
  assert.deepEqual([row.wrapped_key, row.crypto_salt, row.public_key, row.encrypted_private_key], ['WRAPPED_SENTINEL', 'SALT_SENTINEL', 'PUBKEY_SENTINEL', 'PRIVKEY_SENTINEL'], 'the cryptographic identity is preserved');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL', [ids.plain])).rows[0].n, 0);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL', [ids.plain])).rows[0].n, 0, 'pending reset links are consumed');
  const audit = (await pg.query("SELECT user_email, status, metadata FROM system_audit_events WHERE action='password_set_by_admin'")).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].status, 'success'); assert.equal(audit[0].metadata.target_user_id, ids.plain); assert.equal(audit[0].metadata.crypto_identity, 'preserved');
  assert.equal(JSON.stringify(audit).includes(strong), false, 'the password never reaches the audit trail');
  assert.equal(mails.length, 1); assert.equal(mails[0].to, 'plain@example.invalid'); assert.equal(mails[0].text.includes(strong), false, 'the e-mail never carries the password'); assert.match(mails[0].text, /temporária/);
  assert.equal(JSON.stringify(res.body).includes(strong), false);
  // the other accounts are untouched
  assert.equal((await pg.query('SELECT hash_senha_login FROM users WHERE id=$1', [ids.other])).rows[0].hash_senha_login, 'OLD_HASH');
  // a mail failure never undoes the change
  res = await call(root, ids.nomail, { new_password: strong }); assert.equal(res.code, 200); assert.equal(res.body.notification, 'skipped');
  assert.equal(await argon2.verify((await pg.query('SELECT hash_senha_login FROM users WHERE id=$1', [ids.nomail])).rows[0].hash_senha_login, strong), true);

  // route and reauthentication wiring
  const routes = read('backend/src/routes/userRoutes.js');
  assert.match(routes, /router\.post\('\/:id\/password', require\('\.\.\/services\/reauthService'\)\.guard\('admin_password_set'\), userController\.setUserPassword\)/, 'single-use reauthentication bound to the target account');
  assert.match(read('backend/src/services/reauthService.js'), /admin_\(\?:user_change\|mfa_policy\|mfa_reset\|password_set\|user_delete\)/);
  assert.ok(routes.indexOf("router.post('/:id/password'") < routes.indexOf("router.put('/:id'"));
  console.log('PASS admin set password: Super Admin only (not self, not another Super Admin), policy enforced, argon2id, temporary, sessions ended, reset links consumed, crypto identity preserved, no password in audit/e-mail/response.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
