// Vault shared with a group AND selected users, on a disposable native PostgreSQL: recipients, atomic activation, permission merge,
// revocation by trigger and audit. Envelopes are opaque 384-byte blobs here (the server only checks their shape).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const find = () => {
  const embedded = path.join(__dirname, '../node_modules/@embedded-postgres/linux-x64/native/bin');
  const candidates = [process.env.PG_BIN, ...(fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort().reverse().map((v) => `/usr/lib/postgresql/${v}/bin`) : []), embedded].filter(Boolean);
  const dir = candidates.find((d) => fs.existsSync(path.join(d, 'postgres')) && fs.existsSync(path.join(d, 'initdb')));
  if (!dir) throw new Error('PostgreSQL binaries not found (set PG_BIN).');
  return dir;
};
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const root = process.getuid() === 0;
const asServer = root ? { uid: 65534, gid: 65534 } : {};

async function main() {
  const bin = find();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-user-share-pg-'));
  if (root) fs.chownSync(dir, 65534, 65534);
  fs.chmodSync(dir, 0o755);
  const data = path.join(dir, 'data'); const port = await freePort();
  const sh = (cmd, args) => { const r = spawnSync(path.join(bin, cmd), args, { encoding: 'utf8', ...asServer }); if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`); };
  sh('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres']);
  sh('pg_ctl', ['-D', data, '-o', `-p ${port} -h 127.0.0.1 -k ${dir}`, '-l', path.join(dir, 'log'), '-w', 'start']);
  let database;
  try {
    Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'postgres', DB_PASSWORD: 'unused', DB_NAME: 'postgres', NODE_ENV: 'test',
      JWT_SECRET: crypto.randomBytes(64).toString('hex'), CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), ADMIN_BOOTSTRAP_TOKEN: crypto.randomBytes(48).toString('hex'),
      APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid' });
    database = require('../src/config/database');
    const { ensureSecuritySchema } = require('../src/config/securitySchema');
    const crypto2 = require('node:crypto');
    const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    await database.query(read('database/init.sql'));
    await ensureSecuritySchema();
    const migration = read('database/migrations/32_create_client_user_access.sql');
    await database.query(migration); await database.query(migration); // idempotent
    const controller = require('../src/controllers/vaultCryptoController');
    const access = require('../src/services/accessControlService');
    const { BACKUP_TABLES, OPTIONAL_BACKUP_TABLES } = require('../src/config/backupTables');
    assert.ok(BACKUP_TABLES.includes('client_user_access') && OPTIONAL_BACKUP_TABLES.has('client_user_access'), 'the table is backed up and optional for older backups');

    const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
    const U = { owner: id(1), alice: id(2), bob: id(3), carol: id(4), dave: id(5), admin: id(6), outsider: id(7) };
    const identity = (key) => ({ version: 2, userId: U[key], publicKey: `pk-${key}`, fingerprint: `fp-${key}` });
    for (const [key, uid] of Object.entries(U)) {
      await database.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_active,is_super_admin,role,crypto_identity) VALUES ($1,$2,$3,'H','W','S',$4,$5,$6,$7)",
        [uid, key[0].toUpperCase() + key.slice(1), `${key}@example.invalid`, key !== 'dave', key === 'admin', key === 'admin' ? 'admin' : 'user', key === 'carol' ? null : JSON.stringify(identity(key))]);
    }
    const group = id(100); const vault = id(200);
    await database.query("INSERT INTO groups(id,name,can_view,can_edit,can_add,can_delete) VALUES ($1,'Equipe',TRUE,FALSE,FALSE,FALSE)", [group]);
    await database.query('INSERT INTO user_groups(user_id,group_id) VALUES ($1,$2)', [U.bob, group]);
    await database.query("INSERT INTO clients(id,name,created_by) VALUES ($1,'Cofre',$2)", [vault, U.owner]);

    const call = async (handler, key, extra = {}) => {
      const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await handler({ user: { id: U[key], email: `${key}@example.invalid`, role: key === 'admin' ? 'admin' : 'user', is_super_admin: key === 'admin' }, params: { id: vault }, query: {}, body: {}, get: () => 'a', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra }, res);
      return res;
    };
    const share = (group_id, p = {}) => ({ group_id, can_view: true, can_edit: false, can_add: false, can_delete: false, ...p });
    const ushare = (key, p = {}) => ({ user_id: U[key], can_view: true, can_edit: false, can_add: false, can_delete: false, ...p });
    const envelopesFor = (keys, epoch) => keys.map((key) => ({ version: 2, userId: U[key], vaultId: vault, epoch, fingerprint: `fp-${key}`, ciphertext: Buffer.alloc(384, 7).toString('base64') }));
    const rotate = async (body, keys, key = 'owner') => {
      const state = await call(controller.getState, key); assert.equal(state.code, 200, JSON.stringify(state.body));
      const staged = await call(controller.stageEpoch, key, { body: { sourceHash: state.body.sourceHash, recordCount: 0, records: [], scopedItems: [], envelopes: envelopesFor(keys, state.body.epoch + 1), ...body } });
      if (staged.code !== 200) return staged;
      return call(controller.activateEpoch, key, { params: { id: vault, stageId: staged.body.id }, body: { verifiedManifestHash: staged.body.manifestHash } });
    };
    const perms = (key) => access.getClientPermissions(vault, { id: U[key], is_super_admin: key === 'admin' });

    // ---- directory: owner/admin only, minimal fields, search required ----
    let res = await call(controller.userDirectory, 'owner', { query: { q: 'alice' } }); assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.users.map((u) => u.name), ['Alice']); assert.deepEqual(Object.keys(res.body.users[0]).sort(), ['email_hint', 'has_identity', 'id', 'is_active', 'name']);
    assert.ok(!JSON.stringify(res.body).includes('alice@example.invalid') && !JSON.stringify(res.body).includes('pk-alice'), 'no full e-mail, no key');
    assert.equal(res.body.users[0].has_identity, true);
    res = await call(controller.userDirectory, 'owner', { query: { q: 'carol' } }); assert.equal(res.body.users[0].has_identity, false, 'the picker can mark accounts without identity');
    res = await call(controller.userDirectory, 'owner', { query: { q: 'dave' } }); assert.equal(res.body.users.length, 0, 'inactive accounts are not offered');
    res = await call(controller.userDirectory, 'owner', { query: { q: 'owner' } }); assert.equal(res.body.users.length, 0, 'the owner is never offered');
    res = await call(controller.userDirectory, 'owner', { query: { q: 'a' } }); assert.equal(res.code, 400, 'search needs 2+ characters: the directory cannot be listed');
    res = await call(controller.userDirectory, 'owner', { query: { q: '%%' } }); assert.equal(res.body.users.length, 0, 'wildcards are escaped');
    res = await call(controller.userDirectory, 'outsider', { query: { q: 'alice' } }); assert.ok([403, 404].includes(res.code), 'a stranger cannot browse users through a vault');
    res = await call(controller.userDirectory, 'alice', { query: { q: 'bo' } }); assert.ok([403, 404].includes(res.code));

    // ---- recipients: group members + selected users + owner; unavailable and identity-less users are refused ----
    res = await call(controller.getRecipients, 'owner', { body: { shares: [share(group)], userShares: [ushare('alice', { can_edit: true })] } });
    assert.equal(res.code, 200, JSON.stringify(res.body)); assert.deepEqual(res.body.recipients.map((r) => r.userId).sort(), [U.alice, U.bob, U.owner].sort());
    res = await call(controller.getRecipients, 'owner', { body: { shares: [], userShares: [ushare('carol')] } }); assert.equal(res.code, 409); assert.equal(res.body.code, 'RECIPIENT_IDENTITY_MIGRATION_REQUIRED');
    res = await call(controller.getRecipients, 'owner', { body: { shares: [], userShares: [ushare('dave')] } }); assert.equal(res.body.code, 'SHARE_USER_UNAVAILABLE', 'an inactive account is refused, not silently dropped');
    res = await call(controller.getRecipients, 'owner', { body: { shares: [], userShares: [{ ...ushare('alice'), user_id: id(999) }] } }); assert.equal(res.body.code, 'SHARE_USER_UNAVAILABLE');
    res = await call(controller.getRecipients, 'owner', { body: { shares: [], userShares: [{ user_id: 'nope', can_view: true }] } }); assert.equal(res.code, 400);
    res = await call(controller.getRecipients, 'owner', { body: { shares: [], userShares: [ushare('alice'), ushare('alice')] } }); assert.equal(res.code, 400, 'duplicate users');
    res = await call(controller.getRecipients, 'owner', { body: { shares: [], userShares: [ushare('owner'), ushare('alice', { can_view: false })] } }); assert.deepEqual(res.body.recipients.map((r) => r.userId), [U.owner], 'the owner and rows without view are ignored');
    res = await call(controller.getRecipients, 'alice', { body: { shares: [], userShares: [] } }); assert.ok([403, 404].includes(res.code), 'only the owner/admin prepares a rotation');

    // ---- activation writes ACL + envelopes together ----
    res = await rotate({ shares: [share(group)], userShares: [ushare('alice', { can_edit: true })] }, ['owner', 'bob', 'alice']); assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.deepEqual((await database.query('SELECT user_id,can_edit,can_add,granted_by FROM client_user_access')).rows, [{ user_id: U.alice, can_edit: true, can_add: false, granted_by: U.owner }]);
    assert.deepEqual((await database.query('SELECT user_id FROM vault_crypto_envelopes WHERE client_id=$1 ORDER BY user_id', [vault])).rows.map((r) => r.user_id).sort(), [U.alice, U.bob, U.owner].sort());
    let p = await perms('alice'); assert.deepEqual([p.can_view, p.can_edit, p.can_add, p.can_delete, p.source], [true, true, false, false, 'user']);
    p = await perms('bob'); assert.deepEqual([p.can_view, p.can_edit, p.source], [true, false, 'group']);
    assert.equal((await perms('outsider')).can_view, false);
    // the vault is listed for the directly shared user
    const clientController = require('../src/controllers/clientController');
    res = await call(clientController.getClients, 'alice'); assert.deepEqual(res.body.map((c) => c.id), [vault], 'a user shared directly sees the vault');
    res = await call(clientController.getClients, 'outsider'); assert.deepEqual(res.body, []);
    res = await call(controller.getState, 'alice'); assert.equal(res.code, 200); assert.ok(res.body.envelope, 'alice has her own envelope');
    res = await call(controller.userShares, 'owner'); assert.deepEqual(res.body.users.map((u) => [u.name, u.can_edit]), [['Alice', true]]);
    assert.ok(!JSON.stringify(res.body).includes('alice@'), 'the list never carries a full e-mail');
    res = await call(controller.userShares, 'alice'); assert.ok([403, 404].includes(res.code), 'a recipient cannot list who else has access');

    // both paths: the effective right is the OR of the group and the direct share
    await database.query('INSERT INTO user_groups(user_id,group_id) VALUES ($1,$2)', [U.alice, group]);
    p = await perms('alice'); assert.deepEqual([p.can_edit, p.source], [true, 'group+user']);
    await database.query('DELETE FROM user_groups WHERE user_id=$1 AND group_id=$2', [U.alice, group]);

    // an older screen that does not send userShares never wipes the direct shares
    res = await rotate({ shares: [share(group)] }, ['owner', 'bob', 'alice']); assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal((await database.query('SELECT 1 FROM client_user_access WHERE user_id=$1', [U.alice])).rowCount, 1, 'omitted userShares means unchanged');
    // a recipient set that differs from the envelopes is refused
    res = await rotate({ shares: [share(group)], userShares: [ushare('alice')] }, ['owner', 'bob']); assert.equal(res.code, 409); assert.equal(res.body.code, 'RECIPIENT_SET_CHANGED');
    res = await rotate({ shares: [share(group)], userShares: [ushare('alice'), ushare('carol')] }, ['owner', 'bob', 'alice', 'carol']); assert.equal(res.body.code, 'RECIPIENT_IDENTITY_MIGRATION_REQUIRED');
    // only the owner rotates
    res = await rotate({ shares: [share(group)], userShares: [ushare('alice')] }, ['owner', 'bob', 'alice'], 'admin'); assert.ok(res.code >= 400, 'the Super Admin who is not the owner cannot rotate');

    // ---- revocation by trigger: deactivation and direct deletion remove the envelope and demand a rotation ----
    await database.query('UPDATE users SET is_active=FALSE WHERE id=$1', [U.alice]);
    assert.equal((await database.query('SELECT 1 FROM vault_crypto_envelopes WHERE client_id=$1 AND user_id=$2', [vault, U.alice])).rowCount, 0, 'a deactivated recipient loses the envelope');
    assert.equal((await database.query('SELECT rotation_required FROM clients WHERE id=$1', [vault])).rows[0].rotation_required, true);
    await database.query('UPDATE users SET is_active=TRUE WHERE id=$1', [U.alice]);
    res = await rotate({ shares: [share(group)], userShares: [ushare('alice')] }, ['owner', 'bob', 'alice']); assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal((await database.query('SELECT rotation_required FROM clients WHERE id=$1', [vault])).rows[0].rotation_required, false, 'the rotation clears the flag');
    await database.query('DELETE FROM client_user_access WHERE user_id=$1', [U.alice]);
    assert.equal((await database.query('SELECT 1 FROM vault_crypto_envelopes WHERE client_id=$1 AND user_id=$2', [vault, U.alice])).rowCount, 0, 'removing the direct share removes the envelope');
    assert.equal((await database.query('SELECT rotation_required FROM clients WHERE id=$1', [vault])).rows[0].rotation_required, true);

    // ---- revoking through the owner's rotation ----
    res = await rotate({ shares: [share(group)], userShares: [ushare('alice', { can_add: true })] }, ['owner', 'bob', 'alice']); assert.equal(res.code, 200, JSON.stringify(res.body));
    res = await rotate({ shares: [share(group)], userShares: [] }, ['owner', 'bob']); assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal((await database.query('SELECT 1 FROM client_user_access')).rowCount, 0); assert.equal((await perms('alice')).can_view, false);
    res = await call(controller.getState, 'alice'); assert.equal(res.code, 404, 'a revoked user no longer reaches the vault');
    res = await call(clientController.getClients, 'alice'); assert.deepEqual(res.body, []);
    // a deleted account drops its share (cascade) and the vault asks for a rotation
    res = await rotate({ shares: [share(group)], userShares: [ushare('alice')] }, ['owner', 'bob', 'alice']); assert.equal(res.code, 200);
    await database.query('DELETE FROM users WHERE id=$1', [U.alice]);
    assert.equal((await database.query('SELECT 1 FROM client_user_access')).rowCount, 0, 'deleting the account cascades');
    assert.equal((await database.query('SELECT rotation_required FROM clients WHERE id=$1', [vault])).rows[0].rotation_required, true);

    // ---- audit: who granted / revoked, no keys ----
    const events = (await database.query("SELECT action,details FROM vault_access_audit WHERE client_id=$1 AND action LIKE 'vault_user_share_%' ORDER BY created_at,id", [vault])).rows;
    assert.ok(events.some((e) => e.action === 'vault_user_share_granted' && e.details.user_id === U.alice) && events.some((e) => e.action === 'vault_user_share_revoked'));
    assert.ok(!JSON.stringify(events).includes('fp-') && !JSON.stringify(events).includes('pk-'));
    console.log('PASS vault direct user sharing (native PostgreSQL): directory, recipients, atomic activation, OR of group and user rights, unchanged when omitted, trigger revocation, cascade, audit.');
  } finally {
    try { await database?.pool.end(); } catch { /* ignore */ }
    spawnSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { ...asServer });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
