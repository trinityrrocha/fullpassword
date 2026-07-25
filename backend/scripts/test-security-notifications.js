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
  db.query = async (sql) => {
    queryCount += 1;
    capturedSql = sql;
    return {
      rows: Array.from({ length: 12 }, (_, index) => ({
        id: `event-${index}`,
        action: index === 0 ? 'login_failed' : 'smtp_test_email_failed',
        status: 'failed',
        user_email: 'security.user@example.com',
        ip_address: '192.0.2.55',
        created_at: new Date(Date.now() - index * 1000).toISOString(),
        total_count: 12,
        metadata: {
          password: 'SHOULD_NOT_LEAK',
          token: 'SHOULD_NOT_LEAK',
          recovery_code: 'SHOULD_NOT_LEAK',
          hash: 'SHOULD_NOT_LEAK',
          private_key: 'SHOULD_NOT_LEAK'
        }
      }))
    };
  };

  try {
    const deniedResponse = response();
    await securityController.getSecurityNotifications({
      user: { role: 'admin', is_super_admin: false }
    }, deniedResponse);
    assert.equal(deniedResponse.statusCode, 403);
    assert.equal(queryCount, 0);

    const allowedResponse = response();
    await securityController.getSecurityNotifications({
      user: { role: 'admin', is_super_admin: true }
    }, allowedResponse);
    assert.equal(allowedResponse.statusCode, 200);
    assert.equal(allowedResponse.body.items.length, 10);
    assert.equal(allowedResponse.body.unread_count, 12);
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
  } finally {
    db.query = originalQuery;
  }

  const routes = read('backend/src/routes/systemRoutes.js');
  assert.match(routes, /router\.use\(verifyToken\)[\s\S]*router\.get\('\/security-notifications'/);
};

run()
  .then(() => {
    console.log('Security notifications backend tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
