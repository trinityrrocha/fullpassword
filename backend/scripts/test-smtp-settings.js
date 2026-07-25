const assert = require('assert/strict');
const crypto = require('crypto');
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
process.env.CONFIG_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const repositoryRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const {
  ConfigEncryptionError,
  encryptConfigSecret,
  decryptConfigSecret
} = require('../src/services/configSecretCrypto');
const smtpSettingsService = require('../src/services/smtpSettingsService');
const {
  normalizeSmtpSettings,
  sanitizeSmtpSettings,
  getSmtpDeliverySettings
} = smtpSettingsService;
const { createTransportOptions, EmailDeliveryError } = require('../src/services/emailService');
const db = require('../src/config/database');

const run = async () => {
  const smtpPassword = 'SMTP_TEST_PASSWORD_123!@#';
  const encryptedPassword = encryptConfigSecret(smtpPassword);
  assert.match(encryptedPassword, /^v1:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
  assert.equal(encryptedPassword.includes(smtpPassword), false);
  assert.equal(decryptConfigSecret(encryptedPassword), smtpPassword);

  const configured = normalizeSmtpSettings({
    enabled: true,
    host: 'smtp.example.com',
    port: 465,
    security: 'ssl_tls',
    username: 'mailer@example.com',
    password: smtpPassword,
    from_name: 'FullPassword',
    from_email: 'no-reply@example.com',
    reply_to: 'support@example.com',
    timeout_seconds: 15
  });
  assert.equal(configured.encrypted_password.startsWith('v1:'), true);
  assert.equal(configured.encrypted_password.includes(smtpPassword), false);

  const retained = normalizeSmtpSettings({
    enabled: true,
    password: ''
  }, configured);
  assert.equal(retained.encrypted_password, configured.encrypted_password);

  const sanitized = sanitizeSmtpSettings(configured);
  assert.equal(sanitized.has_password, true);
  assert.equal(Object.hasOwn(sanitized, 'password'), false);
  assert.equal(Object.hasOwn(sanitized, 'encrypted_password'), false);

  const previousQuery = db.query;
  db.query = async () => ({ rows: [configured] });
  try {
    const delivery = await getSmtpDeliverySettings();
    assert.equal(delivery.password, smtpPassword);
    const directTls = createTransportOptions(delivery);
    assert.equal(directTls.secure, true);
    assert.equal(directTls.requireTLS, false);
    assert.equal(directTls.tls.rejectUnauthorized, true);
    assert.equal(directTls.auth.pass, smtpPassword);

    const startTls = createTransportOptions({ ...delivery, security: 'starttls', port: 587 });
    assert.equal(startTls.secure, false);
    assert.equal(startTls.requireTLS, true);
    assert.equal(startTls.tls.rejectUnauthorized, true);

    const localOnly = createTransportOptions({
      ...delivery,
      security: 'none',
      username: '',
      password: ''
    });
    assert.equal(localOnly.secure, false);
    assert.equal(localOnly.requireTLS, false);
    assert.equal(Object.hasOwn(localOnly, 'tls'), false);
    assert.equal(Object.hasOwn(localOnly, 'auth'), false);
  } finally {
    db.query = previousQuery;
  }

  const originalEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  delete process.env.CONFIG_ENCRYPTION_KEY;
  assert.throws(
    () => normalizeSmtpSettings({ password: 'new-password' }),
    (error) => error instanceof ConfigEncryptionError && error.statusCode === 503
  );
  process.env.CONFIG_ENCRYPTION_KEY = originalEncryptionKey;

  assert.throws(
    () => normalizeSmtpSettings({
      enabled: true,
      host: 'smtp.example.com',
      from_email: 'invalid',
      security: 'starttls'
    }),
    /E-mail do remetente inválido/
  );
  assert.throws(
    () => normalizeSmtpSettings({ enabled: false, port: 70000 }),
    /porta SMTP/
  );

  const smtpControllerPath = require.resolve('../src/controllers/smtpController');
  const securityPath = require.resolve('../src/config/security');
  const auditPath = require.resolve('../src/services/auditService');
  const smtpSettingsPath = require.resolve('../src/services/smtpSettingsService');
  const emailServicePath = require.resolve('../src/services/emailService');
  const configSecretPath = require.resolve('../src/services/configSecretCrypto');
  let settingsReads = 0;
  let settingsWrites = 0;
  let testRecipient;
  const auditEvents = [];

  require.cache[securityPath] = {
    exports: {
      isSuperAdmin: (user) => user?.role === 'admin' && user?.is_super_admin === true
    }
  };
  require.cache[auditPath] = {
    exports: {
      recordAuditEvent: async (event) => auditEvents.push(event)
    }
  };
  require.cache[smtpSettingsPath] = {
    exports: {
      SmtpSettingsError: smtpSettingsService.SmtpSettingsError,
      isValidEmail: smtpSettingsService.isValidEmail,
      getSmtpSettings: async () => {
        settingsReads += 1;
        return sanitized;
      },
      updateSmtpSettings: async () => {
        settingsWrites += 1;
        return sanitized;
      }
    }
  };
  require.cache[emailServicePath] = {
    exports: {
      EmailDeliveryError,
      sendTestEmail: async ({ to }) => {
        testRecipient = to;
      }
    }
  };
  require.cache[configSecretPath] = {
    exports: { ConfigEncryptionError }
  };
  delete require.cache[smtpControllerPath];
  const smtpController = require(smtpControllerPath);

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
  const commonUserRequest = {
    user: { id: 'user-1', email: 'user@example.com', role: 'user', is_super_admin: false },
    body: {},
    ip: '192.0.2.1',
    get: () => 'test'
  };
  const deniedResponse = response();
  await smtpController.getSettings(commonUserRequest, deniedResponse);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(settingsReads, 0);
  const deniedSaveResponse = response();
  await smtpController.saveSettings(commonUserRequest, deniedSaveResponse);
  assert.equal(deniedSaveResponse.statusCode, 403);
  assert.equal(settingsWrites, 0);
  const deniedTestResponse = response();
  await smtpController.testSettings(commonUserRequest, deniedTestResponse);
  assert.equal(deniedTestResponse.statusCode, 403);
  assert.equal(testRecipient, undefined);

  const adminRequest = {
    user: { id: 'admin-1', email: 'admin@example.com', role: 'admin', is_super_admin: true },
    body: { password: smtpPassword },
    ip: '192.0.2.2',
    get: () => 'test'
  };
  const getResponse = response();
  await smtpController.getSettings(adminRequest, getResponse);
  assert.equal(getResponse.statusCode, 200);
  assert.equal(Object.hasOwn(getResponse.body, 'password'), false);
  assert.equal(Object.hasOwn(getResponse.body, 'encrypted_password'), false);

  const saveResponse = response();
  await smtpController.saveSettings(adminRequest, saveResponse);
  assert.equal(saveResponse.statusCode, 200);
  assert.equal(settingsWrites, 1);

  const testResponse = response();
  await smtpController.testSettings({
    ...adminRequest,
    body: { to: 'recipient@example.com' }
  }, testResponse);
  assert.equal(testResponse.statusCode, 200);
  assert.equal(testRecipient, 'recipient@example.com');
  assert.equal(auditEvents.some((event) => event.action === 'smtp_settings_updated'), true);
  assert.equal(auditEvents.some((event) => event.action === 'smtp_test_email_sent'), true);

  const controllerSource = read('backend/src/controllers/smtpController.js');
  const emailServiceSource = read('backend/src/services/emailService.js');
  const routesSource = read('backend/src/routes/systemRoutes.js');
  assert.match(routesSource, /router\.use\(verifyToken\)[\s\S]*router\.get\('\/smtp'/);
  assert.match(routesSource, /router\.post\('\/smtp\/test', smtpTestLimiter/);
  assert.doesNotMatch(controllerSource, /res\.[\s\S]{0,80}encrypted_password/);
  assert.doesNotMatch(controllerSource, /console\.(?:log|warn|error)/);
  assert.match(controllerSource, /Não foi possível enviar o e-mail de teste\. Revise a configuração SMTP/);
  assert.doesNotMatch(emailServiceSource, /rejectUnauthorized:\s*false/);
  assert.doesNotMatch(emailServiceSource, /console\.(?:log|warn|error)/);
  assert.match(emailServiceSource, /throw new EmailDeliveryError\(\)/);
};

run()
  .then(() => {
    console.log('Secure SMTP settings tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
