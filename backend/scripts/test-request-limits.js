const assert = require('assert');
const http = require('http');
const express = require('express');
const {
  enforceContentLength,
  payloadTooLargeErrorHandler,
  validateEncryptedVaultPayload
} = require('../src/middleware/requestLimits');
const {
  RATE_LIMIT_MESSAGE,
  SHORT_RATE_LIMIT_MESSAGE,
  createWriteRateLimiter,
  cloudBackupConfigLimiter,
  cloudBackupOperationLimiter,
  systemUpdateLimiter
} = require('../src/middleware/writeRateLimiters');

const request = ({ port, path, method = 'POST', body = '', headers = {}, chunked = false }) => new Promise((resolve, reject) => {
  const requestHeaders = { ...headers };
  if (!chunked) requestHeaders['Content-Length'] = Buffer.byteLength(body);

  const clientRequest = http.request({
    host: '127.0.0.1',
    port,
    path,
    method,
    headers: requestHeaders
  }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: response.statusCode,
        headers: response.headers,
        body: rawBody ? JSON.parse(rawBody) : null
      });
    });
  });
  clientRequest.on('error', reject);
  if (body) clientRequest.write(body);
  clientRequest.end();
});

const run = async () => {
  const app = express();
  const tinyJsonLimit = 100;
  const testWriteLimiter = createWriteRateLimiter({ windowMs: 60 * 1000, limit: 2 });

  app.post(
    '/limited-json',
    enforceContentLength(tinyJsonLimit, { jsonOnly: true }),
    express.json({ limit: tinyJsonLimit }),
    (_req, res) => res.json({ ok: true })
  );
  app.post(
    '/vault-payload',
    express.json({ limit: '1mb' }),
    validateEncryptedVaultPayload,
    (_req, res) => res.json({ ok: true })
  );
  app.all('/rate-limited', testWriteLimiter, (_req, res) => res.json({ ok: true }));
  app.put('/cloud-provider', cloudBackupConfigLimiter, (_req, res) => res.json({ ok: true }));
  app.post('/cloud-run', cloudBackupOperationLimiter, (_req, res) => res.json({ ok: true }));
  app.post('/system-update', systemUpdateLimiter, (_req, res) => res.json({ ok: true }));
  app.use(payloadTooLargeErrorHandler);

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const port = server.address().port;

  try {
    const accepted = await request({
      port,
      path: '/limited-json',
      body: JSON.stringify({ value: 'ok' }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(accepted.status, 200);

    const rejectedByContentLength = await request({
      port,
      path: '/limited-json',
      body: JSON.stringify({ value: 'x'.repeat(120) }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(rejectedByContentLength.status, 413);
    assert.strictEqual(rejectedByContentLength.body.code, 'PAYLOAD_TOO_LARGE');

    const rejectedByParser = await request({
      port,
      path: '/limited-json',
      body: JSON.stringify({ value: 'x'.repeat(120) }),
      headers: { 'Content-Type': 'application/json' },
      chunked: true
    });
    assert.strictEqual(rejectedByParser.status, 413);
    assert.strictEqual(rejectedByParser.body.code, 'PAYLOAD_TOO_LARGE');

    const oversizedMetadata = await request({
      port,
      path: '/vault-payload',
      body: JSON.stringify({
        category: 'VPN',
        encrypted_data: 'ciphertext',
        metadata: { description: 'x'.repeat(65 * 1024) }
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(oversizedMetadata.status, 413);
    assert.strictEqual(oversizedMetadata.body.code, 'PAYLOAD_TOO_LARGE');

    for (let index = 0; index < 5; index += 1) {
      const readResponse = await request({ port, path: '/rate-limited', method: 'GET' });
      assert.strictEqual(readResponse.status, 200);
    }
    assert.strictEqual((await request({ port, path: '/rate-limited' })).status, 200);
    assert.strictEqual((await request({ port, path: '/rate-limited' })).status, 200);
    const rateLimited = await request({ port, path: '/rate-limited' });
    assert.strictEqual(rateLimited.status, 429);
    assert.strictEqual(rateLimited.body.error, RATE_LIMIT_MESSAGE);
    assert.ok(Number(rateLimited.headers['retry-after']) > 0);

    for (let index = 0; index < 60; index += 1) {
      assert.strictEqual((await request({ port, path: '/cloud-provider', method: 'PUT' })).status, 200);
    }
    const providerLimited = await request({ port, path: '/cloud-provider', method: 'PUT' });
    assert.strictEqual(providerLimited.status, 429);
    assert.strictEqual(providerLimited.body.error, SHORT_RATE_LIMIT_MESSAGE);
    assert.strictEqual((await request({ port, path: '/system-update' })).status, 200);

    for (let index = 0; index < 5; index += 1) {
      assert.strictEqual((await request({ port, path: '/cloud-run' })).status, 200);
    }
    assert.strictEqual((await request({ port, path: '/cloud-run' })).status, 429);

    console.log('Request size and write rate-limit tests passed.');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
