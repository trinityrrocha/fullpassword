import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dm from '../src/utils/domainManager.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

assert.deepEqual(dm.parseDomainList('A.com, b.com;\nb.com  C.COM\n\n'), ['a.com', 'b.com', 'c.com']);
assert.deepEqual(dm.parseDomainList(''), []);
assert.deepEqual(dm.parseDomainList(null), []);

const expiry = (days) => dm.expiryInfo({ expires_on: '2027-03-05', days_left: days });
assert.deepEqual(expiry(120), { text: '05/03/27', note: 'em 120 dias', tone: 'ok' });
assert.equal(expiry(30).tone, 'warning');
assert.equal(expiry(1).note, 'em 1 dia');
assert.deepEqual([expiry(0).note, expiry(0).tone], ['vence hoje', 'danger']);
assert.deepEqual([expiry(-3).note, expiry(-3).tone], ['venceu há 3 dias', 'danger']);
assert.deepEqual(dm.expiryInfo(null), { text: '—', note: '', tone: 'muted' });
assert.equal(dm.expiryInfo({ expires_on: null }).note, 'sem data');

assert.equal(dm.lookupLabel(null), 'Aguardando consulta');
assert.equal(dm.lookupLabel({ lookup_status: 'not_found' }), 'Não registrado');
assert.equal(dm.errorLabel('RATE_LIMITED').includes('limitou'), true);
assert.equal(dm.errorLabel(''), '');
assert.equal(dm.sslLabel('none'), 'Sem HTTPS');
assert.equal(dm.sslLabel(undefined), '—');
assert.equal(dm.changeValue('expires_on', '2027-05-01'), '01/05/27');
assert.equal(dm.changeValue('dnssec', 'true'), 'ativo');
assert.equal(dm.changeValue('nameservers', null), '—');
assert.equal(dm.dnssecLabel(null), '—');

assert.equal(dm.alertsLabel({ enabled: false, emails: 3, notify_admins: true }), '');
assert.equal(dm.alertsLabel({ enabled: true, emails: 1, notify_admins: false }), 'Alertas ativos (1 e-mail)');
assert.equal(dm.alertsLabel({ enabled: true, emails: 2, notify_admins: true }), 'Alertas ativos (2 e-mails + administradores)');
assert.equal(dm.alertsLabel({ enabled: true, emails: 0, notify_admins: true }), 'Alertas ativos (administradores)');
assert.equal(dm.alertsLabel(null), '');
assert.deepEqual(['a@b.co', ' a@b.co ', 'a@b', 'a b@c.com', '', null].map(dm.isValidEmail), [true, true, false, false, false, false]);
assert.equal(dm.canSaveAlerts({ enabled: false, notify_admins: false, emails: [] }), true);
assert.equal(dm.canSaveAlerts({ enabled: true, notify_admins: false, emails: [] }), false);
assert.equal(dm.canSaveAlerts({ enabled: true, notify_admins: true, emails: [] }), true);
assert.equal(dm.canSaveAlerts({ enabled: true, notify_admins: false, emails: ['a@b.co'] }), true);

assert.equal(dm.MAX_DOMAINS_PER_USER, 100);
assert.deepEqual(dm.EMPTY_DM_ACCESS, { loaded: false, had: false, enabled: false, domainIds: [], domains: [], dirty: false, error: '' });
assert.equal(dm.canSaveDmAccess({ enabled: false, domainIds: [] }), true, 'access off: nothing to validate');
assert.equal(dm.canSaveDmAccess({ enabled: true, domainIds: [] }), false);
assert.equal(dm.canSaveDmAccess({ enabled: true, domainIds: ['a'] }), true);
assert.equal(dm.canSaveDmAccess({ enabled: true, domainIds: Array.from({ length: 101 }, (_, i) => String(i)) }), false);
assert.equal(dm.canSaveDmAccess({ enabled: true, domainIds: Array.from({ length: 100 }, (_, i) => String(i)) }), true);

// ---- SPF, DKIM and DMARC markers: a glyph AND words, never only a colour ----
const mail = { spf: { status: 'ok', all: '-all' }, dmarc: { status: 'warning', policy: 'none' }, dkim: { status: 'not_found', found: 0 } };
assert.deepEqual(dm.mailMarker('spf', mail), { label: 'SPF', mark: '✓', status: 'Válido', text: '-all', tone: 'ok', title: 'SPF: Válido (-all)' });
assert.equal(dm.mailMarker('dmarc', mail).status, 'Aviso', 'every marker carries the spoken status, so p=none is not read like reject');
assert.equal(dm.mailMarker('dmarc', { dmarc: { status: 'ok', policy: 'reject' } }).status, 'Válido');
assert.equal(dm.mailMarker('spf', { spf: { status: 'fail', all: '+all' } }).status, 'Falha');
assert.equal(dm.mailMarker('spf', null).status, 'Não verificado');
assert.deepEqual([dm.mailMarker('dmarc', mail).text, dm.mailMarker('dmarc', mail).tone, dm.mailMarker('dmarc', mail).mark], ['p=none', 'warning', '⚠']);
assert.deepEqual([dm.mailMarker('dkim', mail).text, dm.mailMarker('dkim', mail).mark], ['não encontrado', '?']);
assert.equal(dm.mailMarker('dkim', { dkim: { status: 'ok', found: 1 } }).text, '1 seletor');
assert.equal(dm.mailMarker('dkim', { dkim: { status: 'ok', found: 3 } }).text, '3 seletores');
assert.deepEqual([dm.mailMarker('spf', { spf: { status: 'fail' } }).text, dm.mailMarker('spf', { spf: { status: 'fail' } }).tone], ['falha', 'danger']);
assert.equal(dm.mailMarker('dmarc', { dmarc: { status: 'absent' } }).text, 'ausente');
assert.equal(dm.mailMarker('spf', { spf: { status: 'inconclusive' } }).text, 'sem resposta');
assert.equal(dm.mailMarker('dmarc', { dmarc: { status: 'ok', policy: 'reject' } }).text, 'reject');
assert.deepEqual([dm.mailMarker('spf', null).text, dm.mailMarker('spf', null).mark], ['não verificado', '·']);
assert.equal(dm.mailStatusLabel('not_found'), 'Não encontrado');
assert.equal(dm.mailStatusLabel('nope'), '—');
assert.deepEqual(dm.mailMessages({ errors: ['SPF_ALL_PLUS'], warnings: ['SPF_PTR'], notes: ['SPF_SOFTFAIL'] }).length, 3);
assert.equal(dm.mailCodeLabel('UNKNOWN_CODE'), 'UNKNOWN_CODE', 'an unknown code is shown as is, never hidden');
assert.deepEqual(dm.mailMessages(null), []);
for (const code of ['SPF_MULTIPLE', 'SPF_TOO_MANY_LOOKUPS', 'DMARC_POLICY_NONE', 'DKIM_WILDCARD', 'DKIM_WEAK_KEY']) assert.notEqual(dm.mailCodeLabel(code), code, `${code} has a Portuguese message`);
assert.equal(dm.fieldLabel('dmarc_policy'), 'Política DMARC');
assert.equal(dm.changeValue('dmarc_status', 'warning'), 'Aviso');
assert.equal(dm.changeValue('spf_record', 'v=spf1 -all'), 'v=spf1 -all');
// selector and server lists
assert.deepEqual(dm.parseSelectorList('Default, google\nGOOGLE;k1'), ['default', 'google', 'k1']);
assert.equal(dm.selectorProblems(['default', 'k1'], 20), '');
assert.match(dm.selectorProblems(['ok', 'bad$name'], 20), /Seletor inválido: "bad\$name"/);
assert.match(dm.selectorProblems(Array.from({ length: 21 }, (_, i) => `s${i}x`), 20), /no máximo 20/);
assert.equal(dm.isValidSelector('a'), true);
assert.equal(dm.isValidSelector('-a'), false);
assert.equal(dm.isValidSelector('a'.repeat(63)), true);
assert.equal(dm.isValidSelector('a'.repeat(64)), false);
for (const bad of ['a..b', 'a.', '.a', 'a b', '', `${'a'.repeat(50)}.${'b'.repeat(50)}`]) assert.equal(dm.isValidSelector(bad), false, bad);
for (const good of ['s1.2024', 'a_b', 'k-1']) assert.equal(dm.isValidSelector(good), true, good);
assert.deepEqual(dm.parseServerList('10.0.0.9, 1.1.1.1\n10.0.0.9'), ['10.0.0.9', '1.1.1.1']);
assert.equal(dm.serverProblems(['10.0.0.9', '2606:4700:4700::1111']), '');
for (const bad of ['dns.google', '1.1.1.1:53', '999.1.1.1', 'a:b:z']) assert.match(dm.serverProblems([bad]), /Endereço IP inválido/, bad);
assert.match(dm.serverProblems(['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5']), /no máximo 4/);
assert.equal(dm.DKIM_SELECTOR_LIMIT, 60);
assert.equal(dm.DOMAIN_SELECTOR_LIMIT, 20);

// Wiring: route, menu entry (module-gated) and the module card link exist.
assert.match(read('src/App.jsx'), /path="\/domains" element=\{<DomainManager \/>\}/);
assert.match(read('src/layouts/DashboardLayout.jsx'), /modules\.domain_manager === true/);
assert.match(read('src/components/ModulesCard.jsx'), /domain_manager: \{ href: '\/domains'/);
assert.match(read('src/pages/DomainManager.jsx'), /SearchAlert/);
assert.match(read('src/pages/DomainManager.jsx'), /<Settings2 className="h-5 w-5"/, 'the settings card opens from an icon in the header');
assert.match(read('src/pages/DomainManager.jsx'), /data-mail-cell/, 'the list shows the e-mail markers');
assert.match(read('src/pages/DomainManager.jsx'), /const isAdmin = data\.role === 'super_admin'/, 'administration controls depend on the role the server reports');
assert.match(read('src/pages/TeamList.jsx'), /DomainManagerUserAccess/, 'the user dialog has the Domain Manager tab');
assert.match(read('src/pages/DomainManager.jsx'), /<Settings className="h-5 w-5"/, 'the per-domain gear is the lucide Settings icon');
console.log('domain manager frontend tests passed');

// ---------- record generators ----------
const gen = await import('../src/utils/recordGenerators.js');
assert.equal(gen.buildDmarc({}).record, 'v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s');
assert.equal(gen.buildDmarc({ policy: 'none', subPolicy: 'same', adkim: 'r', aspf: 'r' }).record, 'v=DMARC1; p=none');
assert.equal(gen.buildDmarc({ policy: 'quarantine', subPolicy: 'none', adkim: 'r', aspf: 'r', pct: '25', rua: 'a@x.com, mailto:b@x.com', ruf: 'f@x.com', fo: '1', ri: '3600' }).record,
  'v=DMARC1; p=quarantine; sp=none; pct=25; rua=mailto:a@x.com,mailto:b@x.com; ruf=mailto:f@x.com; fo=1; ri=3600');
assert.equal(gen.buildDmarc({ rua: 'ruim' }).valid, false);
assert.equal(gen.buildDmarc({ rua: 'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com' }).valid, false, 'at most 5 report addresses');
assert.equal(gen.buildDmarc({ pct: '0' }).valid, false); assert.equal(gen.buildDmarc({ pct: '101' }).valid, false); assert.equal(gen.buildDmarc({ ri: '10' }).valid, false);
assert.ok(gen.buildDmarc({ policy: 'none' }).warnings.some((w) => /apenas monitora/.test(w)));
assert.equal(gen.buildSpf({}).record, 'v=spf1 mx -all');
assert.equal(gen.buildSpf({ mx: false, a: true, ips: '203.0.113.5 198.51.100.0/24 2001:db8::/32', providers: ['google', 'ses'], includes: 'include:_SPF.x.com', all: '~all' }).record,
  'v=spf1 a ip4:203.0.113.5 ip4:198.51.100.0/24 ip6:2001:db8::/32 include:_spf.google.com include:amazonses.com include:_spf.x.com ~all');
assert.ok(gen.buildSpf({ all: '~all' }).warnings.some((w) => /Recomendamos -all/.test(w)));
assert.ok(gen.buildSpf({ all: '?all' }).warnings.some((w) => /Recomendamos -all/.test(w)));
for (const bad of ['300.1.1.1', '1.2.3.4/33', '1.2.3', 'zzz', '2001:::1', '2001:db8::/129']) assert.equal(gen.buildSpf({ ips: bad }).valid, false, bad);
assert.equal(gen.buildSpf({ includes: 'not a host' }).valid, false);
assert.equal(gen.buildSpf({ mx: false }).warnings.some((w) => /Nenhum servidor autorizado/.test(w)), true);
const heavy = gen.buildSpf({ a: true, providers: gen.SPF_PROVIDERS.map((p) => p.id), includes: 'a.example.com b.example.com c.example.com' });
assert.equal(heavy.lookups, 12); assert.equal(heavy.valid, false, 'more than 10 DNS lookups is refused');
assert.equal(gen.buildSpf({ mx: false, a: false, providers: ['google'], includes: '_spf.google.com' }).lookups, 1, 'a repeated include counts once');
console.log('record generator tests passed');
