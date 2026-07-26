const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DB_HOST = 'test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'TEST_DB_PASSWORD_1234567890';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'TEST_JWT_SECRET_1234567890_TEST_JWT_SECRET_1234567890_TEST_JWT_SECRET_1234567890';
process.env.ADMIN_BOOTSTRAP_TOKEN = 'TEST_BOOTSTRAP_TOKEN_1234567890_TEST_BOOTSTRAP_TOKEN_1234567890';
process.env.SUPER_ADMIN_EMAIL = 'admin@example.com';
process.env.APP_ORIGIN = 'https://example.com';

const repositoryRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const db = require('../src/config/database');

const response = () => ({
  statusCode: 200,
  body: undefined,
  status(value) {
    this.statusCode = value;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  }
});

const run = async () => {
  const controllerPath = require.resolve('../src/controllers/securityController');
  const securityPath = require.resolve('../src/config/security');
  require.cache[securityPath] = {
    exports: {
      isSuperAdmin: (user) => user?.role === 'admin' && user?.is_super_admin === true
    }
  };
  delete require.cache[controllerPath];
  const securityController = require(controllerPath);

  const originalQuery = db.query;
  let queryCount = 0;
  let capturedSql = '';
  const seenByUser = new Map();
  const events = Array.from({ length: 12 }, (_, index) => ({
    id: `event-${index}`,
    action: index === 0 ? 'login_failed' : 'smtp_test_email_failed',
    status: 'failed',
    user_email: 'security.user@example.com',
    ip_address: '192.0.2.55',
    created_at: new Date(Date.now() - index * 1000).toISOString(),
    metadata: {
      password: 'SHOULD_NOT_LEAK',
      token: 'SHOULD_NOT_LEAK',
      recovery_code: 'SHOULD_NOT_LEAK',
      hash: 'SHOULD_NOT_LEAK',
      private_key: 'SHOULD_NOT_LEAK'
    }
  }));
  db.query = async (sql, params = []) => {
    queryCount += 1;
    if (sql.includes('SELECT security_notifications_seen_at')) {
      const seenAt = seenByUser.get(params[0]);
      return { rows: seenAt ? [{ security_notifications_seen_at: seenAt }] : [] };
    }
    if (sql.includes('FROM system_audit_events')) {
      capturedSql = sql;
      const seenAt = new Date(params[2]).getTime();
      const unreadCount = events.filter((event) => new Date(event.created_at).getTime() > seenAt).length;
      return { rows: events.map((event) => ({ ...event, unread_count: unreadCount })) };
    }
    if (sql.includes('INSERT INTO user_notification_state')) {
      const current = seenByUser.get(params[0]);
      const proposed = new Date(params[1]);
      const next = !current || proposed > new Date(current) ? proposed.toISOString() : current;
      seenByUser.set(params[0], next);
      return { rows: [{ security_notifications_seen_at: next }] };
    }
    throw new Error(`Unexpected query in notification test: ${sql}`);
  };

  try {
    const deniedResponse = response();
    await securityController.getSecurityNotifications({
      user: { role: 'admin', is_super_admin: false }
    }, deniedResponse);
    assert.equal(deniedResponse.statusCode, 403);
    assert.equal(queryCount, 0);

    const deniedMarkResponse = response();
    await securityController.markSecurityNotificationsSeen({
      user: { id: 'user-denied', role: 'admin', is_super_admin: false },
      body: { seen_through: events[0].created_at }
    }, deniedMarkResponse);
    assert.equal(deniedMarkResponse.statusCode, 403);
    assert.equal(queryCount, 0);

    const allowedResponse = response();
    await securityController.getSecurityNotifications({
      user: { id: 'user-a', role: 'admin', is_super_admin: true }
    }, allowedResponse);
    assert.equal(allowedResponse.statusCode, 200);
    assert.equal(allowedResponse.body.items.length, 10);
    assert.equal(allowedResponse.body.unread_count, 12);
    assert.equal(allowedResponse.body.last_seen_at, null);
    assert.equal(allowedResponse.body.items[0].id, 'event-0');
    assert.match(capturedSql, /ORDER BY created_at DESC\s+LIMIT 10/);

    const serialized = JSON.stringify(allowedResponse.body);
    for (const secret of ['SHOULD_NOT_LEAK', 'password', 'token', 'private_key', 'wrapped_key', 'hash']) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.equal(serialized.includes('security.user@example.com'), false);
    assert.equal(serialized.includes('192.0.2.55'), false);
    assert.match(serialized, /s\*\*\*@e\*\*\*\.com/);
    assert.match(serialized, /192\.xxx\.xxx\.55/);

    const invalidMarkResponse = response();
    await securityController.markSecurityNotificationsSeen({
      user: { id: 'user-a', role: 'admin', is_super_admin: true },
      body: { seen_through: 'invalid' }
    }, invalidMarkResponse);
    assert.equal(invalidMarkResponse.statusCode, 400);

    const markResponse = response();
    await securityController.markSecurityNotificationsSeen({
      user: { id: 'user-a', role: 'admin', is_super_admin: true },
      body: { seen_through: events[0].created_at }
    }, markResponse);
    assert.equal(markResponse.statusCode, 200);
    assert.equal(markResponse.body.unread_count, 0);

    const seenResponse = response();
    await securityController.getSecurityNotifications({
      user: { id: 'user-a', role: 'admin', is_super_admin: true }
    }, seenResponse);
    assert.equal(seenResponse.body.unread_count, 0);
    assert.equal(seenResponse.body.items.length, 10);

    const otherUserResponse = response();
    await securityController.getSecurityNotifications({
      user: { id: 'user-b', role: 'admin', is_super_admin: true }
    }, otherUserResponse);
    assert.equal(otherUserResponse.body.unread_count, 12);
    assert.equal(otherUserResponse.body.last_seen_at, null);

    events.unshift({
      ...events[0],
      id: 'event-new',
      created_at: new Date(new Date(events[0].created_at).getTime() + 1000).toISOString()
    });
    const newNotificationResponse = response();
    await securityController.getSecurityNotifications({
      user: { id: 'user-a', role: 'admin', is_super_admin: true }
    }, newNotificationResponse);
    assert.equal(newNotificationResponse.body.unread_count, 1);
    assert.equal(newNotificationResponse.body.items[0].id, 'event-new');
  } finally {
    db.query = originalQuery;
  }

  const routes = read('backend/src/routes/systemRoutes.js');
  const schema = read('backend/src/config/securitySchema.js');
  const migration = read('database/migrations/12_create_user_notification_state.sql');
  assert.match(routes, /router\.use\(verifyToken\)[\s\S]*router\.get\('\/security-notifications'/);
  assert.match(routes, /router\.post\('\/security-notifications\/mark-seen'/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_notification_state/);
  assert.match(migration, /user_id UUID PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /security_notifications_seen_at TIMESTAMP WITH TIME ZONE NOT NULL/);
};

run()
  .then(() => {
    console.log('Security notifications backend tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
