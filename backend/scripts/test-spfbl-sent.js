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

  // ---------- the service: scope check on the sender domain, cache, de-duplication, paging ----------
  let calls = 0; let clock = NOW; let answer = [];
  const seen = [];
  const service = sent.createService({
    credentialsFor: async (id) => ({ id }), serverIdOf: async (domain) => (domain === 'semservidor.test' ? null : 'srv-1'), now: () => clock,
    createClient: () => ({ emailTrack: async (args) => { calls += 1; seen.push(args); return answer; } })
  });
  const mk = (n, extra) => record({ msgid: `m${n}`, sendunixtime: String(sec(n)), actionunixtime: String(sec(n)), recipient: `dest${n}@destino.example`, ...extra });
  answer = [mk(5), mk(10, { type: 'failure', message: '550 5.1.1 User unknown' }), mk(20, { type: 'defer', message: '452 4.2.2 over quota' }),
    mk(30, { domain: 'outro.test' }), mk(40, { type: 'rejected' }), mk(2000, {}), mk(50, { sender: 'vendas@exemplo.test', email: 'vendas@exemplo.test' })];
  const first = await service.search({ domain: 'exemplo.test', query: {} });
  assert.equal(calls, 1);
  assert.deepEqual(first.rows.map((r) => r.detail.msgid), ['m5', 'm10', 'm20', 'm50'], 'newest first; other domains, refused-on-arrival and out-of-period records are dropped');
  assert.deepEqual([first.filtered_total, first.period_total, first.page, first.pages, first.truncated, first.cached], [4, 4, 1, 1, false, false]);
  assert.deepEqual([seen[0].domain, seen[0].perType, seen[0].untilUnix > seen[0].sinceUnix, (seen[0].untilUnix - seen[0].sinceUnix) >= 86400], ['exemplo.test', 2000, true, true], 'the server is asked for this domain and this period');
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
  assert.deepEqual(withFailures.diagnostics, { returned: { success: 1, failure: 4, defer: 1, rejected: 1 }, other_type: 1, other_domain: 3, out_of_period: 0 }, 'the Super Admin sees what was returned and why records were left out');
  assert.equal(JSON.stringify(withFailures.diagnostics).includes('@'), false, 'diagnostics carry counts only, never addresses');
  clock += 61 * 1000; assert.equal('diagnostics' in (await service.search({ domain: 'exemplo.test', query: {} })), false, 'no diagnostics unless asked');
  answer = [mk(2500, { type: 'defer', sendunixtime: String(sec(60 * 24 * 3)), actionunixtime: String(sec(5)) }), mk(2600, { sendunixtime: String(sec(60 * 24 * 3)), actionunixtime: String(sec(60 * 24 * 3)) })]; clock += 61 * 1000;
  assert.deepEqual((await service.search({ domain: 'exemplo.test', query: {} })).rows.map((r) => r.detail.msgid), ['m2500'], 'a message sent days ago and retried in the period still counts; one entirely outside does not');
  // paging
  answer = Array.from({ length: 45 }, (_, i) => mk(i + 1, { msgid: `p${i + 1}` })); clock += 61 * 1000;
  const page2 = await service.search({ domain: 'exemplo.test', query: { page: '2', page_size: '20' } });
  assert.deepEqual([page2.page, page2.pages, page2.rows.length, page2.filtered_total, page2.rows[0].detail.msgid], [2, 3, 20, 45, 'p21']);
  assert.equal((await service.search({ domain: 'exemplo.test', query: { page: '99' } })).page, 3, 'a page past the end lands on the last one');
  // truncation
  answer = Array.from({ length: sent.PER_TYPE_CAP }, (_, i) => mk((i % 1400) + 1, { msgid: `t${i}`, recipient: `d${i}@destino.example` })); clock += 61 * 1000;
  assert.equal((await service.search({ domain: 'exemplo.test', query: { period: '30d' } })).truncated, true, 'a type that hit the cap is flagged');
  // a server that ignores the filter cannot leak other domains' mail
  answer = [mk(5, { domain: 'outro.test', msgid: 'leak' })]; clock += 61 * 1000;
  assert.equal((await service.search({ domain: 'exemplo.test', query: {} })).rows.length, 0);

  // ---------- the WHM client: one more allow-listed function, with validated parameters ----------
  const calls2 = [];
  const transport = async (call) => { calls2.push(call); return { status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: { records: [record()] } }) }; };
  const whm = () => new WhmClient({ host: 'srv.example.com', user: 'root', token: 'TOKENSENTINEL0123456789ABCDEF' }, { transport, resolver: async () => ['93.184.216.7'] });
  const records = await whm().emailTrack({ domain: 'exemplo.test', sinceUnix: 1000, untilUnix: 2000, perType: 50 });
  assert.equal(records.length, 2, 'both calls are made and their records joined');
  assert.equal(calls2.length, 2);
  const [delivered, problems] = calls2.map((call) => call.path);
  assert.ok(delivered.startsWith('/json-api/emailtrack_search?api.version=1&success=1&defer=0&failure=0&inprogress=1&deliverytype=remote&max_results_by_type=50'), 'delivered and in progress: remote only');
  assert.ok(delivered.includes('api.filter.a.field=domain&api.filter.a.arg0=exemplo.test&api.filter.a.type=eq') && delivered.includes('api.filter.b.field=sendunixtime&api.filter.b.arg0=1000&api.filter.b.type=gt') && delivered.includes('api.filter.c.field=sendunixtime&api.filter.c.arg0=2000&api.filter.c.type=lt'));
  assert.ok(problems.startsWith('/json-api/emailtrack_search?api.version=1&success=0&defer=1&failure=1&inprogress=0&deliverytype=all&max_results_by_type=50'), 'deferred and failed: not limited to remote transports');
  assert.ok(!problems.includes('field=domain'), 'deferred and failed are not filtered by the domain field (it can be empty on them)');
  assert.ok(problems.includes('api.filter.b.field=actionunixtime&api.filter.b.arg0=1000&api.filter.b.type=gt') && problems.includes('api.filter.c.field=actionunixtime&api.filter.c.arg0=2000&api.filter.c.type=lt'), 'they are filtered by the period of the attempt');
  assert.ok(!JSON.stringify(calls2.map((call) => call.path)).includes('SENTINEL'), 'the token never reaches the URL');
  assert.equal(calls2[0].headers.Authorization.startsWith('whm root:'), true);
  for (const bad of [{ domain: 'a b', sinceUnix: 1, untilUnix: 2 }, { domain: 'exemplo.test;x=1', sinceUnix: 1, untilUnix: 2 }, { domain: 'exemplo.test', sinceUnix: 5, untilUnix: 2 },
    { domain: 'exemplo.test', sinceUnix: 'x', untilUnix: 2 }, { domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2, perType: 0 }, { domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2, perType: 9999 }, { domain: 'exemplo.test&api.version=2', sinceUnix: 1, untilUnix: 2 }]) {
    await assert.rejects(whm().emailTrack(bad), WhmError, JSON.stringify(bad));
  }
  assert.equal(calls2.length, 2, 'an invalid request never reaches the server (still only the two calls above)');
  const noRecords = new WhmClient({ host: 'srv.example.com', user: 'root', token: 'TOKENSENTINEL0123456789ABCDEF' }, { transport: async () => ({ status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: {} }) }), resolver: async () => ['93.184.216.7'] });
  await assert.rejects(noRecords.emailTrack({ domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2 }), { code: 'WHM_FORMAT' });
  await assert.rejects(whm().call('addpkg'), { code: 'WHM_FUNCTION_FORBIDDEN' });
  const refused = new WhmClient({ host: 'srv.example.com', user: 'root', token: 'TOKENSENTINEL0123456789ABCDEF' }, { transport: async () => ({ status: 403, body: '{}' }), resolver: async () => ['93.184.216.7'] });
  await assert.rejects(refused.emailTrack({ domain: 'exemplo.test', sinceUnix: 1, untilUnix: 2 }), (error) => error.code === 'WHM_AUTH_REFUSED' && /emailtrack_search/.test(error.message), 'a token without permission is named');
  console.log('spfbl sent mail tests passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
