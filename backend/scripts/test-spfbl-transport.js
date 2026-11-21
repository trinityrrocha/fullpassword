// Runs the REAL https transports of the WHM and Matrix clients against throwaway local TLS servers (no network,
// no provider): hostname verification while connected by IP, no redirects, size cap, idle and total timeouts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
Object.assign(process.env, {
  DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'TEST_ONLY_PASSWORD', DB_NAME: 'test',
  JWT_SECRET: 'TEST_ONLY_JWT_'.repeat(8), ADMIN_BOOTSTRAP_TOKEN: 'TEST_BOOTSTRAP_'.repeat(6),
  APP_ORIGIN: 'https://example.invalid', SUPER_ADMIN_EMAIL: 'admin@example.invalid'
});
const whm = require('../src/services/spfblWhmClient');
const matrix = require('../src/services/spfblMatrixClient');

const TOKEN = 'WHMTOKENSENTINEL0123456789ABCDEF';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spfbl-transport-'));
const makeCert = (name, host) => {
  const key = path.join(directory, `${name}.key`); const cert = path.join(directory, `${name}.crt`);
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${host}`,
    '-addext', `subjectAltName=DNS:${host}`, '-keyout', key, '-out', cert], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
};
const servers = [];
const listen = (server) => new Promise((resolve) => { servers.push(server); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const seen = [];
const handler = (label, behave) => (req, res) => { seen.push({ label, host: req.headers.host, authorization: req.headers.authorization, url: req.url, userAgent: req.headers['user-agent'] }); behave(req, res); };
const elapsed = async (promise) => { const start = Date.now(); const outcome = await promise.then((value) => ({ value }), (error) => ({ error })); return { ...outcome, ms: Date.now() - start }; };

async function run() {
  const good = makeCert('good', 'srv.example.com');
  const wrong = makeCert('wrong', 'other.example.net');
  const base = { ip: '127.0.0.1', host: 'srv.example.com', path: '/json-api/listaccts?api.version=1', headers: { Authorization: `whm root:${TOKEN}` }, timeoutMs: 3000, maxBytes: 1024 * 1024, ca: good.cert };

  // ---- WHM transport ----
  const okPort = await listen(https.createServer(good, handler('ok', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"metadata":{"result":1},"data":{"acct":[]}}'); })));
  let result = await whm.defaultTransport({ ...base, port: okPort });
  assert.deepEqual(result, { status: 200, body: '{"metadata":{"result":1},"data":{"acct":[]}}' });
  const call = seen.at(-1);
  assert.equal(call.host, `srv.example.com:${okPort}`, 'the Host header carries the hostname and port (like curl), not the pinned IP');
  assert.equal(call.authorization, `whm root:${TOKEN}`); assert.equal(call.url, '/json-api/listaccts?api.version=1');

  // Connected by IP, but the certificate must be valid for the hostname.
  const wrongPort = await listen(https.createServer(wrong, handler('wrong', (_req, res) => res.end('{}'))));
  const mismatch = await elapsed(whm.defaultTransport({ ...base, port: wrongPort, ca: wrong.cert }));
  assert.ok(mismatch.error, 'a certificate for another hostname must be refused'); assert.match(`${mismatch.error.code} ${mismatch.error.message}`, /ALTNAME|identity|hostname|altnames/i);
  assert.equal(seen.filter((entry) => entry.label === 'wrong').length, 0, 'no request is sent over an unverified channel');
  // An untrusted (self-signed) certificate is refused too.
  const untrusted = await elapsed(whm.defaultTransport({ ...base, port: okPort, ca: undefined }));
  assert.ok(untrusted.error); assert.match(`${untrusted.error.code} ${untrusted.error.message}`, /SELF.SIGNED|certificate|CERT/i);
  // Plain HTTP on the port is not accepted.
  const plainPort = await listen(http.createServer(handler('plain', (_req, res) => res.end('{}'))));
  assert.ok((await elapsed(whm.defaultTransport({ ...base, port: plainPort, timeoutMs: 1500 }))).error);
  assert.equal(seen.filter((entry) => entry.label === 'plain').length, 0);

  // Redirects are never followed.
  const redirectPort = await listen(https.createServer(good, handler('redirect', (_req, res) => { res.writeHead(302, { Location: 'https://127.0.0.1:1/elsewhere' }); res.end(); })));
  result = await whm.defaultTransport({ ...base, port: redirectPort });
  assert.equal(result.status, 302); assert.equal(seen.filter((entry) => entry.label === 'redirect').length, 1);
  // ...and the client reports it without the Location.
  const client = new whm.WhmClient({ host: 'srv.example.com', user: 'root', token: TOKEN }, { resolver: async () => ['93.184.216.7'], transport: (c) => whm.defaultTransport({ ...c, ip: '127.0.0.1', port: redirectPort, ca: good.cert }) });
  await assert.rejects(client.accounts(), { code: 'WHM_REDIRECT' });

  // Size cap: the body is cut off, not buffered.
  let leaked = 0;
  const bigPort = await listen(https.createServer(good, handler('big', (_req, res) => { const chunk = Buffer.alloc(16 * 1024, 'x'); const timer = setInterval(() => { leaked += chunk.length; if (!res.write(chunk) && res.destroyed) clearInterval(timer); }, 1); res.on('close', () => clearInterval(timer)); })));
  const big = await elapsed(whm.defaultTransport({ ...base, port: bigPort, maxBytes: 64 * 1024, timeoutMs: 3000 }));
  assert.equal(big.error?.oversized, true); assert.ok(big.ms < 2500);
  assert.ok(leaked < 4 * 1024 * 1024, 'the connection is dropped once the cap is hit');

  // Idle timeout and TOTAL timeout (a slow-drip server never trips the idle one).
  const hangPort = await listen(https.createServer(good, handler('hang', () => {})));
  const idle = await elapsed(whm.defaultTransport({ ...base, port: hangPort, timeoutMs: 300 }));
  assert.equal(idle.error?.timeout, true); assert.ok(idle.ms >= 250 && idle.ms < 1500, `idle ${idle.ms}ms`);
  const dripPort = await listen(https.createServer(good, handler('drip', (_req, res) => { res.writeHead(200); const timer = setInterval(() => res.write(' '), 80); res.on('close', () => clearInterval(timer)); })));
  const drip = await elapsed(whm.defaultTransport({ ...base, port: dripPort, timeoutMs: 600 }));
  assert.equal(drip.error?.timeout, true); assert.ok(drip.ms >= 500 && drip.ms < 1500, `slow drip aborted after ${drip.ms}ms`);
  const refused = await elapsed(whm.defaultTransport({ ...base, port: 1, timeoutMs: 1500 }));
  assert.ok(refused.error && !refused.error.timeout);

  // ---- Matrix transport ----
  const matrixCert = makeCert('matrix', matrix.MATRIX_HOST);
  const mBase = { endpoint: 'history', query: 'user=ops%40example.com&password=pw', timeoutMs: 3000, connectTo: '127.0.0.1', ca: matrixCert.cert };
  const mOkPort = await listen(https.createServer(matrixCert, handler('m-ok', (_req, res) => res.end('{"result":"VALID","message":[]}'))));
  const answer = await matrix.defaultTransport({ ...mBase, port: mOkPort });
  assert.deepEqual(answer, { status: 200, body: '{"result":"VALID","message":[]}' });
  assert.equal(seen.at(-1).host, matrix.MATRIX_HOST); assert.equal(seen.at(-1).url, '/history/?user=ops%40example.com&password=pw');
  const full = await matrix.testConnection({ user: 'ops@example.com', password: 'pw' }, { transport: (call) => matrix.defaultTransport({ ...call, connectTo: '127.0.0.1', port: mOkPort, ca: matrixCert.cert }) });
  assert.equal(full.ok, true);
  const mWrongPort = await listen(https.createServer(wrong, handler('m-wrong', (_req, res) => res.end('{}'))));
  const mWrong = await elapsed(matrix.defaultTransport({ ...mBase, port: mWrongPort, ca: wrong.cert }));
  assert.equal(mWrong.error?.code, 'MATRIX_CONNECTION_FAILED'); assert.equal(seen.filter((entry) => entry.label === 'm-wrong').length, 0);
  assert.equal(`${mWrong.error?.message}`.includes('password'), false);
  const mRedirectPort = await listen(https.createServer(matrixCert, handler('m-redirect', (_req, res) => { res.writeHead(302, { Location: 'https://evil.example.net/' }); res.end(); })));
  assert.equal((await matrix.defaultTransport({ ...mBase, port: mRedirectPort })).status, 302);
  assert.equal(seen.filter((entry) => entry.label === 'm-redirect').length, 1);
  await assert.rejects(matrix.testConnection({ user: 'ops@example.com', password: 'pw' }, { transport: (call) => matrix.defaultTransport({ ...call, connectTo: '127.0.0.1', port: mRedirectPort, ca: matrixCert.cert }) }), { code: 'MATRIX_HTTP_UNEXPECTED' });
  const mBigPort = await listen(https.createServer(matrixCert, handler('m-big', (_req, res) => { const chunk = Buffer.alloc(16 * 1024, 'x'); const timer = setInterval(() => res.write(chunk), 1); res.on('close', () => clearInterval(timer)); })));
  const mBig = await elapsed(matrix.defaultTransport({ ...mBase, port: mBigPort, maxBytes: 64 * 1024 }));
  assert.equal(mBig.error?.code, 'MATRIX_RESPONSE_TOO_LARGE');
  const mDripPort = await listen(https.createServer(matrixCert, handler('m-drip', (_req, res) => { res.writeHead(200); const timer = setInterval(() => res.write(' '), 80); res.on('close', () => clearInterval(timer)); })));
  const mDrip = await elapsed(matrix.defaultTransport({ ...mBase, port: mDripPort, timeoutMs: 600 }));
  assert.equal(mDrip.error?.code, 'MATRIX_CONNECTION_FAILED'); assert.ok(mDrip.ms >= 500 && mDrip.ms < 1500, `slow drip aborted after ${mDrip.ms}ms`);
  assert.equal(seen.filter((entry) => entry.label.startsWith('m-')).every((entry) => entry.userAgent === 'FullPassword-SPFBL/1'), true);
  console.log('PASS spfbl transports: hostname verified while connected by IP, untrusted/plain refused, redirects not followed, size cap, idle + total timeouts (real https, local TLS servers).');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const server of servers) { server.closeAllConnections?.(); server.close(); }
  fs.rmSync(directory, { recursive: true, force: true });
});
