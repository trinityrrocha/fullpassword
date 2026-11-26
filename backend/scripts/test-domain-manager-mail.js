const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
const db = require('../src/config/database');
const { ensureSecuritySchema } = require('../src/config/securitySchema');
const { BACKUP_TABLES, OPTIONAL_BACKUP_TABLES } = require('../src/config/backupTables');
const { createDnsClient, createBudget, normalizeServers, QueryBudgetError } = require('../src/services/domainManagerDns');
const mail = require('../src/services/domainManagerMailAuth');
const dm = require('../src/services/domainManagerService');
const scheduler = require('../src/services/domainManagerScheduler');

const pg = new PGlite({ extensions: { uuid_ossp } });
const query = async (sql, params) => (!params && /;\s*\S/.test(sql.trim()) ? pg.exec(sql) : pg.query(sql, params));
db.query = query;
db.pool.connect = async () => ({ query, release() {} });

// A fake resolver with the real client's contract: three states, and every query spends the budget.
const ok = (...records) => ({ state: 'ok', records });
const ABSENT = { state: 'absent', code: 'ENODATA' };
const NXDOMAIN = { state: 'absent', code: 'ENOTFOUND' };
const FAIL = { state: 'inconclusive', code: 'ESERVFAIL' };
const fakeDns = (zone, log = []) => {
  const answer = (type, name, budget) => { budget?.spend(); log.push(`${type} ${name}`); return zone[`${type} ${name}`] || ABSENT; };
  return { txt: async (n, b) => answer('TXT', n, b), a: async (n, b) => answer('A', n, b), aaaa: async (n, b) => answer('AAAA', n, b), mx: async (n, b) => answer('MX', n, b) };
};
const rsaKey = (bits) => crypto.generateKeyPairSync('rsa', { modulusLength: bits }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const edKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const KEY2048 = rsaKey(2048);
const KEY1024 = rsaKey(1024);
const run = (domain, zone, extra = {}) => mail.checkMailAuth(domain, { dns: fakeDns(zone), selectors: ['default', 'google'], ...extra });

async function run_() {
  // ---------- DNS client: three states, TXT chunks joined, budget ----------
  const errors = (code) => () => Promise.reject(Object.assign(new Error(code), { code }));
  const client = createDnsClient({ resolverFactory: () => ({
    resolveTxt: async (name) => (name === 'chunks.test' ? [['v=spf1 ip4:1.2.3.4 ', 'include:a.test -all']] : name === 'two.test' ? [['a'], ['b']] : errors(name === 'nx.test' ? 'ENOTFOUND' : name === 'nodata.test' ? 'ENODATA' : name === 'fail.test' ? 'ESERVFAIL' : 'ETIMEOUT')()),
    resolveMx: async () => [{ exchange: 'MX1.Example.COM.', priority: 10 }], resolve4: async () => ['1.2.3.4'], resolve6: errors('ENODATA')
  }) });
  assert.deepEqual(await client.txt('chunks.test'), { state: 'ok', records: ['v=spf1 ip4:1.2.3.4 include:a.test -all'] }, 'chunks of one record are joined without a separator');
  assert.deepEqual((await client.txt('two.test')).records, ['a', 'b'], 'separate records stay separate');
  assert.deepEqual(await client.txt('nx.test'), { state: 'absent', code: 'ENOTFOUND' });
  assert.deepEqual(await client.txt('nodata.test'), { state: 'absent', code: 'ENODATA' });
  assert.deepEqual(await client.txt('fail.test'), { state: 'inconclusive', code: 'ESERVFAIL' });
  assert.deepEqual(await client.txt('slow.test'), { state: 'inconclusive', code: 'ETIMEOUT' }, 'a timeout is never "absent"');
  assert.deepEqual((await client.mx('x.test')).records, [{ exchange: 'mx1.example.com', priority: 10 }]);
  assert.equal((await client.aaaa('x.test')).state, 'absent');
  const budget = createBudget({ maxQueries: 2 });
  await client.txt('chunks.test', budget); await client.txt('chunks.test', budget);
  await assert.rejects(client.txt('chunks.test', budget), QueryBudgetError);
  let clock = 0;
  const timed = createBudget({ maxQueries: 100, deadlineMs: 1000, now: () => clock });
  clock = 1500;
  assert.throws(() => timed.spend(), QueryBudgetError);
  assert.deepEqual(normalizeServers(['1.1.1.1', ' 10.0.0.5 ', '2606:4700:4700::1111']), ['1.1.1.1', '10.0.0.5', '2606:4700:4700::1111']);
  for (const bad of [['dns.google'], ['1.1.1.1:53'], [''], ['1.1.1.1', '1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'], 'x', null, [5]]) assert.equal(normalizeServers(bad), null, JSON.stringify(bad));

  // ---------- SPF ----------
  const spf = async (record, zone = {}) => (await run('a.test', { 'TXT a.test': ok(...[].concat(record)), ...zone })).spf;
  assert.equal((await run('a.test', {})).spf.status, 'absent');
  assert.equal((await run('a.test', { 'TXT a.test': ok('google-site-verification=x') })).spf.status, 'absent', 'other TXT records are not SPF');
  let r = await spf('v=spf1 ip4:1.2.3.4 ip6:2001:db8::/32 -all');
  assert.deepEqual([r.status, r.all, r.lookups, r.ip_count, r.errors, r.warnings, r.notes], ['ok', '-all', 0, 2, [], [], []]);
  r = await spf('v=spf1 -all'); assert.equal(r.status, 'ok');
  r = await spf('V=SPF1 ~all'); assert.deepEqual([r.status, r.warnings, r.notes], ['warning', ['SPF_SOFTFAIL'], []], '~all is a warning that suggests -all');
  r = await spf('v=spf1 ?all'); assert.deepEqual([r.status, r.warnings], ['warning', ['SPF_NEUTRAL_ALL']]);
  r = await spf('v=spf1 +all'); assert.deepEqual([r.status, r.errors], ['fail', ['SPF_ALL_PLUS']]);
  r = await spf('v=spf1 ip4:1.2.3.4'); assert.deepEqual([r.status, r.warnings], ['warning', ['SPF_NO_ALL']]);
  r = await spf(['v=spf1 -all', 'v=spf1 ~all']); assert.deepEqual([r.status, r.errors], ['fail', ['SPF_MULTIPLE']]);
  r = await spf('v=spf1 foo:bar -all'); assert.deepEqual([r.status, r.errors], ['fail', ['SPF_SYNTAX']]);
  r = await spf('v=spf1 ip4:300.1.1.1 -all'); assert.equal(r.status, 'fail', 'an invalid address is a syntax error');
  r = await spf('v=spf1 ip4:1.2.3.4/33 -all'); assert.equal(r.status, 'fail');
  r = await spf('v=spf1 ip6:1.2.3.4 -all'); assert.equal(r.status, 'fail', 'ip6 needs an IPv6 address');
  r = await spf('v=spf1 -all ip4:1.2.3.4'); assert.deepEqual([r.status, r.warnings], ['warning', ['SPF_TEXT_AFTER_ALL']]);
  r = await spf('v=spf1 ptr -all'); assert.deepEqual([r.status, r.warnings], ['warning', ['SPF_PTR']]);
  r = await spf('v=spf1 include:ptr.example.com -all', { 'TXT ptr.example.com': ok('v=spf1 -all') });
  assert.deepEqual([r.status, r.warnings], ['ok', []], 'a host NAMED ptr is not the ptr mechanism');
  // include chain, counts and per-domain details
  r = await spf('v=spf1 include:_spf.big.test include:spf.two.test -all', { 'TXT _spf.big.test': ok('v=spf1 ip4:10.0.0.0/8 ip4:11.0.0.0/8 -all'), 'TXT spf.two.test': ok('v=spf1 a mx -all'), 'A a.test': ok('1.1.1.1'), 'MX a.test': ok({}) });
  assert.deepEqual([r.status, r.lookups, r.ip_count, r.includes], ['ok', 4, 2, ['_spf.big.test', 'spf.two.test']]);
  const eleven = Array.from({ length: 11 }, (_, i) => `include:i${i}.test`).join(' ');
  const elevenZone = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`TXT i${i}.test`, ok('v=spf1 -all')]));
  r = await spf(`v=spf1 ${eleven} -all`, elevenZone); assert.deepEqual([r.status, r.errors], ['fail', ['SPF_TOO_MANY_LOOKUPS']]);
  const ten = Array.from({ length: 10 }, (_, i) => `include:i${i}.test`).join(' ');
  r = await spf(`v=spf1 ${ten} -all`, elevenZone); assert.deepEqual([r.status, r.lookups], ['ok', 10], 'exactly 10 is allowed');
  r = await spf('v=spf1 include:b.test -all', { 'TXT b.test': ok('v=spf1 include:a.test -all') }); assert.deepEqual([r.status, r.errors], ['fail', ['SPF_LOOP']]);
  r = await spf('v=spf1 include:self.test -all', { 'TXT self.test': ok('v=spf1 include:self.test -all') }); assert.deepEqual(r.errors, ['SPF_LOOP']);
  r = await spf('v=spf1 include:none.test -all'); assert.deepEqual([r.status, r.errors], ['fail', ['SPF_INCLUDE_NO_RECORD']]);
  r = await spf('v=spf1 include:dup.test -all', { 'TXT dup.test': ok('v=spf1 -all', 'v=spf1 ~all') }); assert.deepEqual(r.errors, ['SPF_MULTIPLE']);
  r = await spf('v=spf1 redirect=other.test', { 'TXT other.test': ok('v=spf1 ip4:5.5.5.5 -all') }); assert.deepEqual([r.status, r.all, r.lookups, r.ip_count], ['ok', '-all', 1, 1]);
  r = await spf('v=spf1 redirect=nowhere.test'); assert.deepEqual([r.status, r.errors], ['fail', ['SPF_INCLUDE_NO_RECORD']]);
  r = await spf('v=spf1 exists:%{i}._spf.example.com include:%{d}.x.test -all');
  assert.deepEqual([r.status, r.lookups], ['ok', 2], 'macros are counted but never resolved');
  let log = [];
  await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 exists:%{i}.x.test include:%{d}.y.test -all') }, log), selectors: [] });
  assert.ok(!log.some((entry) => entry.includes('%')), 'no query with a macro in it');
  r = await spf('v=spf1 a:v1.test a:v2.test a:v3.test -all'); assert.deepEqual([r.status, r.void_lookups, r.warnings], ['warning', 3, ['SPF_VOID_LOOKUPS']]);
  // the SAME provider included by two branches is legitimate: only a name on the current chain is a loop
  r = await spf('v=spf1 include:a1.test include:b1.test -all', { 'TXT a1.test': ok('v=spf1 include:shared.test -all'), 'TXT b1.test': ok('v=spf1 include:shared.test -all'), 'TXT shared.test': ok('v=spf1 ip4:9.9.9.0/24 -all') });
  assert.deepEqual([r.status, r.errors, r.lookups, r.ip_count], ['ok', [], 4, 2], 'a shared include is not a loop');
  r = await spf('v=spf1 include:p1.test include:P1.test -all', { 'TXT p1.test': ok('v=spf1 -all') });
  assert.deepEqual([r.status, r.errors], ['ok', []], 'the same include twice is not a loop either');
  r = await spf('v=spf1 include:x1.test redirect=x1.test', { 'TXT x1.test': ok('v=spf1 ip4:1.2.3.4 -all') }); assert.equal(r.status, 'ok');
  r = await spf('v=spf1 redirect=open.test', { 'TXT open.test': ok('v=spf1 ip4:5.5.5.5') }); assert.deepEqual([r.status, r.warnings], ['warning', ['SPF_NO_ALL']], 'a redirect that ends without "all" is warned too');
  for (const term of ['a/33', 'mx/99', 'a//129', 'a:host/abc', 'mx:x.test/24/24']) { r = await spf(`v=spf1 ${term} -all`); assert.equal(r.status, 'fail', term); }
  for (const term of ['a/24', 'mx/32', 'a:host.test/24//64', 'mx:mail.test//64', 'a//128']) { r = await spf(`v=spf1 ${term} -all`); assert.notEqual(r.status, 'fail', term); }
  // an unreachable resolver says nothing; a failed include makes the whole answer inconclusive
  assert.equal((await run('a.test', { 'TXT a.test': FAIL })).spf.status, 'inconclusive');
  r = await spf('v=spf1 include:flaky.test -all', { 'TXT flaky.test': FAIL }); assert.equal(r.status, 'inconclusive');
  // attacker-controlled chains are bounded by the budget
  const chain = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`TXT c${i}.test`, ok(`v=spf1 include:c${i + 1}.test -all`)]));
  log = [];
  const bounded = await mail.checkMailAuth('c0.test', { dns: fakeDns(chain, log), selectors: [], budget: createBudget({ maxQueries: 8 }) });
  assert.ok(log.filter((entry) => !entry.includes('_domainkey')).length <= 8, 'the budget stops the walk (DKIM has its own)');
  assert.ok(['inconclusive', 'fail'].includes(bounded.spf.status));

  // ---------- DMARC ----------
  const dmarc = async (record, zone = {}) => (await run('a.test', { 'TXT a.test': ok('v=spf1 -all'), '_x': ABSENT, ...(record === null ? {} : { 'TXT _dmarc.a.test': ok(...[].concat(record)) }), ...zone })).dmarc;
  assert.equal((await dmarc(null)).status, 'absent');
  assert.equal((await dmarc('v=spf1 -all')).status, 'absent', 'a TXT that is not DMARC is not a DMARC record');
  let d = await dmarc('v=DMARC1; p=reject; rua=mailto:reports@a.test');
  assert.deepEqual([d.status, d.policy, d.pct, d.rua, d.adkim, d.aspf, d.errors, d.warnings], ['ok', 'reject', 100, ['reports@a.test'], 'r', 'r', [], []]);
  d = await dmarc('v=DMARC1;p=quarantine;rua=mailto:a@x.test,mailto:b@x.test!10m,https://web.example/r;ruf=mailto:f@x.test;adkim=s;aspf=S;pct=50;sp=none');
  assert.deepEqual([d.status, d.rua, d.ruf, d.adkim, d.aspf, d.pct, d.warnings], ['warning', ['a@x.test', 'b@x.test'], ['f@x.test'], 's', 's', 50, ['DMARC_PCT_PARTIAL', 'DMARC_SP_NONE']]);
  d = await dmarc('v=DMARC1; p=none; rua=mailto:r@x.test'); assert.deepEqual([d.status, d.warnings], ['warning', ['DMARC_POLICY_NONE']]);
  d = await dmarc('v=DMARC1; p=reject'); assert.deepEqual([d.status, d.warnings], ['warning', ['DMARC_NO_RUA']]);
  const quiet = (await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all'), 'TXT _dmarc.a.test': ok('v=DMARC1; p=reject') }, []), selectors: [], warnNoReports: false })).dmarc;
  assert.deepEqual([quiet.status, quiet.warnings], ['ok', []], 'with the option off, a reject policy without rua= is valid');
  const quietNone = (await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all'), 'TXT _dmarc.a.test': ok('v=DMARC1; p=none') }, []), selectors: [], warnNoReports: false })).dmarc;
  assert.deepEqual([quietNone.status, quietNone.warnings], ['warning', ['DMARC_POLICY_NONE']], 'the other DMARC warnings stay');
  d = await dmarc('v=DMARC1; p=bogus; rua=mailto:r@x.test'); assert.deepEqual([d.status, d.errors], ['fail', ['DMARC_BAD_POLICY']]);
  d = await dmarc('v=DMARC1; rua=mailto:r@x.test'); assert.deepEqual([d.status, d.warnings], ['warning', ['DMARC_NO_POLICY_TAG']]);
  d = await dmarc('v=DMARC1; fo=1'); assert.deepEqual([d.status, d.errors], ['fail', ['DMARC_NO_POLICY']]);
  d = await dmarc(['v=DMARC1; p=none', 'v=DMARC1; p=reject']); assert.deepEqual([d.status, d.errors], ['fail', ['DMARC_MULTIPLE']]);
  d = await dmarc('v=DMARC1; p=reject; rua=mailto:r@x.test; pct=abc'); assert.deepEqual([d.status, d.pct], ['ok', 100]);
  d = await dmarc('v=DMARC1; p=reject; rua=mailto:r@x.test; pct='); assert.deepEqual([d.status, d.pct, d.warnings], ['ok', 100, []], 'an empty pct is not 0');
  // a name with no DMARC of its own inherits the nearest parent's; two-label names have no parent to ask
  const inheritLog = [];
  const sub = await mail.checkMailAuth('mail.shop.a.test', { dns: fakeDns({ 'TXT mail.shop.a.test': ok('v=spf1 -all'), 'TXT _dmarc.a.test': ok('v=DMARC1; p=reject; rua=mailto:r@a.test') }, inheritLog), selectors: [] });
  assert.deepEqual([sub.dmarc.status, sub.dmarc.inherited_from, sub.dmarc.policy], ['ok', 'a.test', 'reject']);
  assert.deepEqual(inheritLog.filter((entry) => entry.includes('_dmarc')), ['TXT _dmarc.mail.shop.a.test', 'TXT _dmarc.shop.a.test', 'TXT _dmarc.a.test']);
  const own = await mail.checkMailAuth('mail.a.test', { dns: fakeDns({ 'TXT mail.a.test': ok('v=spf1 -all'), 'TXT _dmarc.mail.a.test': ok('v=DMARC1; p=none; rua=mailto:r@a.test'), 'TXT _dmarc.a.test': ok('v=DMARC1; p=reject') }), selectors: [] });
  assert.deepEqual([own.dmarc.policy, own.dmarc.inherited_from], ['none', null], 'its own record wins');
  const twoLabel = [];
  const apexOnly = await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all') }, twoLabel), selectors: [] });
  assert.equal(apexOnly.dmarc.status, 'absent');
  assert.deepEqual(twoLabel.filter((entry) => entry.includes('_dmarc')), ['TXT _dmarc.a.test'], 'no parent queries for a two-label name');
  const none = await mail.checkMailAuth('x.y.z.a.test', { dns: fakeDns({ 'TXT x.y.z.a.test': ok('v=spf1 -all') }), selectors: [] });
  assert.equal(none.dmarc.status, 'absent');
  const upFail = await mail.checkMailAuth('mail.a.test', { dns: fakeDns({ 'TXT mail.a.test': ok('v=spf1 -all'), 'TXT _dmarc.a.test': FAIL }), selectors: [] });
  assert.equal(upFail.dmarc.status, 'inconclusive', 'a failure while walking up says nothing');
  assert.equal((await dmarc(null, { 'TXT _dmarc.a.test': FAIL })).status, 'inconclusive', 'a failure is not "absent"');

  // ---------- DKIM ----------
  const zoneFor = (entries) => ({ 'TXT a.test': ok('v=spf1 -all'), ...Object.fromEntries(Object.entries(entries).map(([sel, rec]) => [`TXT ${sel}._domainkey.a.test`, rec])) });
  let k = (await run('a.test', zoneFor({ default: ok(`v=DKIM1; k=rsa; p=${KEY2048}`) }))).dkim;
  assert.deepEqual([k.status, k.tested, k.found.length, k.found[0].selector, k.found[0].bits, k.found[0].revoked], ['ok', 2, 1, 'default', 2048, false]);
  k = (await run('a.test', zoneFor({ default: ok(`v=DKIM1; p=${KEY1024}`) }))).dkim;
  assert.deepEqual([k.status, k.warnings, k.found[0].bits], ['warning', ['DKIM_WEAK_KEY'], 1024]);
  k = (await run('a.test', zoneFor({ default: ok(`v=DKIM1; p=${KEY1024}`), google: ok(`v=DKIM1; p=${KEY2048}`) }))).dkim;
  assert.deepEqual([k.status, k.notes], ['ok', ['DKIM_WEAK_KEY_SOME']], 'one strong key is enough for ok; the weak one is only a note');
  k = (await run('a.test', zoneFor({ default: ok('v=DKIM1; k=rsa; p=') }))).dkim;
  assert.deepEqual([k.status, k.warnings, k.found[0].revoked], ['warning', ['DKIM_ALL_REVOKED'], true]);
  k = (await run('a.test', zoneFor({ default: ok(`v=DKIM1; k=ed25519; p=${edKey()}`) }))).dkim;
  assert.deepEqual([k.status, k.found[0].key_type, k.found[0].bits], ['ok', 'ed25519', null], 'ed25519 keys are not read as RSA');
  k = (await run('a.test', zoneFor({ default: ok('v=DKIM1; p=bm90LWEta2V5') }))).dkim;
  assert.deepEqual([k.status, k.warnings], ['warning', ['DKIM_KEY_UNREADABLE']]);
  k = (await run('a.test', zoneFor({ default: ok(`v=DKIM1; t=y; p=${KEY2048}`) }))).dkim;
  assert.deepEqual([k.status, k.notes, k.found[0].testing], ['ok', ['DKIM_TESTING'], true]);
  k = (await run('a.test', zoneFor({}))).dkim;
  assert.deepEqual([k.status, k.tested, k.found], ['not_found', 2, []], 'nothing among the tested selectors');
  k = (await run('a.test', { ...zoneFor({ default: FAIL }) })).dkim;
  assert.equal(k.status, 'inconclusive', 'an unreachable selector with nothing found says nothing');
  // a wildcard answers for every selector: nothing can be discovered, so nothing is listed
  const wildcardDns = { txt: async (name, b) => { b?.spend(); return name.endsWith('._domainkey.a.test') ? ok('v=DKIM1; p=') : name === 'a.test' ? ok('v=spf1 -all') : ABSENT; }, a: async () => ABSENT, aaaa: async () => ABSENT, mx: async () => ABSENT };
  k = (await mail.checkMailAuth('a.test', { dns: wildcardDns, selectors: ['default', 'google'] })).dkim;
  assert.deepEqual([k.status, k.wildcard, k.found, k.notes, k.tested], ['not_found', true, [], ['DKIM_WILDCARD'], 0]);
  // selectors are validated and capped
  log = [];
  await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all') }, log), selectors: ['ok1', 'bad selector', '../x', '', 'OK1', 'a'.repeat(80), 'good-2'], budget: createBudget({ maxQueries: 200 }) });
  const probed = log.filter((entry) => entry.includes('._domainkey.') && !entry.includes('dm-')).map((entry) => entry.split(' ')[1].split('._domainkey')[0]).sort();
  assert.deepEqual(probed, ['good-2', 'ok1'], 'only valid, unique selectors are probed');
  for (const bad of ['a..b', 'a.', '.a', '-a', 'a-', 'a b', 'a'.repeat(64), `${'a'.repeat(50)}.${'b'.repeat(50)}`]) assert.equal(mail.isValidSelector(bad), false, bad);
  for (const good of ['a', 's1', 's1.2024', 'a_b', 'k-1', 'a'.repeat(63)]) assert.equal(mail.isValidSelector(good), true, good);
  log = [];
  await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all') }, log), selectors: Array.from({ length: 100 }, (_, i) => `s${i}x`), budget: createBudget({ maxQueries: 500 }) });
  assert.equal(log.filter((entry) => entry.includes('._domainkey.') && !entry.includes('dm-')).length, mail.MAX_PROBED_SELECTORS, 'one check probes at most 60 global + 20 own selectors (the settings enforce each limit)');
  log = [];
  const sixtyPlusExtras = [...Array.from({ length: 60 }, (_, i) => `g${i}x`), 'extra-a', 'extra-b'];
  await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all') }, log), selectors: sixtyPlusExtras, budget: createBudget({ maxQueries: 500 }) });
  const probedAll = log.filter((entry) => entry.includes('._domainkey.') && !entry.includes('dm-'));
  assert.equal(probedAll.length, 62);
  assert.ok(probedAll.some((entry) => entry.includes('extra-a._domainkey')) && probedAll.some((entry) => entry.includes('extra-b._domainkey')), 'a full global list never swallows the domain extras');
  // a full-size selector list still gets a verdict for SPF, DMARC and DKIM together
  const bigZone = { 'TXT a.test': ok('v=spf1 -all'), 'TXT _dmarc.a.test': ok('v=DMARC1; p=reject; rua=mailto:r@a.test'), 'TXT g59x._domainkey.a.test': ok(`v=DKIM1; p=${KEY2048}`) };
  const big = await mail.checkMailAuth('a.test', { dns: fakeDns(bigZone), selectors: Array.from({ length: 80 }, (_, i) => `g${i}x`) });
  assert.deepEqual([big.spf.status, big.dmarc.status, big.dkim.status, big.dkim.found.length], ['ok', 'ok', 'ok', 1], 'the budget fits the largest allowed configuration');

  // ---------- the whole check ----------
  const gone = await mail.checkMailAuth('gone.test', { dns: fakeDns({ 'TXT gone.test': NXDOMAIN }), selectors: ['default'] });
  assert.deepEqual([gone.name_exists, gone.spf.status, gone.dmarc.status, gone.dkim.status], [false, 'absent', 'absent', 'not_found'], 'a name that does not exist is reported once, not three failures');
  const starved = await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all') }), selectors: ['default', 'google'], budget: createBudget({ maxQueries: 1 }) });
  assert.ok([starved.spf, starved.dmarc].some((section) => section.status === 'inconclusive'), 'an exhausted budget is inconclusive, never a verdict');
  const dkimStarved = await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': ok('v=spf1 -all') }), selectors: ['default', 'google', 'k1'], dkimBudget: createBudget({ maxQueries: 2 }) });
  assert.equal(dkimStarved.dkim.status, 'inconclusive', 'the DKIM budget is its own');
  assert.equal(dkimStarved.spf.status, 'ok', 'and never starves SPF');
  const apexDown = await mail.checkMailAuth('a.test', { dns: fakeDns({ 'TXT a.test': FAIL }), selectors: [] });
  assert.equal(apexDown.name_exists, true);

  // ---------- schema and settings ----------
  await pg.exec(read('database/init.sql'));
  const adminId = '00000000-0000-0000-0000-0000000000a1';
  await pg.query("INSERT INTO users(id,name,email,hash_senha_login,wrapped_key,crypto_salt,is_super_admin,is_active) VALUES ($1,'A','admin@example.invalid','H','W','S',true,true)", [adminId]);
  await ensureSecuritySchema(); await ensureSecuritySchema();
  const migration = read('database/migrations/38_domain_manager_mail_auth.sql');
  await pg.exec(migration); await pg.exec(migration);
  const migration39 = read('database/migrations/39_domain_manager_report_ssl_options.sql');
  await pg.exec(migration39); await pg.exec(migration39);
  for (const table of ['dm_mail_checks', 'dm_mail_domain_settings']) assert.ok(BACKUP_TABLES.includes(table) && OPTIONAL_BACKUP_TABLES.has(table), `${table} in both backup lists`);
  const defaults = (await pg.query('SELECT mail_check_enabled, mail_check_interval_days, dkim_selectors, dns_servers FROM dm_settings')).rows[0];
  assert.deepEqual([defaults.mail_check_enabled, defaults.mail_check_interval_days, defaults.dkim_selectors.length, defaults.dns_servers], [true, 7, dm.DEFAULT_DKIM_SELECTORS.length, []]);
  const opts = (await pg.query('SELECT dmarc_no_report_warning, ssl_check_enabled FROM dm_settings')).rows[0];
  assert.deepEqual([opts.dmarc_no_report_warning, opts.ssl_check_enabled], [true, true], 'both new options default to on (current behavior)');
  await assert.rejects(pg.query('UPDATE dm_settings SET mail_check_interval_days = 31'));
  const sample = (await pg.query("INSERT INTO dm_domains(name) VALUES ('check.test') RETURNING id")).rows[0].id;
  for (const field of ['spf_status', 'spf_record', 'dmarc_status', 'dmarc_policy', 'dkim_status', 'expires_on']) await pg.query('INSERT INTO dm_changes(domain_id, field) VALUES ($1,$2)', [sample, field]);
  await assert.rejects(pg.query("INSERT INTO dm_changes(domain_id, field) VALUES ($1,'nope')", [sample]), 'the change field list is still enforced');
  await assert.rejects(pg.query("INSERT INTO dm_mail_checks(domain_id, checked_at, spf_status, dmarc_status, dkim_status) VALUES ($1, now(), 'bad', 'ok', 'ok')", [sample]));
  await pg.query('DELETE FROM dm_domains WHERE id = $1', [sample]);

  let now = Date.parse('2026-11-26T15:00:00Z');
  const DAY = 86400000;
  const zones = new Map();
  const sets = [];
  const service = dm.createService({
    rdap: { lookup: async () => ({ lookup_status: 'not_found' }) }, ssl: { probe: async () => ({ ssl_state: 'none' }) }, now: () => now,
    dnsFactory: (servers) => { sets.push(servers); return { txt: async (n, b) => { b?.spend(); return zones.get(`TXT ${n}`) || ABSENT; }, a: async () => ABSENT, aaaa: async () => ABSENT, mx: async () => ABSENT }; }
  });

  assert.deepEqual(await service.getSettings(), { check_interval_days: 7, mail_check_enabled: true, mail_check_interval_days: 7, dkim_selectors: [...dm.DEFAULT_DKIM_SELECTORS], dns_servers: [], dmarc_no_report_warning: true, ssl_check_enabled: true, default_dkim_selectors: [...dm.DEFAULT_DKIM_SELECTORS] });
  const full = { check_interval_days: 3, mail_check_enabled: true, mail_check_interval_days: 5, dkim_selectors: ['Default', 'mykey', 'default'], dns_servers: ['10.0.0.9'] };
  const saved = await service.saveSettings(full);
  assert.deepEqual([saved.check_interval_days, saved.mail_check_interval_days, saved.dkim_selectors, saved.dns_servers], [3, 5, ['default', 'mykey'], ['10.0.0.9']], 'selectors are lower-cased and de-duplicated');
  for (const [patch, code] of [[{ check_interval_days: 0 }, 'DM_INTERVAL_INVALID'], [{ check_interval_days: '7' }, 'DM_INTERVAL_INVALID'], [{ mail_check_enabled: 'yes' }, 'DM_MAIL_INVALID'], [{ mail_check_interval_days: 31 }, 'DM_MAIL_INTERVAL_INVALID'],
    [{ dkim_selectors: ['bad name'] }, 'DM_SELECTORS_INVALID'], [{ dkim_selectors: [] }, 'DM_SELECTORS_INVALID'], [{ dkim_selectors: ['a..b'] }, 'DM_SELECTORS_INVALID'], [{ dkim_selectors: 'x' }, 'DM_SELECTORS_INVALID'], [{ dkim_selectors: Array.from({ length: 61 }, (_, i) => `s${i}x`) }, 'DM_SELECTORS_INVALID'],
    [{ dns_servers: ['dns.google'] }, 'DM_DNS_SERVERS_INVALID'], [{ dns_servers: ['1.1.1.1:53'] }, 'DM_DNS_SERVERS_INVALID']]) {
    await assert.rejects(service.saveSettings({ ...full, ...patch }), { code }, JSON.stringify(patch));
  }
  await assert.rejects(service.saveSettings({ check_interval_days: 7 }), { code: 'DM_MAIL_INVALID' }, 'the settings card always sends every field');
  assert.equal((await service.getSettings()).mail_check_interval_days, 5, 'a refused save changes nothing');
  await service.saveSettings({ ...full, dns_servers: [] });
  assert.deepEqual([(await service.saveSettings({ ...full, dns_servers: [] })).dmarc_no_report_warning, (await service.getSettings()).ssl_check_enabled], [true, true], 'the options keep their value when a save leaves them out');
  await assert.rejects(service.saveSettings({ ...full, ssl_check_enabled: 'no' }), { code: 'DM_OPTION_INVALID' });
  await assert.rejects(service.saveSettings({ ...full, dmarc_no_report_warning: 1 }), { code: 'DM_OPTION_INVALID' });
  const both = await service.saveSettings({ ...full, dns_servers: [], dmarc_no_report_warning: false, ssl_check_enabled: false });
  assert.deepEqual([both.dmarc_no_report_warning, both.ssl_check_enabled], [false, false]);
  await service.saveSettings({ ...full, dns_servers: [], dmarc_no_report_warning: true, ssl_check_enabled: true });

  // ---------- checkMail: store, summary, changes, inconclusive keeps data ----------
  const added = await service.addDomain('alvo.test', adminId);
  const id = added.id;
  assert.equal(added.mail, null);
  assert.equal((await service.getMailSettings(id)).enabled, true);
  zones.set('TXT alvo.test', ok('v=spf1 include:_spf.alvo.test -all'));
  zones.set('TXT _spf.alvo.test', ok('v=spf1 ip4:203.0.113.0/24 -all'));
  zones.set('TXT _dmarc.alvo.test', ok('v=DMARC1; p=none; rua=mailto:r@alvo.test'));
  zones.set('TXT default._domainkey.alvo.test', ok(`v=DKIM1; p=${KEY2048}`));
  let outcome = await service.checkMail(id);
  assert.deepEqual(outcome, { changes: 0 }, 'first check: nothing to compare with');
  let row = (await service.list({ search: 'alvo' })).domains[0];
  assert.deepEqual(row.mail, { checked_at: row.mail.checked_at, name_exists: true, spf: { status: 'ok', all: '-all' }, dmarc: { status: 'warning', policy: 'none' }, dkim: { status: 'ok', found: 1 } });
  let detail = await service.detail(id);
  assert.deepEqual([detail.mail.spf.record, detail.mail.spf.lookups, detail.mail.dmarc.warnings, detail.mail.dkim.found[0].bits], ['v=spf1 include:_spf.alvo.test -all', 1, ['DMARC_POLICY_NONE'], 2048]);
  assert.ok(detail.mail.spf.as_of, 'each section says when its data was obtained');
  assert.equal((await pg.query('SELECT next_mail_check_at FROM dm_domains WHERE id = $1', [id])).rows[0].next_mail_check_at.getTime(), now + 5 * DAY, 'next check after the configured interval');
  assert.deepEqual(sets.at(-1), [], 'the system resolver is used when no server is configured');

  // a real change is recorded; a DNS failure is not a change
  now += DAY;
  zones.set('TXT _dmarc.alvo.test', ok('v=DMARC1; p=reject; rua=mailto:r@alvo.test'));
  zones.set('TXT alvo.test', ok('v=spf1 ip4:203.0.113.5 ~all'));
  outcome = await service.checkMail(id);
  assert.equal(outcome.changes, 4, 'dmarc policy, the dmarc status (warning -> ok), the spf record and the spf status (ok -> warning, now that ~all warns) changed');
  const kinds = (await service.detail(id)).changes.map((change) => change.field).sort();
  assert.deepEqual(kinds, ['dmarc_policy', 'dmarc_status', 'spf_record', 'spf_status']);
  const changeCountBefore = (await pg.query('SELECT count(*)::int AS n FROM dm_changes WHERE domain_id = $1', [id])).rows[0].n;
  now += DAY;
  zones.set('TXT alvo.test', FAIL); zones.set('TXT _dmarc.alvo.test', FAIL);
  await service.checkMail(id);
  row = (await service.list({ search: 'alvo' })).domains[0];
  assert.deepEqual([row.mail.spf.status, row.mail.dmarc.status, row.mail.dkim.status], ['warning', 'ok', 'ok'], 'the last known statuses survive a resolver failure');
  detail = await service.detail(id);
  assert.equal(detail.mail.spf.record, 'v=spf1 ip4:203.0.113.5 ~all');
  assert.equal(detail.mail.dmarc.policy, 'reject');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_changes WHERE domain_id = $1', [id])).rows[0].n, changeCountBefore, 'a DNS failure writes no change row');
  assert.equal((await pg.query('SELECT next_mail_check_at FROM dm_domains WHERE id = $1', [id])).rows[0].next_mail_check_at.getTime(), now + 6 * 3600000, 'a failed check is retried in 6 hours');
  // a genuine loss is recorded
  now += DAY;
  zones.delete('TXT _dmarc.alvo.test'); zones.set('TXT alvo.test', ok('v=spf1 ip4:203.0.113.5 ~all'));
  await service.checkMail(id);
  const lost = (await service.detail(id)).changes.find((change) => change.field === 'dmarc_status' && change.new_value === 'absent');
  assert.deepEqual([lost.old_value, lost.new_value], ['ok', 'absent']);
  // a partial DKIM answer (one selector unreachable) must not look like a change
  await service.saveMailSettings(id, { enabled: true, extra_selectors: [] }, adminId);
  zones.set('TXT alvo.test', ok('v=spf1 -all')); zones.set('TXT _dmarc.alvo.test', ok('v=DMARC1; p=reject; rua=mailto:r@alvo.test'));
  zones.set('TXT default._domainkey.alvo.test', ok(`v=DKIM1; p=${KEY2048}`));
  zones.delete('TXT especial._domainkey.alvo.test');
  now += DAY; await service.checkMail(id);
  assert.equal((await service.list({ search: 'alvo' })).domains[0].mail.dkim.status, 'ok');
  const beforePartial = (await pg.query('SELECT count(*)::int AS n FROM dm_changes WHERE domain_id = $1', [id])).rows[0].n;
  zones.set('TXT default._domainkey.alvo.test', FAIL); zones.set('TXT google._domainkey.alvo.test', ok(`v=DKIM1; p=${KEY1024}`));
  now += DAY; await service.checkMail(id);
  assert.equal((await service.list({ search: 'alvo' })).domains[0].mail.dkim.status, 'ok', 'a partial answer keeps the last verdict (ok), not warning');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM dm_changes WHERE domain_id = $1', [id])).rows[0].n, beforePartial, 'and writes no change');
  assert.equal((await pg.query('SELECT next_mail_check_at FROM dm_domains WHERE id = $1', [id])).rows[0].next_mail_check_at.getTime(), now + 6 * 3600000, 'a partial answer is retried soon');
  zones.delete('TXT google._domainkey.alvo.test'); zones.delete('TXT default._domainkey.alvo.test'); zones.set('TXT default._domainkey.alvo.test', ok(`v=DKIM1; p=${KEY2048}`));
  // two checks of the same domain at once: only one runs, so no change is recorded twice
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const slowMail = dm.createService({ now: () => now, mailAuth: async () => { await hold; return { name_exists: true, spf: { status: 'ok', record: 'v=spf1 -all', all: '-all' }, dmarc: { status: 'ok', policy: 'reject' }, dkim: { status: 'ok', found: [], unreachable: 0 } }; } });
  const slowFirst = slowMail.checkMail(id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await slowMail.checkMail(id), null, 'the second check of the same domain is skipped');
  release(); await slowFirst;
  // a name that vanished
  zones.set('TXT alvo.test', NXDOMAIN);
  now += DAY;
  await service.checkMail(id);
  assert.equal((await service.list({ search: 'alvo' })).domains[0].mail.name_exists, false);

  // per-domain settings: extra selectors, disable
  await assert.rejects(service.saveMailSettings(id, { enabled: true, extra_selectors: ['bad name'] }, adminId), { code: 'DM_SELECTORS_INVALID' });
  await assert.rejects(service.saveMailSettings(id, { enabled: 'x', extra_selectors: [] }, adminId), { code: 'DM_MAIL_INVALID' });
  await assert.rejects(service.saveMailSettings('00000000-0000-0000-0000-00000000ffff', { enabled: true, extra_selectors: [] }, adminId), { code: 'DM_NOT_FOUND' });
  zones.set('TXT alvo.test', ok('v=spf1 -all')); zones.set('TXT especial._domainkey.alvo.test', ok(`v=DKIM1; p=${KEY2048}`));
  await service.saveMailSettings(id, { enabled: true, extra_selectors: ['Especial', 'especial'] }, adminId);
  assert.deepEqual((await service.getMailSettings(id)).extra_selectors, ['especial']);
  assert.ok((await pg.query('SELECT next_mail_check_at FROM dm_domains WHERE id = $1', [id])).rows[0].next_mail_check_at.getTime() <= Date.now() + 60000, 'a new selector is checked soon');
  await service.checkMail(id);
  assert.deepEqual((await service.detail(id)).mail.dkim.found.map((key) => key.selector).sort(), ['default', 'especial']);
  await service.saveMailSettings(id, { enabled: false, extra_selectors: [] }, adminId);
  assert.equal(await service.checkMail(id), null, 'a domain with the check turned off is skipped');
  await service.saveMailSettings(id, { enabled: true, extra_selectors: [] }, adminId);
  await service.saveSettings({ ...full, mail_check_enabled: false, dns_servers: [] });
  assert.equal(await service.checkMail(id), null, 'globally off: skipped');
  assert.deepEqual(await service.claimMailBatch(10), [], 'globally off: nothing is claimed');
  await service.saveSettings({ ...full, dns_servers: ['10.1.2.3'] });
  await service.checkMail(id);
  assert.deepEqual(sets.at(-1), ['10.1.2.3'], 'the configured resolver is the one used');

  // ---------- claim: due, enabled, once ----------
  await pg.query('DELETE FROM dm_domains');
  const ids = {};
  for (const name of ['due1.test', 'due2.test', 'later.test', 'off.test', 'inactive.test']) ids[name] = (await service.addDomain(name, adminId)).id;
  await pg.query('UPDATE dm_domains SET next_mail_check_at = $1', [new Date(now - DAY)]);
  await pg.query('UPDATE dm_domains SET next_mail_check_at = $1 WHERE name = $2', [new Date(now + DAY), 'later.test']);
  await pg.query('UPDATE dm_domains SET active = FALSE WHERE name = $1', ['inactive.test']);
  await service.saveMailSettings(ids['off.test'], { enabled: false, extra_selectors: [] }, adminId);
  await pg.query('UPDATE dm_domains SET next_mail_check_at = $1', [new Date(now - DAY)]);
  await pg.query('UPDATE dm_domains SET next_mail_check_at = $1 WHERE name = $2', [new Date(now + DAY), 'later.test']);
  await service.saveSettings(full);
  const claimed = await service.claimMailBatch(10);
  assert.deepEqual(claimed.sort(), [ids['due1.test'], ids['due2.test']].sort(), 'only active, enabled, due domains');
  assert.deepEqual(await service.claimMailBatch(10), [], 'a claimed domain is not claimed twice');
  assert.equal((await service.claimMailBatch(1)).length, 0);

  // ---------- certificate check can be turned off ----------
  let probes = 0;
  const sslService = dm.createService({ rdap: { lookup: async () => ({ lookup_status: 'not_found' }) }, ssl: { probe: async () => { probes += 1; return { ssl_state: 'valid', ssl_not_after: '2030-01-01' }; } }, now: () => now,
    dnsFactory: () => ({ txt: async (n, b) => { b?.spend(); return ABSENT; }, a: async () => ABSENT, aaaa: async () => ABSENT, mx: async () => ABSENT }) });
  const sslDomain = await sslService.addDomain('cert.test', adminId);
  await sslService.checkDomain(sslDomain.id, { manual: true });
  assert.equal(probes, 1, 'the certificate is probed by default');
  await sslService.saveSettings({ ...full, dns_servers: [], ssl_check_enabled: false });
  now += DAY;
  await sslService.checkDomain(sslDomain.id, { manual: true });
  assert.equal(probes, 1, 'with the option off the certificate is not probed');
  assert.equal((await sslService.detail(sslDomain.id)).domain.snapshot.ssl.state, null, 'and no stale certificate is shown');
  await sslService.saveSettings({ ...full, dns_servers: [], ssl_check_enabled: true });

  // ---------- manual check runs the mail check too ----------
  const manual = await service.addDomain('manual.test', adminId);
  zones.set('TXT manual.test', ok('v=spf1 -all'));
  const manualResult = await service.checkDomain(manual.id, { manual: true });
  assert.equal(manualResult.mail.spf.status, 'ok', 'the lookup button also refreshes the e-mail checks');
  // the SCHEDULED registry round never runs the e-mail check (it has its own interval); only the button does
  let mailCalls = 0;
  let spyClock = now + 9 * DAY;
  const spyService = dm.createService({ rdap: { lookup: async () => ({ lookup_status: 'not_found' }) }, ssl: { probe: async () => ({ ssl_state: 'none' }) }, now: () => spyClock, mailAuth: async () => { mailCalls += 1; return { name_exists: true, spf: { status: 'ok' }, dmarc: { status: 'ok' }, dkim: { status: 'ok', found: [], unreachable: 0 } }; } });
  await spyService.checkDomain(manual.id);
  assert.equal(mailCalls, 0, 'the scheduled registry lookup does not touch DNS e-mail checks');
  spyClock += 60000;
  await spyService.checkDomain(manual.id, { manual: true });
  assert.equal(mailCalls, 1, 'the lookup button does');
  const mailFails = dm.createService({ rdap: { lookup: async () => ({ lookup_status: 'not_found' }) }, ssl: { probe: async () => ({ ssl_state: 'none' }) }, now: () => now + 12 * DAY, mailAuth: async () => { throw new Error('boom'); } });
  const stillOk = await mailFails.checkDomain(manual.id, { manual: true });
  assert.equal(stillOk.snapshot.lookup_status, 'not_found', 'a broken mail check never fails the registry result');

  // ---------- scheduler ----------
  scheduler.resetSchedulerState();
  const { modules } = { modules: require('../src/services/modulesService') };
  await modules.setModuleEnabled('domain_manager', true, adminId);
  const calls = [];
  const stub = {
    syncFromSpfbl: async () => 0, claimMailBatch: async () => ['m1', 'm2', 'm3'],
    checkMail: async (mid) => { calls.push(mid); if (mid === 'm2') throw new Error('x'); return { changes: 0 }; },
    checkDomain: async () => ({ snapshot: { error_code: 'RATE_LIMITED' } })
  };
  const alertsStub = { processDue: async () => {} };
  await pg.query('UPDATE dm_domains SET next_check_at = $1', [new Date(now - DAY)]);
  const first = await scheduler.tick({ service: stub, alerts: alertsStub, queryable: db, now: () => now });
  assert.deepEqual(calls, ['m1', 'm2', 'm3'], 'one failing mail check never stops the others');
  assert.equal(first.mail_checked, 2);
  // the registry breaker is open now; mail checks and alerts keep running
  calls.length = 0;
  let alertPasses = 0;
  const paused = await scheduler.tick({ service: stub, alerts: { processDue: async () => { alertPasses += 1; } }, queryable: db, now: () => now + 11 * 60000 });
  assert.equal(paused.skipped, 'paused');
  assert.deepEqual(calls, ['m1', 'm2', 'm3'], 'a throttled registry never stalls the DNS checks');
  assert.equal(alertPasses, 1, 'nor the alerts');
  scheduler.resetSchedulerState();
  const brokenClaim = await scheduler.tick({ service: { ...stub, claimMailBatch: async () => { throw new Error('db'); }, checkDomain: async () => ({ snapshot: {} }) }, alerts: alertsStub, queryable: db, now: () => now });
  assert.ok(brokenClaim.claimed >= 0, 'a failed claim does not stop the registry lookups');
  scheduler.resetSchedulerState();
  await modules.setModuleEnabled('domain_manager', false, adminId);
  assert.deepEqual(await scheduler.tick({ service: stub, alerts: alertsStub, queryable: db, now: () => now }), { skipped: 'module_off' });

  // ---------- routes ----------
  const router = require('../src/routes/domainManagerRoutes');
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.ok(routes.includes('GET /domains/:id/mail-settings') && routes.includes('PUT /domains/:id/mail-settings'));
  const gate = router.stack.findIndex((layer, index) => index > 1 && !layer.route);
  const position = (method, route) => router.stack.findIndex((layer) => layer.route && layer.route.path === route && layer.route.methods[method]);
  assert.ok(position('get', '/domains/:id/mail-settings') > gate && position('put', '/domains/:id/mail-settings') > gate, 'per-domain selectors are Super Admin only');

  console.log('domain manager mail tests passed');
}

run_().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
