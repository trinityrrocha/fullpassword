const assert = require('node:assert/strict');
Object.assign(process.env, {
  DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'TEST_ONLY_PASSWORD', DB_NAME: 'test',
  JWT_SECRET: 'TEST_ONLY_JWT_'.repeat(8), ADMIN_BOOTSTRAP_TOKEN: 'TEST_BOOTSTRAP_'.repeat(6),
  APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid', NODE_ENV: 'production', BACKEND_APP_COMMIT: 'a'.repeat(40)
});
const sent = require('../src/services/spfblSentService');
const { WhmClient, WhmError } = require('../src/services/spfblWhmClient');

// All data below is invented. The record shape follows the cPanel API documentation and a real answer's structure.
const NOW = Date.parse('2026-11-27T12:00:00Z');
const sec = (offsetMinutes) => Math.floor(NOW / 1000) - offsetMinutes * 60;
const record = (extra = {}) => ({
  actiontime: '2026-11-27 11:00:00', actionunixtime: String(sec(60)), deliveredto: 'cliente@destino.example', deliverydomain: '', deliveryuser: '-remote-', domain: 'exemplo.test',
  email: 'financeiro@exemplo.test', host: 'mx.destino.example', ip: '203.0.113.10', message: 'Accepted', msgid: '1aaaaa-000000000AAA-1a11', recipient: 'cliente@destino.example',
  router: 'dkim_lookuphost', sender: 'financeiro@exemplo.test', senderauth: 'dovecot_plain', senderhost: 'pc.exemplo.test', senderip: '198.51.100.7', sendunixtime: String(sec(61)),
  size: 1234, spamscore: '', transport: 'dkim_remote_smtp', transport_is_remote: 1, type: 'success', user: 'exemplo01', ...extra
});

async function run() {
  // ---------- classification: short texts, the first matching rule wins ----------
  const c = (type, message) => sent.classifyResult(type, message);
  assert.deepEqual([c('success', 'Accepted').label, c('success', 'Accepted').key], ['Enviado', 'sent']);
  assert.equal(c('inprogress', '').label, 'Em andamento');
  assert.deepEqual([c('failure', '550 5.1.1 The email account that you tried to reach does not exist.').label, c('failure', '550 5.1.1 The email account that you tried to reach does not exist.').code], ['Destinatário inexistente', '550 5.1.1']);
  assert.equal(c('failure', 'RCPT TO:<x@y.example> User unknown').key, 'mailbox_not_found');
  assert.equal(c('failure', '552 5.2.2 Mailbox full').label, 'Caixa cheia');
  assert.equal(c('defer', '452 4.2.2 Over quota').label, 'Adiado: caixa cheia', 'a deferral keeps the cause but says it is only postponed');
  assert.equal(c('failure', 'Domain exemplo.test has exceeded the max defers and failures per hour (5/5 (100%)) allowed. Message discarded.').label, 'Limite de envios excedido');
  assert.equal(c('failure', '550 5.7.1 Message rejected as spam, listed in Spamhaus').label, 'Bloqueado como spam');
  assert.equal(c('defer', 'Connection timed out').label, 'Adiado: servidor de destino sem resposta');
  assert.equal(c('failure', 'Host or domain name not found. Name service error for name=destino.example').label, 'Domínio inexistente');
  assert.equal(c('defer', '451 4.7.1 Greylisted, please try again later').label, 'Adiado pelo destino (tentará de novo)');
  assert.equal(c('failure', 'TLS error: certificate verify failed').label, 'Falha de TLS');
  assert.equal(c('failure', '552 5.3.4 Message size exceeds fixed limit').label, 'Mensagem grande demais');
  assert.deepEqual([c('failure', '554 something odd').label, c('failure', '554 something odd').code], ['Falha na entrega (554)', '554']);
  assert.equal(c('failure', 'odd').label, 'Falha na entrega'); assert.equal(c('defer', 'odd').label, 'Adiado');
  assert.equal(c('failure', undefined).label, 'Falha na entrega');

  // ---------- normalization ----------
  const ok = sent.normalizeRecord(record());
  assert.deepEqual([ok.type, ok.event, ok.sender, ok.recipient, ok.result.label, ok.sent_at], ['success', 'Entrega', 'financeiro@exemplo.test', 'cliente@destino.example', 'Enviado', new Date(sec(61) * 1000).toISOString()]);
  assert.equal(sent.normalizeRecord(record({ email: 'root@srv.example', sender: 'root' })).sender, 'root@srv.example', 'the address comes from "email" when "sender" is just a local user');
  assert.equal(sent.normalizeRecord(record({ email: '', sender: 'root' })).sender, 'root');
  assert.equal(sent.normalizeRecord(record({ type: 'rejected' })), null, 'mail refused on arrival is not mail sent');
  assert.equal(sent.normalizeRecord(record({ sendunixtime: '', actionunixtime: '' })), null); assert.equal(sent.normalizeRecord(null), null);
  assert.equal(sent.normalizeRecord(record({ sendunixtime: sec(61) })).sent_unix, sec(61), 'numbers and strings both work');
  assert.equal(sent.normalizeRecord(record({ spamscore: '' })).detail.spamscore, undefined, 'empty values are not shown');
  assert.equal(sent.normalizeRecord({ ...record(), injected: 'x', password: 'y' }).detail.injected, undefined, 'unknown fields are dropped');
  assert.equal(sent.normalizeRecord(record({ message: 'x'.repeat(5000) })).detail.message.length, 600, 'long text is bounded');
  assert.ok(Object.keys(ok.detail).includes('msgid') && ok.detail.message === 'Accepted' && ok.detail.size === '1234');

  // ---------- filters ----------
  assert.deepEqual(sent.parseFilters({}), { period: '24h', seconds: 86400, status: 'all', by: 'any', q: '' });
  assert.equal(sent.parseFilters({ period: '7d', status: 'failed', by: 'sender', q: '  Fulano@X.com ' }).q, 'fulano@x.com');
  for (const bad of [{ period: '1y' }, { status: 'nope' }, { by: 'x' }, { q: 'a'.repeat(101) }]) assert.throws(() => sent.parseFilters(bad), { name: 'SentError' }, JSON.stringify(bad).slice(0, 30));
  assert.equal(sent.parsePageSize(undefined), 20); assert.equal(sent.parsePageSize('100'), 100); assert.throws(() => sent.parsePageSize('7'), { code: 'SPFBL_FILTER_PAGE_SIZE' });

  // ---------- the service, one domain: scope check on the sender domain, cache, de-duplication, paging ----------
  let calls = 0; let clock = NOW; let answer = []; let truncatedAnswer = false;
  const seen = [];
  const service = sent.createService({
    credentialsFor: async (id) => ({ id }), serverIdOf: async (domain) => (domain === 'semservidor.test' ? null : 'srv-1'), now: () => clock,
    createClient: () => ({ emailTrack: async (args) => { calls += 1; seen.push(args); return { records: answer, truncated: truncatedAnswer }; } })
  });
  const mk = (n, extra) => record({ msgid: `m${n}`, sendunixtime: String(sec(n)), actionunixtime: String(sec(n)), recipient: `dest${n}@destino.example`, ...extra });
  answer = [mk(5), mk(10, { type: 'failure', message: '550 5.1.1 User unknown' }), mk(20, { type: 'defer', message: '452 4.2.2 over quota' }),
    mk(30, { domain: 'outro.test', email: 'x@outro.test', sender: 'x@outro.test' }), mk(40, { type: 'rejected' }), mk(2000, {}), mk(50, { sender: 'vendas@exemplo.test', email: 'vendas@exemplo.test' })];
  const first = await service.search({ domain: 'exemplo.test', query: {} });
  assert.equal(calls, 1);
  assert.deepEqual(first.rows.map((r) => r.detail.msgid), ['m5', 'm10', 'm20', 'm50'], 'newest first; other domains, refused-on-arrival and out-of-period records are dropped');
  assert.deepEqual([first.filtered_total, first.period_total, first.page, first.pages, first.truncated, first.cached, first.servers_failed], [4, 4, 1, 1, false, false, 0]);
  assert.deepEqual([seen[0].domain, seen[0].maxPerKind, seen[0].untilUnix > seen[0].sinceUnix, (seen[0].untilUnix - seen[0].sinceUnix) >= 86400], ['exemplo.test', sent.MAX_PER_KIND, true, true], 'the server is asked for this domain and this period');
  const failed = await service.search({ domain: 'exemplo.test', query: { status: 'failed' } });
  assert.deepEqual([failed.rows.map((r) => r.result.label), failed.cached, calls], [['Destinatário inexistente'], true, 1], 'changing a filter does not call the server again');
  assert.equal((await service.search({ domain: 'exemplo.test', query: { status: 'deferred' } })).rows[0].result.label, 'Adiado: caixa cheia');
  assert.equal((await service.search({ domain: 'exemplo.test', query: { status: 'sent' } })).rows.length, 2);
  assert.deepEqual((await service.search({ domain: 'exemplo.test', query: { q: 'VENDAS', by: 'sender' } })).rows.map((r) => r.detail.msgid), ['m50']);
  assert.equal((await service.search({ domain: 'exemplo.test', query: { q: 'dest10', by: 'recipient' } })).rows.length, 1);
  assert.equal((await service.search({ domain: 'exemplo.test', query: { q: 'dest10', by: 'sender' } })).rows.length, 0);
  assert.equal((await service.search({ domain: 'exemplo.test', query: { q: 'destino.example' } })).rows.length, 4, 'any: sender or recipient');
  clock += 61 * 1000; await service.search({ domain: 'exemplo.test', query: {} }); assert.equal(calls, 2, 'the answer is reused for a minute only');
  const [one, two] = await Promise.all([service.search({ domain: 'exemplo.test', query: { period: '7d' } }), service.search({ domain: 'exemplo.test', query: { period: '7d', status: 'sent' } })]);
  assert.equal(calls, 3, 'simultaneous requests for the same period share one server call'); assert.ok(one.rows.length >= two.rows.length);
  await assert.rejects(service.search({ domain: 'semservidor.test', query: {} }), { code: 'SPFBL_SENT_NO_SERVER', statusCode: 409 });
  await assert.rejects(service.search({ domain: 'exemplo.test', query: { period: 'x' } }), { code: 'SPFBL_SENT_PERIOD' });

  // failures and deferrals: they can come with an empty "domain" and the sender only in "email"; they are matched by the sender's address
  answer = [mk(5), mk(6, { type: 'failure', domain: '', email: 'ana@exemplo.test', sender: '', message: '550 5.1.1 User unknown', transport: '', transport_is_remote: 0, router: 'dnslookup' }),
    mk(7, { type: 'defer', domain: '', email: 'Vendas@EXEMPLO.test', sender: '', message: '452 4.2.2 over quota' }),
    mk(8, { type: 'failure', domain: '', email: 'x@outro.test', sender: '' }), mk(9, { type: 'failure', domain: '-system-', email: 'root@srv.outro.test', sender: 'root' }),
    mk(11, { type: 'rejected', domain: '', email: 'spam@fora.example' }), mk(12, { type: 'failure', domain: '', email: '', sender: '' })];
  clock += 61 * 1000;
  const withFailures = await service.search({ domain: 'exemplo.test', query: {}, diagnostics: true });
  assert.deepEqual(withFailures.rows.map((r) => [r.detail.msgid, r.result.label]), [['m5', 'Enviado'], ['m6', 'Destinatário inexistente'], ['m7', 'Adiado: caixa cheia']], 'failed and deferred mail with an empty "domain" is listed');
  assert.deepEqual(withFailures.diagnostics, { returned: { success: 1, failure: 4, defer: 1, rejected: 1 }, other_type: 1, other_domain: 3, out_of_period: 0, calls: [], sources: { 'exemplo.test': 3, 'outro.test': 1, 'srv.outro.test': 1, 'fora.example': 1, '(sistema)': 1 } }, 'the Super Admin sees what was returned, from which domains, and why records were left out');
  assert.equal(JSON.stringify(withFailures.diagnostics).includes('@'), false, 'diagnostics carry counts only, never addresses');
  clock += 61 * 1000; assert.equal('diagnostics' in (await service.search({ domain: 'exemplo.test', query: {} })), false, 'no diagnostics unless asked');
  answer = [mk(2500, { type: 'defer', sendunixtime: String(sec(60 * 24 * 3)), actionunixtime: String(sec(5)) }), mk(2600, { sendunixtime: String(sec(60 * 24 * 3)), actionunixtime: String(sec(60 * 24 * 3)) })]; clock += 61 * 1000;
  assert.deepEqual((await service.search({ domain: 'exemplo.test', query: {} })).rows.map((r) => r.detail.msgid), ['m2500'], 'a message sent days ago and retried in the period still counts; one entirely outside does not');
  // paging
  answer = Array.from({ length: 45 }, (_, i) => mk(i + 1, { msgid: `p${i + 1}` })); clock += 61 * 1000;
  const page2 = await service.search({ domain: 'exemplo.test', query: { page: '2', page_size: '20' } });
  assert.deepEqual([page2.page, page2.pages, page2.rows.length, page2.filtered_total, page2.rows[0].detail.msgid], [2, 3, 20, 45, 'p21']);
  assert.equal((await service.search({ domain: 'exemplo.test', query: { page: '99' } })).page, 3, 'a page past the end lands on the last one');
  // truncation is the client's word: it stopped at its cap
  truncatedAnswer = true; clock += 61 * 1000;
  assert.equal((await service.search({ domain: 'exemplo.test', query: { period: '30d' } })).truncated, true, 'a read that reached the cap is flagged');
  truncatedAnswer = false;
  // a server that ignores the filter cannot leak other domains' mail
  answer = [mk(5, { domain: 'outro.test', email: 'a@outro.test', sender: 'a@outro.test', msgid: 'leak' })]; clock += 61 * 1000;
  assert.equal((await service.search({ domain: 'exemplo.test', query: {} })).rows.length, 0);

  // ---------- all domains ("todos os domínios"): every server, scope for ordinary accounts ----------
  const byServer = { 'srv-1': [], 'srv-2': [], 'srv-3': [] };
  const asked = [];
  let failing = new Set();
  const multi = sent.createService({
    credentialsFor: async (id) => ({ id }), serverIdOf: async () => 'srv-1', now: () => clock,
    allServers: async () => [{ id: 'srv-1', name: 'Servidor A' }, { id: 'srv-2', name: 'Servidor B' }, { id: 'srv-3', name: 'Servidor C' }],
    serverIdsOf: async (names) => new Set(names.includes('b.test') ? ['srv-2'] : ['srv-1']),
    createClient: (credentials) => ({ emailTrack: async (args) => { asked.push([credentials.id, args.domain]); if (failing.has(credentials.id)) throw Object.assign(new Error('x'), { code: 'WHM_AUTH_REFUSED' }); return { records: byServer[credentials.id], truncated: false }; } })
  });
  const rec = (n, domain, extra = {}) => mk(n, { domain, email: `u${n}@${domain}`, sender: `u${n}@${domain}`, msgid: `${domain}-${n}`, ...extra });
  byServer['srv-1'] = [rec(5, 'a.test'), rec(6, 'a.test', { type: 'failure', domain: '', message: '550 5.1.1 User unknown' }), rec(7, 'outro.test'), mk(8, { type: 'success', domain: '-system-', email: 'root@srv.example.test', sender: 'root', msgid: 'sys-8' })];
  byServer['srv-2'] = [rec(9, 'b.test'), rec(10, 'a.test'), rec(5, 'a.test')];
  byServer['srv-3'] = [rec(11, 'c.test')];
  clock += 61 * 1000;
  const everything = await multi.search({ domain: sent.ALL, scope: ['a.test', 'b.test'], admin: true, query: { page_size: '100' }, diagnostics: true });
  assert.deepEqual(asked.map((a) => a[0]).sort(), ['srv-1', 'srv-2', 'srv-3'], 'the Super Admin reads every registered server');
  assert.ok(asked.every((a) => a[1] === null), 'all domains: no domain filter in the request');
  assert.deepEqual(everything.rows.map((r) => r.detail.msgid).sort(), ['a.test-10', 'a.test-5', 'a.test-6', 'b.test-9', 'c.test-11', 'outro.test-7', 'sys-8'].sort(), 'the Super Admin gets every domain, system mail and domains outside the list included, without duplicates');
  assert.equal(everything.rows.find((r) => r.detail.msgid === 'a.test-6').result.label, 'Destinatário inexistente');
  assert.deepEqual(everything.rows.map((r) => r.server).filter(Boolean).sort().slice(0, 1), ['Servidor A'], 'each row names its server');
  assert.deepEqual([everything.servers_failed, everything.servers_failed_names, everything.diagnostics.returned.success + everything.diagnostics.returned.failure], [0, [], 8]);
  asked.length = 0; clock += 61 * 1000;
  const mine = await multi.search({ domain: sent.ALL, scope: ['a.test', 'b.test'], admin: false, query: { page_size: '100' } });
  assert.deepEqual(asked.map((a) => a[0]).sort(), ['srv-2'], 'an ordinary account reads only the servers of its domains');
  assert.deepEqual(mine.rows.map((r) => r.detail.msgid).sort(), ['a.test-10', 'a.test-5', 'b.test-9'], 'and keeps only the domains of its scope');
  assert.equal('servers_failed_names' in mine, false, 'server names are for the Super Admin');
  clock += 61 * 1000; failing = new Set(['srv-2']);
  const partial = await multi.search({ domain: sent.ALL, scope: [], admin: true, query: { page_size: '100' } });
  assert.deepEqual([partial.servers_failed, partial.servers_failed_names, partial.rows.length], [1, [{ name: 'Servidor B', code: 'WHM_AUTH_REFUSED' }], 5], 'a server that fails does not hide the others, and is named');
  clock += 61 * 1000; failing = new Set(['srv-1', 'srv-2', 'srv-3']);
  await assert.rejects(multi.search({ domain: sent.ALL, scope: [], admin: true, query: {} }), { code: 'WHM_AUTH_REFUSED' }, 'when no server answers, the reason is reported, not an empty list');
  failing = new Set();
  const noServer = sent.createService({ credentialsFor: async () => ({}), serverIdOf: async () => null, allServers: async () => [], serverIdsOf: async () => new Set(), createClient: () => ({}) });
  await assert.rejects(noServer.search({ domain: sent.ALL, scope: ['a.test'], admin: false, query: {} }), { code: 'SPFBL_SENT_NO_SERVER' });
  await assert.rejects(noServer.search({ domain: sent.ALL, scope: [], admin: true, query: {} }), { code: 'SPFBL_SENT_NO_SERVER' });

  // ---------- the WHM client: one more allow-listed function, unlimited and chunked, with validated parameters ----------
  const paths = [];
  const fixtures = { delivered: Array.from({ length: 1200 }, (_, i) => record({ msgid: `d${i}` })), problems: Array.from({ length: 30 }, (_, i) => record({ msgid: `f${i}`, type: 'failure', domain: '' })) };
  const transport = async (call) => {
    paths.push(call.path);
    const query = new URLSearchParams(call.path.split('?')[1]);
    const rows = fixtures[query.get('success') === '1' ? 'delivered' : 'problems'];
    const start = Number(query.get('api.chunk.start')); const size = Number(query.get('api.chunk.size'));
    return { status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: { records: rows.slice(start - 1, start - 1 + size) } }) };
  };
  const whm = (overrides = {}, options = {}) => new WhmClient({ host: 'srv.example.com', user: 'root', token: 'TOKENSENTINEL0123456789ABCDEF', ...overrides }, { transport, resolver: async () => ['93.184.216.7'], ...options });
  const read = await whm().emailTrack({ domain: 'exemplo.test', sinceUnix: 1000, untilUnix: 2000 });
  assert.deepEqual([read.records.length, read.truncated], [1230, false], 'every record is read, in chunks, for both kinds of call');
  assert.equal(paths.length, 4, '1200 delivered = 3 chunks (500, 500, 200), 30 problems = 1');
  const [d1, d2, d3, p1] = paths;
  assert.ok(d1.startsWith('/json-api/emailtrack_search?api.version=1&success=1&defer=0&failure=0&inprogress=1&deliverytype=remote&max_results_by_type=0'), 'delivered: remote only, and NO limit of results (it would be applied before the filters)');
  assert.ok(d1.includes('api.filter.a.field=domain&api.filter.a.arg0=exemplo.test&api.filter.a.type=eq') && d1.includes('api.filter.b.field=sendunixtime&api.filter.b.arg0=1000&api.filter.b.type=gt') && d1.includes('api.filter.c.field=sendunixtime&api.filter.c.arg0=2000&api.filter.c.type=lt'));
  assert.ok(d1.includes('api.sort.enable=1&api.sort.a.field=sendunixtime&api.sort.a.method=numeric&api.sort.a.reverse=1'), 'newest first');
  assert.deepEqual([d1, d2, d3].map((path) => /api\.chunk\.start=(\d+)/.exec(path)[1]), ['1', '501', '1001']); assert.ok(d1.includes('api.chunk.size=500'));
  assert.ok(p1.startsWith('/json-api/emailtrack_search?api.version=1&success=0&defer=1&failure=1&inprogress=0&deliverytype=all&max_results_by_type=0'), 'deferred and failed: not limited to remote transports, no limit of results');
  assert.ok(!p1.includes('field=domain'), 'deferred and failed are not filtered by the domain field (it can be empty on them)');
  assert.ok(p1.includes('api.filter.b.field=actionunixtime&api.filter.b.arg0=1000&api.filter.b.type=gt') && p1.includes('api.sort.a.field=actionunixtime'), 'they are filtered and ordered by the attempt');
  assert.ok(!JSON.stringify(paths).includes('SENTINEL'), 'the token never reaches the URL');
  paths.length = 0;
  const allDomains = await whm().emailTrack({ domain: null, sinceUnix: 1000, untilUnix: 2000 });
  assert.equal(allDomains.records.length, 1230); assert.ok(!paths[0].includes('field=domain'), 'all domains: no domain filter');
  paths.length = 0; fixtures.delivered = Array.from({ length: 9000 }, (_, i) => record({ msgid: `d${i}` }));
  const capped = await whm().emailTrack({ domain: null, sinceUnix: 1000, untilUnix: 2000, maxPerKind: 1000 });
  assert.deepEqual([capped.records.length, capped.truncated], [1030, true], 'a read stops at its cap and says so');
  fixtures.delivered = Array.from({ length: 500 }, (_, i) => record({ msgid: `d${i}` })); paths.length = 0;
  assert.equal((await whm().emailTrack({ domain: 'exemplo.test', sinceUnix: 1000, untilUnix: 2000 })).records.length, 530, 'a read ending exactly on a chunk asks once more and finds it empty');
  for (const bad of [{ domain: 'a b', sinceUnix: 1, untilUnix: 2 }, { domain: 'exemplo.test;x=1', sinceUnix: 1, untilUnix: 2 }, { domain: 'exemplo.test', sinceUnix: 5, untilUnix: 2 },
    { domain: 'exemplo.test', sinceUnix: 'x', untilUnix: 2 }, { domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2, maxPerKind: 10 }, { domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2, maxPerKind: 99999 }, { domain: 'exemplo.test&api.version=2', sinceUnix: 1, untilUnix: 2 }]) {
    paths.length = 0;
    await assert.rejects(whm().emailTrack(bad), WhmError, JSON.stringify(bad));
    assert.equal(paths.length, 0, 'an invalid request never reaches the server');
  }
  const noRecords = whm({}, { transport: async () => ({ status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: {} }) }) });
  await assert.rejects(noRecords.emailTrack({ domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2 }), { code: 'WHM_FORMAT' });
  await assert.rejects(whm().call('addpkg'), { code: 'WHM_FUNCTION_FORBIDDEN' });
  const refused = whm({}, { transport: async () => ({ status: 403, body: '{}' }) });
  await assert.rejects(refused.emailTrack({ domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2 }), (error) => error.code === 'WHM_AUTH_REFUSED' && /emailtrack_search/.test(error.message), 'a token without permission is named');
  // a long chunked read gets a fresh time limit per call, but not an unlimited one
  let tick = 0; const slow = whm({}, { now: () => { tick += 30000; return tick; }, transport });
  await assert.rejects(slow.emailTrack({ domain: null, sinceUnix: 1, untilUnix: 2 }), { code: 'WHM_TIMEOUT' }, 'the whole read has a ceiling');
  // one kind failing keeps what the other returned and says so; both failing reports the reason
  const half = (failKind) => whm({}, { transport: async (call) => {
    const isProblems = new URLSearchParams(call.path.split('?')[1]).get('success') === '0';
    if ((failKind === 'problems' && isProblems) || (failKind === 'delivered' && !isProblems) || failKind === 'both') return { status: 502, body: '{}' };
    return { status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: { records: [record({ msgid: isProblems ? 'p' : 'd' })] } }) };
  } });
  const onlyDelivered = await half('problems').emailTrack({ domain: null, sinceUnix: 1, untilUnix: 2 });
  assert.deepEqual([onlyDelivered.records.map((r) => r.msgid), onlyDelivered.stats.map((st) => [st.kind, st.records, st.error])], [['d'], [['delivered', 1, null], ['problems', 0, 'WHM_HTTP']]], 'a failed second call keeps the first');
  const onlyProblems = await half('delivered').emailTrack({ domain: null, sinceUnix: 1, untilUnix: 2 });
  assert.deepEqual(onlyProblems.records.map((r) => r.msgid), ['p']);
  await assert.rejects(half('both').emailTrack({ domain: null, sinceUnix: 1, untilUnix: 2 }), { code: 'WHM_HTTP' }, 'both failing is an error with its reason');
  assert.ok(onlyDelivered.stats.every((st) => Number.isInteger(st.ms) && Number.isInteger(st.chunks)));
  const partialService = sent.createService({ credentialsFor: async () => ({}), serverIdOf: async () => 'srv-1', now: () => clock,
    createClient: () => ({ emailTrack: async () => ({ records: [mk(5)], truncated: false, stats: [{ kind: 'delivered', chunks: 1, records: 1, ms: 12, error: null }, { kind: 'problems', chunks: 0, records: 0, ms: 20000, error: 'WHM_TIMEOUT' }] }) }) });
  clock += 61 * 1000;
  const flagged = await partialService.search({ domain: 'exemplo.test', query: {}, diagnostics: true });
  assert.deepEqual([flagged.partial, flagged.rows.length, flagged.diagnostics.calls.map((c) => c.error)], [true, 1, [null, 'WHM_TIMEOUT']], 'a partial read is flagged and still lists what arrived');
  assert.equal((await service.search({ domain: 'exemplo.test', query: {} })).partial, false);
  console.log('spfbl sent mail tests passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
