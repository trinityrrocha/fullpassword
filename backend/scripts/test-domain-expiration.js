const assert = require('assert/strict');
const path = require('path');

process.env.DB_HOST = 'test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'TEST_DB_PASSWORD_1234567890';
process.env.DB_NAME = 'test';

const servicePath = require.resolve('../src/services/domainExpirationService');
const dbPath = require.resolve('../src/config/database');
const emailPath = require.resolve('../src/services/emailService');

const sentEmails = [];
const queries = [];
const row = {
  client_id: '11111111-1111-1111-1111-111111111111',
  hosting_server_id: 'hosting-1',
  domain: 'example.com',
  expiration_date: '2026-12-31',
  notify_emails: ['one@example.com', 'two@example.com'],
  sent_keys: []
};
const client = {
  query: async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
    if (sql.startsWith('SELECT client_id')) return { rows: [row] };
    return { rows: [] };
  },
  release: () => {}
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { connect: async () => client } } };
require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: { sendEmail: async (message) => sentEmails.push(message) } };
delete require.cache[servicePath];

const {
  buildDomainExpirationEmail,
  getDomainExpirationEvent,
  normalizeNotification,
  processDomainExpirationNotifications,
  syncDomainExpirationNotifications
} = require(servicePath);

for (const [date, key] of [['2026-12-01', 'before-30'], ['2026-12-16', 'before-15'], ['2026-12-26', 'before-5'], ['2026-12-31', 'due'], ['2027-01-01', 'expired-1'], ['2027-01-10', 'expired-10']]) {
  assert.equal(getDomainExpirationEvent('2026-12-31', date)?.key, key);
}
assert.equal(getDomainExpirationEvent('2026-12-31', '2027-01-11'), null, 'Não deve notificar após dez dias');
assert.equal(getDomainExpirationEvent('2026-12-31', '2026-12-02'), null, 'Não deve notificar fora dos marcos anteriores');

const before = buildDomainExpirationEmail('example.com', getDomainExpirationEvent('2026-12-31', '2026-12-01'));
assert.equal(before.subject, 'Domínio próximo do vencimento: example.com');
assert.equal(before.text, 'Seu domínio "example.com" está próximo do vencimento. Por favor, faça a renovação para manter os serviços ativos.');
const expired = buildDomainExpirationEmail('example.com', getDomainExpirationEvent('2026-12-31', '2027-01-01'));
assert.equal(expired.subject, 'Domínio vencido: example.com');
assert.equal(expired.text, 'Seu domínio "example.com" está com o status vencido. Por favor, faça a renovação para manter os serviços ativos.');

assert.deepEqual(normalizeNotification({ hostingServerId: 'one', domain: 'EXAMPLE.COM', expirationDate: '2026-12-31', emails: ['Admin@Example.com', 'admin@example.com'] }).emails, ['admin@example.com']);
assert.throws(() => normalizeNotification({ hostingServerId: 'one', domain: 'example.com', expirationDate: '', emails: [] }), /Data de vencimento inválida/);

(async () => {
  await processDomainExpirationNotifications({ now: new Date('2026-12-31T15:00:00Z'), timeZone: 'UTC' });
  assert.equal(sentEmails.length, 2, 'Deve enviar uma vez para cada destinatário');
  await processDomainExpirationNotifications({ now: new Date('2026-12-31T16:00:00Z'), timeZone: 'UTC' });
  assert.equal(sentEmails.length, 2, 'Não deve duplicar envio no mesmo dia');
  await syncDomainExpirationNotifications(row.client_id, [{ hostingServerId: 'hosting-1', domain: 'renewed.example.com', expirationDate: '2027-12-31', emails: ['new@example.com'] }], null);
  assert.ok(queries.some(({ sql }) => sql.includes("THEN '[]'::jsonb")), 'Alterar domínio ou data deve reiniciar o ciclo de envios');
  await syncDomainExpirationNotifications(row.client_id, [], null);
  assert.ok(queries.some(({ sql }) => sql.startsWith('DELETE FROM domain_expiration_notifications WHERE client_id = $1')), 'Desativar ou remover domínio deve excluir a notificação');
  assert.doesNotMatch(JSON.stringify(sentEmails), /password|senha/i);
  console.log('Backend domain expiration tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
