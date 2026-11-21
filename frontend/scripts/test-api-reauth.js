import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the real interceptor with a synthetic transport, without credentials,
// browser storage or network. Cover binary downloads and multipart restores.
let success;
let failure;
let answer = 'SYNTHETIC_ONE_SHOT_GRANT';
const prompts = [];
const retries = [];
const api = {
  interceptors: { request: { use() {} }, response: { use(ok, fail) { success = ok; failure = fail; } } },
  request(config) { retries.push(config); return Promise.resolve(config); }
};
const source = fs.readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('import.meta.env.VITE_API_URL', "'/api'")
  .replace('export default api;', '');
vm.runInNewContext(source, {
  axios: { create: () => api }, Blob, FormData, CustomEvent,
  PAYLOAD_TOO_LARGE_MESSAGE: 'synthetic error',
  document: { cookie: 'fp_csrf=synthetic' },
  window: { dispatchEvent(event) { prompts.push(event.detail); event.detail.resolve(answer); }, location: {} }
});
const makeError = (data, config = {}) => ({
  response: { status: 403, data },
  config: { url: '/system/backup', method: 'post', responseType: 'blob', data: JSON.stringify({ passphrase: 'SYNTHETIC_ONLY' }), ...config }
});
const challenge = { code: 'REAUTH_REQUIRED', purpose: 'backup_export' };
const jsonBlob = value => new Blob([JSON.stringify(value)], { type: 'application/json; charset=utf-8' });

const downloaded = { data: new Blob(['SYNTHETIC_ENCRYPTED_BACKUP']) };
assert.equal(success(downloaded), downloaded);
assert.equal(prompts.length, 0);
await failure(makeError(jsonBlob(challenge)));
assert.equal(prompts.length, 1);
assert.equal(prompts[0].purpose, 'backup_export');
assert.equal(prompts[0].action.passphrase, 'SYNTHETIC_ONLY');
assert.equal(retries[0].responseType, 'blob');
assert.equal(retries[0].data._reauth_token, answer);
assert.equal(retries[0]._reauthRetried, true);
const repeated = makeError(jsonBlob(challenge), { _reauthRetried: true });
await assert.rejects(failure(repeated), error => error === repeated);
assert.equal(prompts.length, 1);

answer = null;
const cancelled = makeError(jsonBlob(challenge));
await assert.rejects(failure(cancelled), error => error === cancelled);
assert.equal(retries.length, 1);
answer = 'SYNTHETIC_ONE_SHOT_GRANT';
const upload = new FormData();
upload.append('file', new Blob(['SYNTHETIC']), 'fixture.enc.json');
await failure(makeError({ ...challenge, purpose: 'backup_restore' }, { data: upload, responseType: 'json', headers: { 'X-CSRF-Token': 'synthetic' } }));
assert.equal(retries[1].data, upload);
assert.equal(retries[1].headers['x-reauth-token'], answer);
assert.equal(retries[1].headers['X-CSRF-Token'], 'synthetic');
assert.equal(Object.keys(prompts.at(-1).action).length, 0);
for (const data of [new Blob(['{'], { type: 'application/json' }), new Blob(['not json']), new Blob([' '.repeat(65537)], { type: 'application/json' })]) {
  const error = makeError(data);
  await assert.rejects(failure(error), value => value === error);
  assert.equal(error.response.data, data);
}
assert.equal(retries.length, 2);
console.log('API reauthentication: blob download, cancel, one-shot retry, multipart and invalid errors PASS.');
