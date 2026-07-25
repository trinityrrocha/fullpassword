const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');
const { authenticator } = require('otplib');

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
const db = require('../src/config/database');
const mfaService = require('../src/services/mfaService');

const makeResponse = () => ({
  statusCode: 200,
  body: null,
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
  const insertedHashes = [];
  const generatedCodes = await mfaService.replaceRecoveryCodes({
    async query(sql, params = []) {
      if (sql.startsWith('DELETE FROM user_mfa_recovery_codes')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO user_mfa_recovery_codes')) {
        insertedHashes.push(params[1]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected recovery-code query: ${sql}`);
    }
  }, 'user-1');

  assert.equal(generatedCodes.length, 10);
  assert.equal(insertedHashes.length, generatedCodes.length);
  assert.equal(insertedHashes.some((hash) => generatedCodes.includes(hash)), false);
  for (let index = 0; index < generatedCodes.length; index += 1) {
    assert.equal(await argon2.verify(insertedHashes[index], generatedCodes[index]), true);
  }

  const oneTimeCode = 'ABCD-EF01-2345-6789';
  const oneTimeHash = await argon2.hash(oneTimeCode, { type: argon2.argon2id });
  const validPasswordHash = await argon2.hash('Correct_Password_123!', { type: argon2.argon2id });
  let recoveryCodeAvailable = true;
  const oneTimeStore = {
    async query(sql) {
      if (sql.startsWith('SELECT id, code_hash')) {
        return {
          rows: recoveryCodeAvailable ? [{ id: 'recovery-1', code_hash: oneTimeHash }] : []
        };
      }
      if (sql.startsWith('UPDATE user_mfa_recovery_codes')) {
        if (!recoveryCodeAvailable) return { rows: [], rowCount: 0 };
        recoveryCodeAvailable = false;
        return { rows: [{ id: 'recovery-1' }], rowCount: 1 };
      }
      throw new Error(`Unexpected one-time-code query: ${sql}`);
    }
  };
  assert.equal(await mfaService.useRecoveryCode('user-1', oneTimeCode, oneTimeStore), true);
  assert.equal(await mfaService.useRecoveryCode('user-1', oneTimeCode, oneTimeStore), false);

  const totpSecret = authenticator.generateSecret();
  const totpCode = authenticator.generate(totpSecret);
  let totpMfaEnabled = true;
  let totpRecoveryCodesPresent = true;
  const totpDisableStore = {
    async query(sql) {
      if (sql.includes('FROM users u')) {
        return {
          rows: totpMfaEnabled ? [{
            user_id: 'user-1',
            enabled: true,
            hash_senha_login: validPasswordHash,
            totp_secret_encrypted: mfaService.encryptSecret(totpSecret)
          }] : []
        };
      }
      if (sql.startsWith('DELETE FROM user_mfa_recovery_codes')) {
        totpRecoveryCodesPresent = false;
        return { rows: [], rowCount: 10 };
      }
      if (sql.startsWith('DELETE FROM user_mfa_settings')) {
        totpMfaEnabled = false;
        return { rows: [{ user_id: 'user-1' }], rowCount: 1 };
      }
      throw new Error(`Unexpected TOTP disable query: ${sql}`);
    }
  };
  const totpDisableResult = await mfaService.disableMfaWithFactor({
    client: totpDisableStore,
    userId: 'user-1',
    currentPassword: 'Correct_Password_123!',
    mfaMethod: 'totp',
    mfaCode: totpCode
  });
  assert.equal(totpDisableResult.mfaMethod, 'totp');
  assert.equal(totpMfaEnabled, false);
  assert.equal(totpRecoveryCodesPresent, false);

  const mfaControllerPath = require.resolve('../src/controllers/mfaController');
  const mfaServicePath = require.resolve('../src/services/mfaService');
  const authControllerPath = require.resolve('../src/controllers/authController');
  const auditServicePath = require.resolve('../src/services/auditService');
  const originalMfaServiceCache = require.cache[mfaServicePath];
  const originalAuthControllerCache = require.cache[authControllerPath];
  const originalAuditServiceCache = require.cache[auditServicePath];
  const originalDbQuery = db.query;
  const auditEvents = [];
  let completedLogin = false;

  require.cache[mfaServicePath] = {
    exports: {
      verifyChallengeToken: (token, purpose) => {
        if (token !== 'valid-challenge' || purpose !== 'login') throw new Error('invalid challenge');
        return { sub: 'user-1', token_version: 7 };
      },
      getMfaSettings: async () => ({ enabled: true }),
      ensureMfaSetup: async () => {
        throw new Error('not used');
      },
      verifyTotp: () => false,
      replaceRecoveryCodes: async () => {
        throw new Error('not used');
      },
      useRecoveryCode: async (_userId, candidate) => candidate === oneTimeCode,
      MfaActionError: class MockMfaActionError extends Error {},
      disableMfaWithFactor: async () => {
        throw new Error('not used');
      }
    }
  };
  require.cache[authControllerPath] = {
    exports: {
      completeLoginSession: async (_req, res, _user, extra) => {
        completedLogin = true;
        return res.status(200).json({ authenticated: true, ...extra });
      }
    }
  };
  require.cache[auditServicePath] = {
    exports: {
      recordAuditEvent: async (event) => {
        auditEvents.push({
          action: event.action,
          status: event.status,
          metadata: event.metadata
        });
      }
    }
  };
  db.query = async (sql) => {
    if (sql.includes('FROM users WHERE id')) {
      return {
        rows: [{
          id: 'user-1',
          email: 'user@example.com',
          is_active: true,
          token_version: 7
        }]
      };
    }
    if (sql.startsWith('UPDATE user_mfa_settings')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected controller query: ${sql}`);
  };

  try {
    delete require.cache[mfaControllerPath];
    const mfaController = require(mfaControllerPath);

    const validResponse = makeResponse();
    await mfaController.verifyLogin({
      body: { challenge_token: 'valid-challenge', recovery_code: oneTimeCode },
      ip: '192.0.2.10',
      get: () => 'test'
    }, validResponse);
    assert.equal(validResponse.statusCode, 200);
    assert.equal(validResponse.body.recovery_code_used, true);
    assert.equal(completedLogin, true);
    assert.equal(auditEvents.some(({ action }) => action === 'mfa_recovery_code_used'), true);

    completedLogin = false;
    const invalidResponse = makeResponse();
    await mfaController.verifyLogin({
      body: { challenge_token: 'valid-challenge', recovery_code: 'FFFF-FFFF-FFFF-FFFF' },
      ip: '192.0.2.10',
      get: () => 'test'
    }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 401);
    assert.equal(invalidResponse.body.error, 'Código MFA inválido ou expirado');
    assert.equal(completedLogin, false);
    assert.equal(auditEvents.some(({ action }) => action === 'mfa_recovery_code_failed'), true);

    const noChallengeResponse = makeResponse();
    await mfaController.verifyLogin({
      body: { recovery_code: oneTimeCode },
      ip: '192.0.2.10',
      get: () => 'test'
    }, noChallengeResponse);
    assert.equal(noChallengeResponse.statusCode, 401);
    assert.equal(completedLogin, false);
    assert.equal(JSON.stringify(auditEvents).includes(oneTimeCode), false);
  } finally {
    db.query = originalDbQuery;
    require.cache[mfaServicePath] = originalMfaServiceCache;
    require.cache[authControllerPath] = originalAuthControllerCache;
    require.cache[auditServicePath] = originalAuditServiceCache;
    delete require.cache[mfaControllerPath];
  }

  const ipSecurityServicePath = require.resolve('../src/services/ipSecurityService');
  const originalIpSecurityServiceCache = require.cache[ipSecurityServicePath];
  let challengeCreated = false;
  require.cache[mfaServicePath] = {
    exports: {
      getMfaSettings: async () => ({ enabled: true }),
      ensureMfaSetup: async () => {
        throw new Error('not used');
      },
      createChallengeToken: () => {
        challengeCreated = true;
        return 'unexpected-challenge';
      }
    }
  };
  require.cache[auditServicePath] = {
    exports: { recordAuditEvent: async () => {} }
  };
  require.cache[ipSecurityServicePath] = {
    exports: { applyAutomaticBlockForLoginFailure: async () => {} }
  };
  db.query = async (sql) => {
    if (sql.includes('FROM users WHERE LOWER(email)')) {
      return {
        rows: [{
          id: 'user-1',
          email: 'user@example.com',
          hash_senha_login: validPasswordHash,
          is_active: true,
          token_version: 7
        }]
      };
    }
    throw new Error(`Unexpected password-login query: ${sql}`);
  };
  try {
    delete require.cache[authControllerPath];
    const authController = require(authControllerPath);
    const wrongPasswordResponse = makeResponse();
    await authController.login({
      body: {
        email: 'user@example.com',
        password: 'Wrong_Password_123!',
        recovery_code: oneTimeCode
      },
      ip: '192.0.2.10',
      get: () => 'test'
    }, wrongPasswordResponse);
    assert.equal(wrongPasswordResponse.statusCode, 401);
    assert.equal(challengeCreated, false);
  } finally {
    db.query = originalDbQuery;
    require.cache[mfaServicePath] = originalMfaServiceCache;
    require.cache[authControllerPath] = originalAuthControllerCache;
    require.cache[auditServicePath] = originalAuditServiceCache;
    require.cache[ipSecurityServicePath] = originalIpSecurityServiceCache;
  }

  const originalConnect = db.pool.connect;
  let disableState;
  let disableSnapshot;
  let failMfaSettingsDelete = false;
  const disableQueryLog = [];
  const disableClient = {
    async query(sql) {
      disableQueryLog.push(sql);
      if (sql === 'BEGIN') {
        disableSnapshot = { ...disableState };
        return { rows: [], rowCount: 0 };
      }
      if (sql === 'COMMIT') {
        disableSnapshot = null;
        return { rows: [], rowCount: 0 };
      }
      if (sql === 'ROLLBACK') {
        if (disableSnapshot) disableState = { ...disableSnapshot };
        disableSnapshot = null;
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM users u')) {
        return {
          rows: disableState.mfaEnabled ? [{
            user_id: 'user-1',
            enabled: true,
            hash_senha_login: validPasswordHash,
            totp_secret_encrypted: mfaService.encryptSecret(totpSecret)
          }] : []
        };
      }
      if (sql.startsWith('SELECT id, code_hash')) {
        return {
          rows: disableState.recoveryCodeAvailable
            ? [{ id: 'recovery-disable-1', code_hash: oneTimeHash }]
            : []
        };
      }
      if (sql.startsWith('UPDATE user_mfa_recovery_codes')) {
        if (!disableState.recoveryCodeAvailable) return { rows: [], rowCount: 0 };
        disableState.recoveryCodeAvailable = false;
        return { rows: [{ id: 'recovery-disable-1' }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM user_mfa_recovery_codes')) {
        disableState.recoveryCodeAvailable = false;
        return { rows: [], rowCount: 10 };
      }
      if (sql.startsWith('DELETE FROM user_mfa_settings')) {
        if (failMfaSettingsDelete) throw new Error('simulated disable failure');
        disableState.mfaEnabled = false;
        return { rows: [{ user_id: 'user-1' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO system_audit_events')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected transactional disable query: ${sql}`);
    },
    release() {}
  };
  db.pool.connect = async () => disableClient;
  db.query = async (sql) => {
    if (sql.includes('INSERT INTO system_audit_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected disable audit query: ${sql}`);
  };

  try {
    delete require.cache[mfaControllerPath];
    const actualMfaController = require(mfaControllerPath);
    const authenticatedRequest = {
      user: { id: 'user-1', email: 'user@example.com' },
      body: {
        current_password: 'Correct_Password_123!',
        mfa_method: 'recovery_code',
        recovery_code: oneTimeCode
      },
      ip: '192.0.2.10',
      get: () => 'test'
    };

    disableState = { mfaEnabled: true, recoveryCodeAvailable: true };
    const disableSuccessResponse = makeResponse();
    await actualMfaController.disableProfileMfa(authenticatedRequest, disableSuccessResponse);
    assert.equal(disableSuccessResponse.statusCode, 200);
    assert.equal(disableSuccessResponse.body.mfa_enabled, false);
    assert.equal(disableState.mfaEnabled, false);
    assert.equal(disableState.recoveryCodeAvailable, false);
    assert.equal(await mfaService.useRecoveryCode('user-1', oneTimeCode, disableClient), false);
    assert.equal(disableQueryLog.some((sql) => /token_version|user_sessions/.test(sql)), false);

    disableState = { mfaEnabled: true, recoveryCodeAvailable: true };
    const wrongPasswordResponse = makeResponse();
    await actualMfaController.disableProfileMfa({
      ...authenticatedRequest,
      body: { ...authenticatedRequest.body, current_password: 'Wrong_Password_123!' }
    }, wrongPasswordResponse);
    assert.equal(wrongPasswordResponse.statusCode, 403);
    assert.equal(wrongPasswordResponse.body.error, 'Senha atual inválida.');
    assert.equal(disableState.mfaEnabled, true);
    assert.equal(disableState.recoveryCodeAvailable, true);

    disableState = { mfaEnabled: true, recoveryCodeAvailable: true };
    failMfaSettingsDelete = true;
    const failedTransactionResponse = makeResponse();
    await actualMfaController.disableProfileMfa(authenticatedRequest, failedTransactionResponse);
    assert.equal(failedTransactionResponse.statusCode, 500);
    assert.equal(disableState.mfaEnabled, true);
    assert.equal(disableState.recoveryCodeAvailable, true);
  } finally {
    failMfaSettingsDelete = false;
    db.pool.connect = originalConnect;
    db.query = originalDbQuery;
    delete require.cache[mfaControllerPath];
  }

  const authSource = read('backend/src/controllers/authController.js');
  const mfaControllerSource = read('backend/src/controllers/mfaController.js');
  const mfaServiceSource = read('backend/src/services/mfaService.js');
  const userRoutesSource = read('backend/src/routes/userRoutes.js');
  const serverSource = read('backend/src/server.js');
  const passwordCheckIndex = authSource.indexOf('if (!isPasswordValid)');
  const challengeIndex = authSource.indexOf("createChallengeToken(sessionUser, 'login')");
  assert.ok(passwordCheckIndex >= 0 && challengeIndex > passwordCheckIndex);
  assert.match(mfaControllerSource, /COUNT\(c\.id\).*recovery_codes_remaining/s);
  assert.doesNotMatch(
    mfaControllerSource.slice(
      mfaControllerSource.indexOf('const getProfileStatus'),
      mfaControllerSource.indexOf('const startProfileSetup')
    ),
    /code_hash|recovery_codes:/
  );
  assert.match(mfaServiceSource, /argon2\.hash\(code, \{ type: argon2\.argon2id \}\)/);
  assert.match(mfaServiceSource, /used_at IS NULL RETURNING id/);
  assert.match(mfaServiceSource, /disableMfaWithFactor/);
  assert.match(mfaControllerSource, /await client\.query\('BEGIN'\)[\s\S]*disableMfaWithFactor[\s\S]*await client\.query\('COMMIT'\)/);
  assert.match(userRoutesSource, /router\.use\(verifyToken\)[\s\S]*\/profile\/mfa\/disable/);
  assert.doesNotMatch(mfaControllerSource, /console\.(?:log|warn|error)/);
  assert.match(serverSource, /app\.use\('\/api\/auth\/mfa', mfaLimiter\)/);
  assert.match(serverSource, /Muitas tentativas\. Aguarde alguns minutos e tente novamente\./);
};

run()
  .then(() => {
    console.log('MFA recovery code tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
