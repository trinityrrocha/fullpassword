// Phase 2B on a disposable native PostgreSQL: requests, admin decisions, direct unlock, re-block, uncertainty and — the point of
// the real database — concurrent claims. The Matrix client is stubbed (never a real provider); mail is stubbed.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spfbl-release-pg-'));
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
    const mails = [];
    const emailService = require('../src/services/emailService');
    emailService.sendEmail = async (mail) => { if (mail.to === 'bounce@example.invalid') throw new Error('smtp'); mails.push(mail); };
    const { ensureSecuritySchema } = require('../src/config/securitySchema');
    const matrix = require('../src/services/spfblMatrixClient');
    const settings = require('../src/services/spfblSettingsService');
    const access = require('../src/services/spfblAccessService');
    const domains = require('../src/services/spfblDomainsService');
    const release = require('../src/services/spfblReleaseService');
    const history = require('../src/services/spfblHistoryService');
    const repository = require('../src/services/spfblHistoryRepository');
    const controller = require('../src/controllers/spfblController');
    const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    await database.query(read('database/init.sql'));
    await ensureSecuritySchema();
    const migration30 = read('database/migrations/30_create_spfbl_history_storage.sql');
    await database.query(migration30); await database.query(migration30);
    const migration = read('database/migrations/29_create_spfbl_requests.sql');
    await database.query(migration); await database.query(migration); // idempotent
    await database.query("INSERT INTO system_modules (module_key, enabled) VALUES ('spfbl', TRUE) ON CONFLICT (module_key) DO UPDATE SET enabled = TRUE").catch(async () => database.query("INSERT INTO system_modules (key, enabled) VALUES ('spfbl', TRUE) ON CONFLICT (key) DO UPDATE SET enabled = TRUE"));

    const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
    const users = { admin: id(1), review: id(2), direct: id(3), direct2: id(4), outsider: id(5), bounce: id(6) };
    const emails = { admin: 'admin@example.invalid', review: 'review@example.invalid', direct: 'direct@example.invalid', direct2: 'direct2@example.invalid', outsider: 'outsider@example.invalid', bounce: 'bounce@example.invalid' };
    for (const [key, uid] of Object.entries(users)) {
      await database.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_active,is_super_admin,role) VALUES ($1,$2,$3,'H','W','S',TRUE,$4,$5)", [uid, key, emails[key], key === 'admin', key === 'admin' ? 'admin' : 'user']);
    }
    await settings.updateSettings({ matrix_user: 'ops@example.com', matrix_password: 'MATRIX_SECRET_SENTINEL' }, users.admin);
    await domains.addManualDomain('one.example.com', users.admin); await domains.addManualDomain('two.example.com', users.admin);
    const dom = Object.fromEntries((await domains.listDomains()).map((d) => [d.name.split('.')[0], d.id]));
    await access.saveAccess(users.review, { unlock_mode: 'review', domain_ids: [dom.one] }, users.admin);
    await access.saveAccess(users.direct, { unlock_mode: 'direct', domain_ids: [dom.one] }, users.admin);
    await access.saveAccess(users.direct2, { unlock_mode: 'direct', domain_ids: [dom.one] }, users.admin);
    await access.saveAccess(users.bounce, { unlock_mode: 'review', domain_ids: [dom.one] }, users.admin);

    const credentials = { user: 'ops@example.com', password: 'MATRIX_SECRET_SENTINEL' };
    const integration = release.integrationHash(credentials.user);
    const nowS = Math.floor(Date.now() / 1000);
    const rowOf = (key, recipient, result = 'BLOCK', extra = {}) => history.normalizeRecord({ key, recipient, sender: 'bad@out.example', from: '', replyto: '', result, arrival: new Date((nowS - 100) * 1000).toISOString(), status: 'NONE', ...extra }, integration);
    const actorOf = (key, unlockMode = 'review') => ({ user: { id: users[key] }, isSuperAdmin: key === 'admin', scope: ['one.example.com'], unlockMode });

    // stub provider with an observable, slow white/block
    const provider = { whites: [], blocks: [], live: new Map(), failWhite: false, delay: 120 };
    const liveOf = (row, status = 'NONE') => ({ key: row.provider_key, recipient: row.recipient, sender: row.sender, from: '', replyto: '', result: row.result, arrival: new Date(row.timestamp * 1000).toISOString(), status });
    const stub = {
      registry: async (_c, key) => provider.live.get(key),
      unlock: async (_c, key) => { provider.whites.push(key); await new Promise((r) => setTimeout(r, provider.delay)); if (provider.failWhite) { const e = new Error('x'); e.diagnostic = 'white HTTP=200 result=FAIL'; throw e; } return { diagnostic: 'ok' }; },
      block: async (_c, key) => { provider.blocks.push(key); const l = provider.live.get(key); if (l) provider.live.set(key, { ...l, status: 'BLOCKED' }); }
    };
    const register = (row, status) => provider.live.set(row.provider_key, liveOf(row, status));
    const proofFor = async (user, row) => release.confirmation(users[user], { ...row, operation_revision: Number((await database.query('SELECT revision FROM spfbl_operations WHERE record_id = $1', [row.id])).rows[0]?.revision || 0) });

    // ---- schema ----
    for (const table of ['spfbl_requests', 'spfbl_operations', 'spfbl_release_events']) assert.equal((await database.query('SELECT to_regclass($1) AS t', [table])).rows[0].t, table);
    await assert.rejects(database.query("INSERT INTO spfbl_requests(record_id,domain,recipient,provider_key,integration_hash,status) VALUES ($1,'one.example.com','a@one.example.com','k',$1,'bogus')", ['a'.repeat(64)]));

    // ---- confirmation proof ----
    const probe = rowOf('P1', 'p@one.example.com');
    const proof = release.confirmation(users.direct, { ...probe, operation_revision: 0 });
    release.checkConfirmation(users.direct, { ...probe, operation_revision: 0 }, proof);
    for (const bad of [proof.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), 'zz', undefined, release.confirmation(users.direct2, { ...probe, operation_revision: 0 })]) assert.throws(() => release.checkConfirmation(users.direct, { ...probe, operation_revision: 0 }, bad), { code: 'SPFBL_CONFIRMATION_STALE' });
    assert.throws(() => release.checkConfirmation(users.direct, { ...probe, result: 'BANNED', operation_revision: 0 }, proof), { code: 'SPFBL_CONFIRMATION_STALE' }, 'a changed reason invalidates the proof');
    assert.throws(() => release.checkConfirmation(users.direct, { ...probe, operation_revision: 1 }, proof), { code: 'SPFBL_CONFIRMATION_STALE' }, 'a changed operation invalidates the proof');

    // ---- review flow ----
    const r1 = rowOf('R1', 'ana@one.example.com'); register(r1);
    await assert.rejects(release.requestReview(actorOf('review'), r1, 'two.example.com', credentials), { code: 'SPFBL_DOMAIN_FORBIDDEN' });
    await assert.rejects(release.requestReview(actorOf('review'), rowOf('F1', 'free@one.example.com', 'ACCEPT'), 'one.example.com', credentials), { code: 'SPFBL_RECORD_NOT_BLOCKED' });
    const first = await release.requestReview(actorOf('review'), r1, 'one.example.com', credentials);
    assert.equal(first.created, true); assert.equal(first.request.status, 'pending');
    const again = await release.requestReview(actorOf('review'), r1, 'one.example.com', credentials);
    assert.equal(again.created, false); assert.equal(again.request.id, first.request.id, 'one request per record and account');
    assert.equal((await release.listRequests(actorOf('review'))).length, 1); assert.equal((await release.listRequests(actorOf('direct'))).length, 0, 'accounts see only their own requests');
    assert.equal((await release.listRequests(actorOf('admin'))).length, 1);
    // review-mode accounts cannot unlock directly; ordinary accounts cannot decide
    await assert.rejects(release.execute(actorOf('review'), { row: r1, domain: 'one.example.com', proof: await proofFor('review', r1) }, credentials, stub), { code: 'SPFBL_REVIEW_REQUIRED' });
    await assert.rejects(release.keep(actorOf('review'), first.request.id, 0), { code: 'SPFBL_ADMIN_ONLY' });
    await assert.rejects(release.requestDetail(actorOf('direct'), first.request.id), { code: 'SPFBL_ADMIN_ONLY' });
    // notifications through the handler
    const call = async (handler, key, extra = {}) => { const res = { code: 200, headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await handler({ user: { id: users[key], email: emails[key], role: key === 'admin' ? 'admin' : 'user', is_super_admin: key === 'admin' }, params: {}, query: {}, body: {}, get: () => 'a', headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...extra }, res); return res; };
    matrix.historyPage = async () => ({ messages: [{ key: 'H1', recipient: 'hist@one.example.com', sender: 'bad@out.example', result: 'BLOCK', arrival: new Date((nowS - 50) * 1000).toISOString(), status: 'NONE' }], next: null, signature: 'h' });
    matrix.registry = async (_c, key) => provider.live.get(key) || { key, recipient: 'hist@one.example.com', sender: 'bad@out.example', from: '', replyto: '', result: 'BLOCK', arrival: new Date((nowS - 50) * 1000).toISOString(), status: 'NONE' };
    const recollect = async () => { await database.query('DELETE FROM spfbl_history_records'); await database.query('DELETE FROM spfbl_history_runs'); await (await controller.collector.start({ trigger: 'manual', windowStartTs: nowS - 3 * 86400 })).done; };
    await recollect();
    let listed = await call(controller.historyList, 'review', { query: { domain: 'one.example.com', status: 'Todos' } }); assert.equal(listed.code, 200, JSON.stringify(listed.body));
    const histRow = listed.body.rows[0];
    let res = await call(controller.requestReview, 'review', { params: { id: histRow.id }, body: { domain: 'one.example.com' } }); assert.equal(res.code, 422, 'the confirmation checkbox is required');
    res = await call(controller.requestReview, 'review', { params: { id: histRow.id }, body: { domain: 'one.example.com', confirm: true } }); assert.equal(res.code, 201, JSON.stringify(res.body));
    assert.ok(mails.some((m) => m.to === 'admin@example.invalid' && /solicitação/i.test(m.subject)), 'the Super Admin is notified of a new request');
    assert.ok(!mails.some((m) => /MATRIX_SECRET|provider_key/.test(m.text)), 'no secrets in mail');
    res = await call(controller.requestReview, 'review', { params: { id: histRow.id }, body: { domain: 'one.example.com', confirm: true } }); assert.equal(res.code, 200, 'the second submit is idempotent'); assert.equal(mails.filter((m) => m.to === 'admin@example.invalid').length, 1, 'no second mail');
    res = await call(controller.requestReview, 'bounce', { params: { id: histRow.id }, body: { domain: 'one.example.com', confirm: true } }); assert.equal(res.code, 201, 'a failing mail never blocks a request');
    res = await call(controller.requestReview, 'outsider', { params: { id: histRow.id }, body: { domain: 'one.example.com', confirm: true } }); assert.equal(res.code, 403);
    res = await call(controller.requestReview, 'review', { params: { id: 'nope' }, body: { domain: 'one.example.com', confirm: true } }); assert.equal(res.code, 404);

    // admin keeps one, releases the other
    const kept = await release.keep(actorOf('admin'), first.request.id, 0);
    assert.equal(kept.status, 'kept'); assert.equal(Number(kept.revision), 1);
    await assert.rejects(release.keep(actorOf('admin'), first.request.id, 1), { code: 'SPFBL_REQUEST_NOT_OPEN' });
    assert.equal(provider.whites.length, 0, 'keeping never calls the provider');
    const second = (await release.listRequests(actorOf('admin'))).find((r) => r.recipient === 'hist@one.example.com' && r.actor_name === 'review');
    const detail = await release.requestDetail(actorOf('admin'), second.id);
    assert.match(detail.confirmation, /^[a-f0-9]{64}$/);
    const histFull = await repository.find(integration, histRow.id, 'one.example.com');
    await assert.rejects(release.execute(actorOf('admin'), { row: histFull, domain: 'one.example.com', requestId: second.id, revision: 99, proof: detail.confirmation }, credentials, stub), { code: 'SPFBL_REVISION_CHANGED' });
    await assert.rejects(release.execute(actorOf('admin'), { row: histFull, domain: 'one.example.com', requestId: second.id, revision: second.revision, proof: 'a'.repeat(64) }, credentials, stub), { code: 'SPFBL_CONFIRMATION_STALE' });
    assert.equal(provider.whites.length, 0, 'stale confirmation or revision: nothing sent');
    // the reason changed at the provider: refused, nothing sent, request marked failed (reopenable)
    provider.live.set('H1', { ...provider.live.get('H1') || matrixRegistry('H1'), result: 'BANNED' });
    function matrixRegistry(key) { return { key, recipient: 'hist@one.example.com', sender: 'bad@out.example', from: '', replyto: '', result: 'BLOCK', arrival: new Date(histFull.timestamp * 1000).toISOString(), status: 'NONE' }; }
    await assert.rejects(release.execute(actorOf('admin'), { row: histFull, domain: 'one.example.com', requestId: second.id, revision: second.revision, proof: detail.confirmation }, credentials, stub), { code: 'SPFBL_REASON_CHANGED' });
    assert.equal((await release.getRequest(second.id)).status, 'failed'); assert.equal(provider.whites.length, 0);
    provider.live.set('H1', matrixRegistry('H1'));
    const failedRow = (await release.listRequests(actorOf('admin'))).find((r) => r.id === second.id);
    const detail2 = await release.requestDetail(actorOf('admin'), second.id);
    const done = await release.execute(actorOf('admin'), { row: histFull, domain: 'one.example.com', requestId: second.id, revision: failedRow.revision, proof: detail2.confirmation }, credentials, stub);
    assert.equal(done.request.status, 'unlocked'); assert.deepEqual(provider.whites, ['H1']);
    assert.equal((await database.query("SELECT status FROM spfbl_operations WHERE record_id = $1", [histFull.id])).rows[0].status, 'done');
    await assert.rejects(release.execute(actorOf('admin'), { row: histFull, domain: 'one.example.com', proof: await proofFor('admin', histFull) }, credentials, stub), { code: 'SPFBL_ALREADY_DONE' });
    assert.equal(provider.whites.length, 1, 'a finished unlock is never sent twice');
    assert.equal((await release.latestUnlocks(['one.example.com'])).length, 1); assert.equal((await release.latestUnlocks(['two.example.com'])).length, 0);

    // status lookup re-opens a completed unlock that the provider reports as BLOCKED again; then a new request is possible
    provider.live.set('H1', { ...matrixRegistry('H1'), status: 'BLOCKED' });
    assert.equal((await release.checkCurrent(actorOf('admin'), histFull, 'one.example.com', credentials, stub)).provider_status, 'BLOCKED');
    assert.equal((await release.getRequest(second.id)).status, 'reopened');
    assert.equal((await database.query('SELECT status FROM spfbl_operations WHERE record_id = $1', [histFull.id])).rows[0].status, 'blocked');
    provider.live.set('H1', { ...matrixRegistry('H1'), status: 'UNKNOWN' });
    await assert.rejects(release.checkCurrent(actorOf('admin'), histFull, 'one.example.com', credentials, stub), { code: 'SPFBL_STATUS_UNKNOWN' });
    const renewed = await release.requestReview(actorOf('review'), histFull, 'one.example.com', credentials);
    assert.equal(renewed.created, true); assert.equal(renewed.request.status, 'pending'); assert.equal(renewed.request.id, second.id, 'the same request is re-opened');

    // block again by the admin (decision "kept" or "unlocked" only)
    const unlockedAgain = await (async () => { provider.live.set('H1', matrixRegistry('H1')); const d = await release.requestDetail(actorOf('admin'), second.id);
      return release.execute(actorOf('admin'), { row: histFull, domain: 'one.example.com', requestId: second.id, revision: renewed.request.revision, proof: d.confirmation }, credentials, stub); })();
    assert.equal(unlockedAgain.request.status, 'unlocked'); assert.equal(provider.whites.length, 2, 'a re-opened record can be unlocked once more');
    provider.live.set('H1', { ...matrixRegistry('H1'), status: 'WHITELISTED' });
    const blockDetail = await release.requestDetail(actorOf('admin'), second.id);
    await assert.rejects(release.blockAgain(actorOf('admin'), second.id, { revision: 0, proof: blockDetail.confirmation }, credentials, stub), { code: 'SPFBL_REVISION_CHANGED' });
    const blocked = await release.blockAgain(actorOf('admin'), second.id, { revision: blockDetail.request.revision, proof: blockDetail.confirmation }, credentials, stub);
    assert.equal(blocked.status, 'reblocked'); assert.deepEqual(provider.blocks, ['H1']);

    // ---- the screen survives its own success: after a direct unlock the record is still readable and shows "done" ----
    matrix.unlock = stub.unlock; matrix.registry = async (_c, key) => provider.live.get(key) || matrixRegistryFallback(key);
    function matrixRegistryFallback(key) { return { key, recipient: 'hist@one.example.com', sender: 'bad@out.example', result: 'BLOCK', arrival: new Date((nowS - 50) * 1000).toISOString(), status: 'NONE' }; }
    matrix.historyPage = async () => ({ messages: [{ key: 'D1', recipient: 'direct@one.example.com', sender: 'bad@out.example', result: 'BLOCK', arrival: new Date((nowS - 40) * 1000).toISOString(), status: 'NONE' }], next: null, signature: 'd1' });
    provider.live.set('D1', { key: 'D1', recipient: 'direct@one.example.com', sender: 'bad@out.example', from: '', replyto: '', result: 'BLOCK', arrival: new Date((nowS - 40) * 1000).toISOString(), status: 'NONE' });
    await recollect();
    const d1 = (await call(controller.historyList, 'direct', { query: { domain: 'one.example.com', status: 'Todos' } })).body.rows.find((r) => r.recipient === 'direct@one.example.com');
    const before = await call(controller.recordDetail, 'direct', { params: { id: d1.id }, query: { domain: 'one.example.com' } });
    assert.equal(before.code, 200); assert.equal(before.body.can_unlock, true);
    provider.whites.length = 0;
    const unlocked = await call(controller.unlockRecord, 'direct', { params: { id: d1.id }, body: { domain: 'one.example.com', confirm: true, proof: before.body.confirmation } });
    assert.equal(unlocked.code, 200, JSON.stringify(unlocked.body)); assert.deepEqual(provider.whites, ['D1']);
    const after = await call(controller.recordDetail, 'direct', { params: { id: d1.id }, query: { domain: 'one.example.com' } });
    assert.equal(after.code, 200, 'the open record screen is still served after the cache reset'); assert.equal(after.body.operation.done, true); assert.equal(after.body.can_unlock, false);
    assert.equal((await repository.find(integration, d1.id, 'one.example.com')).provider_status, 'WHITELISTED', 'the stored copy reflects the unlock at once');

    // ---- what the person sees afterwards: "was blocked, now unlocked", who and when; filter; then a direct block ----
    const listAfter = await call(controller.historyList, 'direct', { query: { domain: 'one.example.com', status: 'Todos' } });
    const d1Row = listAfter.body.rows.find((r) => r.recipient === 'direct@one.example.com');
    assert.equal(d1Row.status, 'Bloqueados', 'the original classification is kept');
    assert.equal(d1Row.release.state, 'unlocked'); assert.equal(d1Row.release.by, 'direct'); assert.ok(d1Row.release.at, 'the list shows who unlocked and when');
    const onlyUnlocked = await call(controller.historyList, 'direct', { query: { domain: 'one.example.com', status: 'Desbloqueados' } });
    assert.deepEqual(onlyUnlocked.body.rows.map((r) => r.recipient), ['direct@one.example.com'], 'the "Desbloqueados" filter lists released records only');
    const blockedOnly = await call(controller.historyList, 'direct', { query: { domain: 'one.example.com', status: 'Bloqueados' } });
    assert.ok(blockedOnly.body.rows.some((r) => r.recipient === 'direct@one.example.com' && r.release.state === 'unlocked'), 'a released record still lists as blocked-by-origin but carries the release badge');
    const detailAfter = await call(controller.recordDetail, 'direct', { params: { id: d1.id }, query: { domain: 'one.example.com' } });
    assert.equal(detailAfter.body.release.state, 'unlocked'); assert.equal(detailAfter.body.release.unlocked_by, 'direct'); assert.equal(detailAfter.body.events[0].action, 'unlocked'); assert.equal(detailAfter.body.events[0].by, 'direct');
    assert.equal(detailAfter.body.can_block, true, 'an unlocked record can be blocked again');
    // direct block through the handler: refuses without confirmation / stale proof, refuses review-mode accounts, one provider call, no second block
    matrix.block = stub.block; provider.blocks.length = 0;
    let blockRes = await call(controller.blockSender, 'direct', { params: { id: d1.id }, body: { domain: 'one.example.com', proof: detailAfter.body.confirmation } }); assert.equal(blockRes.code, 422);
    blockRes = await call(controller.blockSender, 'direct', { params: { id: d1.id }, body: { domain: 'one.example.com', confirm: true, proof: 'a'.repeat(64) } }); assert.equal(blockRes.code, 409);
    blockRes = await call(controller.blockSender, 'review', { params: { id: d1.id }, body: { domain: 'one.example.com', confirm: true, proof: detailAfter.body.confirmation } }); assert.equal(blockRes.code, 403, 'review-mode accounts cannot block directly');
    provider.live.set('D1', { ...provider.live.get('D1'), status: 'WHITELISTED' });
    blockRes = await call(controller.blockSender, 'direct', { params: { id: d1.id }, body: { domain: 'one.example.com', confirm: true, proof: detailAfter.body.confirmation } });
    assert.equal(blockRes.code, 200, JSON.stringify(blockRes.body)); assert.deepEqual(provider.blocks, ['D1']);
    const afterBlock = await call(controller.recordDetail, 'direct', { params: { id: d1.id }, query: { domain: 'one.example.com' } });
    assert.equal(afterBlock.body.release.state, 'blocked'); assert.equal(afterBlock.body.can_block, false, 'a blocked record offers no second block'); assert.equal(afterBlock.body.can_unlock, true, 'and can be unlocked again');
    assert.equal(afterBlock.body.events.map((e) => e.action).join(), 'reblocked,unlocked');
    blockRes = await call(controller.blockSender, 'direct', { params: { id: d1.id }, body: { domain: 'one.example.com', confirm: true, proof: afterBlock.body.confirmation } }); assert.equal(blockRes.code, 409, 'blocking twice is refused'); assert.equal(provider.blocks.length, 1);
    // a record the provider already reports as BLOCKED is refused before anything is sent
    provider.live.set('D1', { ...provider.live.get('D1'), status: 'BLOCKED' });
    const freshState = await call(controller.recordDetail, 'direct', { params: { id: d1.id }, query: { domain: 'one.example.com' } });
    assert.equal((await call(controller.blockSender, 'direct', { params: { id: d1.id }, body: { domain: 'one.example.com', confirm: true, proof: freshState.body.confirmation } })).code, 409); assert.equal(provider.blocks.length, 1);
    // an accepted (Livres) record can also be blocked: the sender is blocked, not only released
    const free = history.normalizeRecord({ key: 'L1', recipient: 'free@one.example.com', sender: 'spam@out.example', result: 'ACCEPT', arrival: new Date((nowS - 20) * 1000).toISOString(), status: 'NONE' }, integration);
    provider.live.set('L1', { key: 'L1', recipient: 'free@one.example.com', sender: 'spam@out.example', result: 'ACCEPT', arrival: new Date(free.timestamp * 1000).toISOString(), status: 'NONE' });
    const freeOp = release.confirmation(users.direct, { ...free, operation_revision: 0 });
    await release.blockRecord(actorOf('direct', 'direct'), { row: free, domain: 'one.example.com', proof: freeOp }, credentials, stub);
    assert.deepEqual(provider.blocks, ['D1', 'L1'].slice(0, 1).concat(['L1']), 'a listed accepted sender can be blocked');
    assert.equal((await database.query("SELECT status FROM spfbl_operations WHERE record_id = $1", [free.id])).rows[0].status, 'blocked');
    provider.blocks.length = 0;

    // ---- audit page, admin overview of every registered domain, and the bell for administrators ----
    await database.query("INSERT INTO system_audit_events(user_id,user_email,action,status,metadata) VALUES ($1,$2,'spfbl_unlock_done','failed',$3)", [users.direct, emails.direct,
      JSON.stringify({ domain: 'one.example.com', reason: 'SPFBL_UNCERTAIN', password: 'AUDIT_SECRET_SENTINEL', provider_key: 'PK_SENTINEL', diagnostic: 'white HTTP=200 result=FAIL', extra: { nested: 'x' } })]);
    let auditRes = await call(controller.auditList, 'admin', { query: {} });
    assert.equal(auditRes.code, 200, JSON.stringify(auditRes.body)); assert.ok(auditRes.body.total >= 5);
    assert.ok(auditRes.body.events.every((e) => e.action.startsWith('spfbl_')), 'only SPFBL entries');
    assert.ok(auditRes.body.events.some((e) => e.action === 'spfbl_review_requested' && e.details.domain === 'one.example.com' && e.label === 'Revisão solicitada'));
    assert.ok(!JSON.stringify(auditRes.body).includes('AUDIT_SECRET_SENTINEL') && !JSON.stringify(auditRes.body).includes('PK_SENTINEL'), 'metadata passes an allow-list');
    const sentinel = auditRes.body.events.find((e) => e.details.diagnostic === 'white HTTP=200 result=FAIL'); assert.deepEqual(Object.keys(sentinel.details).sort(), ['diagnostic', 'domain', 'reason']);
    auditRes = await call(controller.auditList, 'admin', { query: { status: 'failed', action: 'spfbl_unlock_done', domain: 'ONE.example.com' } }); assert.equal(auditRes.code, 200);
    assert.ok(auditRes.body.events.length >= 1 && auditRes.body.events.every((e) => e.status === 'failed' && e.action === 'spfbl_unlock_done'));
    assert.equal((await call(controller.auditList, 'admin', { query: { action: 'login_failed' } })).code, 422, 'only SPFBL actions can be requested');
    assert.equal((await call(controller.auditList, 'admin', { query: { start: '2026-13-40' } })).code, 422);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    assert.ok((await call(controller.auditList, 'admin', { query: { start: today, end: today } })).body.total >= 5, 'a same-day period includes today');
    assert.equal((await call(controller.auditList, 'admin', { query: { start: '2000-01-01', end: '2000-01-02' } })).body.total, 0);
    assert.equal((await call(controller.auditList, 'admin', { query: { page: '9999' } })).body.page, auditRes.body.pages > 1 ? (await call(controller.auditList, 'admin', { query: { page: '9999' } })).body.pages : 1);
    assert.equal((await call(controller.auditList, 'admin', { query: { page_size: '40' } })).body.page_size, 40); assert.equal((await call(controller.auditList, 'admin', {})).body.page_size, 20);
    assert.equal((await call(controller.auditList, 'admin', { query: { page_size: '25' } })).code, 422, 'only 20, 40 or 100 per page');
    assert.equal((await call(controller.historyList, 'admin', { query: { domain: 'one.example.com', page_size: '7' } })).code, 422);
    assert.equal((await call(controller.historyList, 'admin', { query: { domain: 'one.example.com', status: 'Todos', page_size: '100' } })).body.page_size, 100);

    matrix.historyPage = async () => ({ messages: [
      { key: 'A1', recipient: 'a@one.example.com', sender: 's@out.example', result: 'BANNED', arrival: new Date((nowS - 100) * 1000).toISOString(), status: 'NONE' },
      { key: 'A2', recipient: 'b@one.example.com', sender: 's@out.example', result: 'BLOCK', arrival: new Date((nowS - 90) * 1000).toISOString(), status: 'NONE' },
      { key: 'A3', recipient: 'c@one.example.com', sender: 's@out.example', result: 'ACCEPT', arrival: new Date((nowS - 80) * 1000).toISOString(), status: 'NONE' },
      { key: 'A4', recipient: 'x@unregistered.example', sender: 's@out.example', result: 'BLOCK', arrival: new Date((nowS - 70) * 1000).toISOString(), status: 'NONE' }], next: null, signature: 'ad' });
    await recollect();
    const overviewRes = await call(controller.adminDomains, 'admin'); assert.equal(overviewRes.code, 200, JSON.stringify(overviewRes.body));
    const byDomain = Object.fromEntries(overviewRes.body.domains.map((d) => [d.domain, d]));
    assert.deepEqual(Object.keys(byDomain).sort(), ['one.example.com', 'two.example.com'], 'every registered domain, and only registered ones');
    assert.deepEqual([byDomain['one.example.com'].total, byDomain['one.example.com'].blocked, byDomain['one.example.com'].banimento, byDomain['one.example.com']['segurança']], [3, 2, 1, 1]);
    assert.deepEqual([byDomain['two.example.com'].total, byDomain['two.example.com'].blocked], [0, 0], 'a registered domain without records still appears');
    assert.ok(byDomain['one.example.com'].unlocked >= 1, 'unlocks of the window are counted'); assert.ok(byDomain['one.example.com'].pending >= 0);
    assert.equal(overviewRes.body.domains[0].domain, 'one.example.com', 'sorted by blocks'); assert.equal(overviewRes.body.totals.total, 3);
    assert.equal((await call(controller.adminDomains, 'admin')).body.state.loading, false);

    const securityController = require('../src/controllers/securityController');
    const bell = await call(securityController.getSecurityNotifications, 'admin');
    assert.equal(bell.code, 200, JSON.stringify(bell.body));
    const requested = bell.body.items.find((i) => i.title === 'Nova solicitação de revisão (SPFBL)'); assert.ok(requested, 'a new request reaches the administrators bell');
    assert.match(requested.summary, /one\.example\.com/); assert.equal(requested.target_url, '/spfbl?tab=requests');
    const failedBell = bell.body.items.find((i) => i.title === 'Desbloqueio SPFBL não concluído'); assert.ok(failedBell); assert.equal(failedBell.target_url, '/spfbl?tab=audit'); assert.equal(failedBell.severity, 'error');
    assert.ok(!JSON.stringify(bell.body).includes('AUDIT_SECRET_SENTINEL'));
    assert.equal((await call(securityController.getSecurityNotifications, 'direct')).code, 403, 'ordinary accounts never see the bell');

    // ---- first run: nothing authorized, wrong credentials ----
    await access.saveAccess(users.outsider, { unlock_mode: 'review', domain_ids: [dom.two] }, users.admin);
    await database.query('UPDATE spfbl_domains SET active = FALSE WHERE id = $1', [dom.two]);
    let calls = 0; const realPage = matrix.historyPage; matrix.historyPage = async (...a) => { calls += 1; return realPage(...a); };
    const emptyDash = await call(controller.dashboard, 'outsider'); assert.equal(emptyDash.code, 200); assert.deepEqual(emptyDash.body.domains_scope, []); assert.equal(emptyDash.body.total, 0); assert.equal(calls, 0, 'no provider call without an authorized domain');
    const emptyHist = await call(controller.historyList, 'outsider'); assert.equal(emptyHist.code, 200); assert.deepEqual(emptyHist.body.rows, []); assert.equal(emptyHist.body.domain, null);
    await database.query('UPDATE spfbl_domains SET active = TRUE WHERE id = $1', [dom.two]);
    const { MatrixError } = matrix;
    matrix.historyPage = async () => { throw new MatrixError('O Matrix recusou a autenticação. Revise o usuário e a senha.', 'MATRIX_AUTH_REFUSED', 422); };
    await recollect();
    const failed = await call(controller.dashboard, 'admin'); assert.equal(failed.code, 200);
    assert.ok(failed.body.state.error && failed.body.state.partial, 'a failed collection is shown, not hidden as partial coverage');
    assert.ok(!/MATRIX_SECRET/.test(JSON.stringify(failed.body)));
    matrix.historyPage = realPage;
    await call(controller.saveSettings, 'admin', { body: { matrix_user: 'ops@example.com', matrix_password: 'MATRIX_SECRET_SENTINEL_2' } });
    const recovered = await call(controller.dashboard, 'admin'); assert.equal(recovered.body.state.error, '', 'saving credentials clears the cached failure at once');

    // ---- direct unlock: concurrent claims -> exactly one provider call ----
    const c1 = rowOf('C1', 'race@one.example.com'); register(c1);
    provider.whites.length = 0;
    const attempts = await Promise.allSettled([...Array(6)].map((_, i) => release.execute(actorOf(i % 2 ? 'direct' : 'direct2', 'direct'), { row: c1, domain: 'one.example.com',
      proof: release.confirmation(users[i % 2 ? 'direct' : 'direct2'], { ...c1, operation_revision: 0 }) }, credentials, stub)));
    assert.equal(provider.whites.length, 1, 'six concurrent unlocks of one record reach the provider exactly once');
    assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
    assert.ok(attempts.filter((a) => a.status === 'rejected').every((a) => ['SPFBL_OPERATION_CHANGED', 'SPFBL_OPERATION_UNCERTAIN', 'SPFBL_ALREADY_DONE', 'SPFBL_ALREADY_HANDLED'].includes(a.reason.code)), attempts.map((a) => a.reason?.code).join());
    assert.equal((await database.query('SELECT count(*)::int AS n FROM spfbl_operations WHERE record_id = $1', [c1.id])).rows[0].n, 1);

    // ---- uncertainty: provider failure is recorded, never retried, and blocks until a person checks ----
    const u1 = rowOf('U1', 'unsure@one.example.com'); register(u1);
    provider.whites.length = 0; provider.failWhite = true;
    await assert.rejects(release.execute(actorOf('direct', 'direct'), { row: u1, domain: 'one.example.com', proof: release.confirmation(users.direct, { ...u1, operation_revision: 0 }) }, credentials, stub), { code: 'SPFBL_UNCERTAIN' });
    provider.failWhite = false;
    assert.equal((await database.query('SELECT status FROM spfbl_operations WHERE record_id = $1', [u1.id])).rows[0].status, 'uncertain');
    assert.equal((await database.query('SELECT status FROM spfbl_requests WHERE record_id = $1', [u1.id])).rows[0].status, 'uncertain');
    await assert.rejects(release.execute(actorOf('direct', 'direct'), { row: u1, domain: 'one.example.com', proof: release.confirmation(users.direct, { ...u1, operation_revision: 0 }) }, credentials, stub), { code: 'SPFBL_OPERATION_UNCERTAIN' });
    assert.equal(provider.whites.length, 1, 'an uncertain attempt is not retried');
    const state = await release.recordState(actorOf('direct', 'direct'), u1); assert.equal(state.can_unlock, false); assert.equal(state.operation.uncertain, true);
    // a crash between intent and answer: leftover "processing" becomes "uncertain" after the stale window, never retried
    const s1 = rowOf('S1', 'crash@one.example.com');
    await database.query("INSERT INTO spfbl_operations(record_id,status,updated_at) VALUES ($1,'processing', now() - interval '11 minutes')", [s1.id]);
    await database.query("INSERT INTO spfbl_requests(record_id,actor_id,domain,recipient,sender,provider_key,integration_hash,reason,status) VALUES ($1,$2,'one.example.com',$3,'b','S1',$4,'BLOCK','processing')", [s1.id, users.direct, s1.recipient, integration]);
    await release.reconcileStale();
    assert.equal((await database.query('SELECT status FROM spfbl_operations WHERE record_id = $1', [s1.id])).rows[0].status, 'uncertain');
    assert.equal((await database.query('SELECT status FROM spfbl_requests WHERE record_id = $1', [s1.id])).rows[0].status, 'uncertain');
    await database.query("INSERT INTO spfbl_operations(record_id,status) VALUES ($1,'processing') ON CONFLICT DO NOTHING", ['f'.repeat(64)]); await release.reconcileStale();
    assert.equal((await database.query("SELECT status FROM spfbl_operations WHERE record_id = $1", ['f'.repeat(64)])).rows[0].status, 'processing', 'a fresh intent is left alone');

    // ---- another Matrix account cannot be released with this request ----
    const foreign = await database.query("INSERT INTO spfbl_requests(record_id,actor_id,domain,recipient,sender,provider_key,integration_hash,reason) VALUES ($1,$2,'one.example.com','f@one.example.com','b','FK',$3,'BLOCK') RETURNING id", ['e'.repeat(64), users.review, 'd'.repeat(64)]);
    await assert.rejects(release.execute(actorOf('admin'), { row: { id: 'e'.repeat(64), provider_key: 'FK', recipient: 'f@one.example.com', sender: 'b', result: 'BLOCK' }, domain: 'one.example.com', requestId: foreign.rows[0].id, revision: 0,
      proof: release.confirmation(users.admin, { id: 'e'.repeat(64), provider_key: 'FK', recipient: 'f@one.example.com', sender: 'b', result: 'BLOCK', operation_revision: 0 }) }, credentials, stub), { code: 'SPFBL_INTEGRATION_CHANGED' });

    // ---- decisions survive user deletion ----
    await database.query('DELETE FROM users WHERE id = $1', [users.bounce]);
    const survivor = (await database.query("SELECT actor_id FROM spfbl_requests WHERE recipient = 'hist@one.example.com' AND actor_id IS NULL")).rows;
    assert.ok(survivor.length >= 1, 'a request outlives its author (actor_id becomes NULL)');
    assert.ok((await database.query("SELECT count(*)::int AS n FROM spfbl_requests WHERE status = 'unlocked' OR status = 'reblocked' OR status = 'kept'")).rows[0].n >= 2);

    // ---- listing and filters ----
    await assert.rejects(release.listRequests(actorOf('admin'), { status: 'bogus' }), { code: 'SPFBL_FILTER_INVALID' });
    assert.ok((await release.listRequests(actorOf('admin'), { status: 'kept' })).every((r) => r.status === 'kept'));
    console.log('PASS spfbl release (native PostgreSQL): review/keep/release/re-block, proof bound to the record state, one provider call under concurrency, uncertainty and stale intent never retried, survives user deletion.');
  } finally {
    try { await database?.pool.end(); } catch { /* ignore */ }
    spawnSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { ...asServer });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
