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
  assert.deepEqual([c('failure', '550 5.1.1 The email account that you tried to reach does not exist.').label, c('failure', '550 5.1.1 The email account that you tried to reach does not exist.').code], ['Email errado ou não existe', '550 5.1.1']);
  assert.equal(c('failure', 'RCPT TO:<x@y.example> User unknown').key, 'mailbox_not_found');
  assert.equal(c('failure', '552 5.2.2 Mailbox full').label, 'Caixa do destinatário cheia');
  assert.equal(c('defer', '452 4.2.2 Over quota').label, 'Caixa do destinatário cheia', 'a deferral keeps the cause but says it is only postponed');
  assert.equal(c('failure', 'Domain exemplo.test has exceeded the max defers and failures per hour (5/5 (100%)) allowed. Message discarded.').label, 'Limite de envios excedido');
  assert.equal(c('failure', '550 5.7.1 Message rejected as spam, listed in Spamhaus').label, 'Você foi bloqueado como spam');
  assert.equal(c('defer', 'Connection timed out').label, 'Servidor de destino não respondeu');
  assert.equal(c('failure', 'Host or domain name not found. Name service error for name=destino.example').label, 'Domínio inexistente');
  assert.equal(c('defer', '451 4.7.1 Greylisted, please try again later').label, 'Adiado pelo destino (tentará de novo)');
  assert.equal(c('failure', 'TLS error: certificate verify failed').label, 'Falha de TLS');
  assert.equal(c('failure', '552 5.3.4 Message size exceeds fixed limit').label, 'Mensagem grande demais');
  assert.deepEqual([c('failure', '554 something odd').label, c('failure', '554 something odd').code], ['Falha na entrega (554)', '554']);
  assert.equal(c('failure', 'odd').label, 'Falha na entrega');
  assert.deepEqual([c('failure', '553 5.1.3 The address is not valid').label, c('failure', '501 Syntax error in parameters or arguments').label, c('failure', '553 5.1.3').key], ['Erro de digitação', 'Erro de digitação', 'typo']);
  assert.equal(c('defer', '451 5.1.3 invalid address').label, 'Erro de digitação', 'a typo keeps its label when deferred');
  assert.equal(c('defer', '550 5.7.1 blocked').label, 'Adiado: você foi bloqueado como spam', 'other deferrals say they are only postponed'); assert.equal(c('defer', 'odd').label, 'Servidor de destino não respondeu');
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
  assert.equal(sent.parseFilters({ period: '90d' }).seconds, 90 * 86400); assert.equal(sent.parseFilters({ period: '60d' }).period, '60d');
  assert.equal(sent.parseFilters({ period: '7d', status: 'failed', by: 'sender', q: '  Fulano@X.com ' }).q, 'fulano@x.com');
  for (const bad of [{ period: '1y' }, { status: 'nope' }, { by: 'x' }, { q: 'a'.repeat(101) }]) assert.throws(() => sent.parseFilters(bad), { name: 'SentError' }, JSON.stringify(bad).slice(0, 30));
  assert.equal(sent.parsePageSize(undefined), 20); assert.equal(sent.parsePageSize('100'), 100); assert.throws(() => sent.parsePageSize('7'), { code: 'SPFBL_FILTER_PAGE_SIZE' });

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
  const read = await whm().emailTrack({ sinceUnix: 1000, untilUnix: 2000 });
  assert.deepEqual([read.records.length, read.truncated], [1230, false], 'every record is read, in chunks, for both kinds of call');
  assert.equal(paths.length, 4, '1200 delivered = 3 chunks (500, 500, 200), 30 problems = 1');
  const [d1, d2, d3, p1] = paths;
  assert.ok(d1.startsWith('/json-api/emailtrack_search?api.version=1&success=1&defer=0&failure=0&inprogress=1&deliverytype=remote&max_results_by_type=0'), 'delivered: remote only, and NO limit of results (it would be applied before the filters)');
  assert.ok(d1.includes('api.filter.enable=1&api.filter.a.field=sendunixtime&api.filter.a.arg0=1000&api.filter.a.type=gt&api.filter.b.field=sendunixtime&api.filter.b.arg0=2000&api.filter.b.type=lt'), 'the period, as two filters named a and b');
  assert.ok(!paths.join(' ').includes('field=domain'), 'no domain filter in any request (it returned nothing on a real server)');
  assert.ok(d1.includes('api.sort.enable=1&api.sort.a.field=sendunixtime&api.sort.a.method=numeric&api.sort.a.reverse=1'), 'newest first');
  assert.deepEqual([d1, d2, d3].map((path) => /api\.chunk\.start=(\d+)/.exec(path)[1]), ['1', '501', '1001']); assert.ok(d1.includes('api.chunk.size=500'));
  assert.ok(p1.startsWith('/json-api/emailtrack_search?api.version=1&success=0&defer=1&failure=1&inprogress=0&deliverytype=all&max_results_by_type=0'), 'deferred and failed: not limited to remote transports, no limit of results');
  assert.ok(p1.includes('api.filter.a.field=actionunixtime&api.filter.a.arg0=1000&api.filter.a.type=gt') && p1.includes('api.sort.a.field=actionunixtime'), 'they are filtered and ordered by the attempt');
  assert.ok(!JSON.stringify(paths).includes('SENTINEL'), 'the token never reaches the URL');
  paths.length = 0; fixtures.delivered = Array.from({ length: 9000 }, (_, i) => record({ msgid: `d${i}` }));
  const capped = await whm().emailTrack({ sinceUnix: 1000, untilUnix: 2000, maxPerKind: 1000 });
  assert.deepEqual([capped.records.length, capped.truncated], [1030, true], 'a read stops at its cap and says so');
  fixtures.delivered = Array.from({ length: 500 }, (_, i) => record({ msgid: `d${i}` })); paths.length = 0;
  assert.equal((await whm().emailTrack({ sinceUnix: 1000, untilUnix: 2000 })).records.length, 530, 'a read ending exactly on a chunk asks once more and finds it empty');
  for (const bad of [{ sinceUnix: 5, untilUnix: 2 }, { sinceUnix: 'x', untilUnix: 2 }, { sinceUnix: -1, untilUnix: 2 }, { sinceUnix: 1, untilUnix: 2, maxPerKind: 10 }, { sinceUnix: 1, untilUnix: 2, maxPerKind: 99999 }, { sinceUnix: 1.5, untilUnix: 2 }]) {
    paths.length = 0;
    await assert.rejects(whm().emailTrack(bad), WhmError, JSON.stringify(bad));
    assert.equal(paths.length, 0, 'an invalid request never reaches the server');
  }
  const noRecords = whm({}, { transport: async () => ({ status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: {} }) }) });
  await assert.rejects(noRecords.emailTrack({ sinceUnix: 1, untilUnix: 2 }), { code: 'WHM_FORMAT' });
  await assert.rejects(whm().call('addpkg'), { code: 'WHM_FUNCTION_FORBIDDEN' });
  const refused = whm({}, { transport: async () => ({ status: 403, body: '{}' }) });
  await assert.rejects(refused.emailTrack({ sinceUnix: 1, untilUnix: 2 }), (error) => error.code === 'WHM_AUTH_REFUSED' && /emailtrack_search/.test(error.message), 'a token without permission is named');
  // a long chunked read gets a fresh time limit per call, but not an unlimited one
  let tick = 0; const slow = whm({}, { now: () => { tick += 30000; return tick; }, transport });
  await assert.rejects(slow.emailTrack({ sinceUnix: 1, untilUnix: 2 }), { code: 'WHM_TIMEOUT' }, 'the whole read has a ceiling');
  // one kind failing keeps what the other returned and says so; both failing reports the reason
  const half = (failKind) => whm({}, { transport: async (call) => {
    const isProblems = new URLSearchParams(call.path.split('?')[1]).get('success') === '0';
    if ((failKind === 'problems' && isProblems) || (failKind === 'delivered' && !isProblems) || failKind === 'both') return { status: 502, body: '{}' };
    return { status: 200, body: JSON.stringify({ metadata: { result: 1 }, data: { records: [record({ msgid: isProblems ? 'p' : 'd' })] } }) };
  } });
  const onlyDelivered = await half('problems').emailTrack({ sinceUnix: 1, untilUnix: 2 });
  assert.deepEqual([onlyDelivered.records.map((r) => r.msgid), onlyDelivered.stats.map((st) => [st.kind, st.records, st.error])], [['d'], [['delivered', 1, null], ['problems', 0, 'WHM_HTTP']]], 'a failed second call keeps the first');
  const onlyProblems = await half('delivered').emailTrack({ sinceUnix: 1, untilUnix: 2 });
  assert.deepEqual(onlyProblems.records.map((r) => r.msgid), ['p']);
  await assert.rejects(half('both').emailTrack({ sinceUnix: 1, untilUnix: 2 }), { code: 'WHM_HTTP' }, 'both failing is an error with its reason');
  assert.ok(onlyDelivered.stats.every((st) => Number.isInteger(st.ms) && Number.isInteger(st.chunks)));
  console.log('spfbl sent mail tests passed');
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
