const fs = require('fs');

const file = process.argv[2];
const expectedId = process.argv[3];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKeys = new Set([
  'request_id',
  'requested_by_user_id',
  'requested_by_email',
  'requested_at',
  'ip',
  'user_agent'
]);

const reject = () => {
  process.exitCode = 1;
};

try {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 4096) {
    reject();
  } else {
    const request = JSON.parse(fs.readFileSync(file, 'utf8'));
    const validObject = request && !Array.isArray(request) && typeof request === 'object';
    const validKeys = validObject && Object.keys(request).every((key) => allowedKeys.has(key));
    const validRequest = validKeys
      && uuidPattern.test(expectedId)
      && request.request_id === expectedId
      && uuidPattern.test(String(request.requested_by_user_id || ''))
      && typeof request.requested_by_email === 'string'
      && request.requested_by_email.length <= 320
      && request.requested_by_email.includes('@')
      && typeof request.requested_at === 'string'
      && Number.isFinite(Date.parse(request.requested_at))
      && (request.ip === null || (typeof request.ip === 'string' && request.ip.length <= 64))
      && (request.user_agent === null || (typeof request.user_agent === 'string' && request.user_agent.length <= 1000));

    if (!validRequest) reject();
  }
} catch {
  reject();
}
