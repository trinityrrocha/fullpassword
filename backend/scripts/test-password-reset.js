const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const argon2 = require('argon2');

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
const {
  RESET_CONFIRMATION,
  PasswordResetError,
  hashPasswordResetToken,
  isValidPasswordResetToken,
  buildPasswordResetEmail,
  validatePasswordResetToken,
  completePasswordReset
} = require('../src/services/passwordResetService');
const {
  passwordResetRequestLimiter
} = require('../src/middleware/writeRateLimiters');

const post = ({ port, body }) => new Promise((resolve, reject) => {
  const serializedBody = JSON.stringify(body);
  const request = http.request({
    host: '127.0.0.1',
    port,
    path: '/password-reset',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(serializedBody)
    }
  }, (response) => {
    let responseBody = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      responseBody += chunk;
    });
    response.on('end', () => resolve({
      status: response.statusCode,
      body: responseBody ? JSON.parse(responseBody) : {}
    }));
  });
  request.on('error', reject);
  request.end(serializedBody);
});

const makeCryptoPayload = () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  return {
    crypto_salt: crypto.randomBytes(32).toString('hex'),
    wrapped_key: `${crypto.randomBytes(12).toString('base64')}:${crypto.randomBytes(48).toString('base64')}`,
    public_key: publicKey.toString('base64'),
    encrypted_private_key: `${crypto.randomBytes(12).toString('base64')}:${crypto.randomBytes(64).toString('base64')}`,
    kdf_version: 2,
    kdf_name: 'PBKDF2',
    kdf_hash: 'SHA-256',
    kdf_iterations: 310000
  };
};

const run = async () => {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  assert.equal(rawToken.length, 43);
  assert.equal(isValidPasswordResetToken(rawToken), true);
  assert.equal(isValidPasswordResetToken('short-token'), false);
  assert.match(hashPasswordResetToken(rawToken), /^[a-f0-9]{64}$/);
  assert.equal(hashPasswordResetToken(rawToken).includes(rawToken), false);

  const email = buildPasswordResetEmail(rawToken);
  assert.match(email.text, /expira em 30 minutos/);
  assert.match(email.text, /apenas uma vez/);
  assert.match(email.text, new RegExp(rawToken));
  assert.doesNotMatch(email.text, /senha temporária|código de recuperação MFA/i);

  const originalQuery = db.query;
  const auditSource = read('backend/src/services/auditService.js');
  db.query = async (sql) => {
    if (sql.includes('FROM password_reset_tokens')) {
      return {
        rows: [{
          reset_token_id: 'reset-1',
          user_id: 'user-1',
          email: 'guest@example.com',
          is_active: true,
          is_super_admin: false,
          requires_mfa: false
        }]
      };
    }
    if (sql.includes('INSERT INTO system_audit_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const validated = await validatePasswordResetToken({
      ip: '192.0.2.10',
      get: () => 'test'
    }, rawToken);
    assert.deepEqual(validated, {
      valid: true,
      requires_mfa: false,
      email_masked: 'g***@example.com',
      privileged_account: false
    });

    db.query = async (sql) => {
      if (sql.includes('FROM password_reset_tokens')) return { rows: [] };
      if (sql.includes('INSERT INTO system_audit_events')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    };
    const expired = await validatePasswordResetToken({
      ip: '192.0.2.10',
      get: () => 'test'
    }, rawToken);
    assert.equal(expired.valid, false);
    assert.equal(expired.error, 'Link inválido ou expirado.');
  } finally {
    db.query = originalQuery;
  }

  const cryptoPayload = makeCryptoPayload();
  const newPassword = 'Strong_Reset_Password_123!';
  const queryLog = [];
  let tokenAvailable = true;
  let requiresMfa = false;
  const recoveryCode = 'ABCD-EF01-2345-6789';
  const recoveryCodeHash = await argon2.hash(recoveryCode, { type: argon2.argon2id });
  let recoveryCodeAvailable = false;
  const mockClient = {
    async query(sql, params = []) {
      queryLog.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes('FROM password_reset_tokens')) {
        return {
          rows: tokenAvailable ? [{
            reset_token_id: 'reset-1',
            user_id: 'user-1',
            email: 'guest@example.com',
            is_active: true,
            is_super_admin: false,
            requires_mfa: requiresMfa
          }] : []
        };
      }
      if (sql.includes('FROM user_mfa_settings')) {
        return {
          rows: [{
            user_id: 'user-1',
            enabled: true,
            totp_secret_encrypted: 'not-used-without-a-code'
          }]
        };
      }
      if (sql.includes('SELECT id, code_hash FROM user_mfa_recovery_codes')) {
        return {
          rows: recoveryCodeAvailable
            ? [{ id: 'recovery-1', code_hash: recoveryCodeHash }]
            : []
        };
      }
      if (sql.includes('UPDATE user_mfa_recovery_codes SET used_at')) {
        if (!recoveryCodeAvailable) return { rows: [], rowCount: 0 };
        recoveryCodeAvailable = false;
        return { rows: [{ id: 'recovery-1' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE user_mfa_settings')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE users')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE user_sessions')) return { rows: [], rowCount: 2 };
      if (sql.includes('DELETE FROM client_key_shares')) return { rows: [], rowCount: 3 };
      if (sql.includes('DELETE FROM vault_shares')) return { rows: [], rowCount: 4 };
      if (sql.includes('UPDATE password_reset_tokens')) {
        tokenAvailable = false;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
  const originalConnect = db.pool.connect;
  db.pool.connect = async () => mockClient;
  try {
    await assert.rejects(
      completePasswordReset(
        { ip: '192.0.2.10', get: () => 'test' },
        { token: rawToken, new_password: newPassword, ...cryptoPayload },
        { valid: true, errors: [] }
      ),
      (error) => error instanceof PasswordResetError
        && error.code === 'PASSWORD_RESET_CONFIRMATION_REQUIRED'
    );
    assert.equal(queryLog.length, 0);

    await assert.rejects(
      completePasswordReset(
        { ip: '192.0.2.10', get: () => 'test' },
        {
          token: 'invalid',
          new_password: newPassword,
          confirmation: RESET_CONFIRMATION,
          recovery_code: recoveryCode,
          ...cryptoPayload
        },
        { valid: true, errors: [] }
      ),
      (error) => error.code === 'PASSWORD_RESET_TOKEN_INVALID'
    );
    assert.equal(queryLog.length, 0);

    const result = await completePasswordReset(
      { ip: '192.0.2.10', get: () => 'test' },
      {
        token: rawToken,
        new_password: newPassword,
        confirmation: RESET_CONFIRMATION,
        ...cryptoPayload
      },
      { valid: true, errors: [] }
    );
    assert.equal(result.revokedSessions, 2);
    assert.equal(result.removedClientShares, 3);
    assert.equal(result.removedVaultShares, 4);
    assert.equal(queryLog.some(({ sql }) => sql.includes('token_version = token_version + 1')), true);
    assert.equal(queryLog.some(({ sql }) => sql.includes('DELETE FROM client_key_shares')), true);
    assert.equal(queryLog.some(({ sql }) => sql.includes('DELETE FROM vault_shares')), true);
    assert.equal(queryLog.some(({ sql }) => sql.includes("revoke_reason = 'password_reset'")), true);
    assert.equal(queryLog.some(({ params }) => params.includes(rawToken)), false);
    assert.equal(queryLog.some(({ params }) => params.includes(newPassword)), false);

    await assert.rejects(
      completePasswordReset(
        { ip: '192.0.2.10', get: () => 'test' },
        {
          token: rawToken,
          new_password: newPassword,
          confirmation: RESET_CONFIRMATION,
          ...cryptoPayload
        },
        { valid: true, errors: [] }
      ),
      (error) => error.code === 'PASSWORD_RESET_TOKEN_INVALID'
    );

    tokenAvailable = true;
    requiresMfa = true;
    const queriesBeforeMfaFailure = queryLog.length;
    await assert.rejects(
      completePasswordReset(
        { ip: '192.0.2.10', get: () => 'test' },
        {
          token: rawToken,
          new_password: newPassword,
          confirmation: RESET_CONFIRMATION,
          ...cryptoPayload
        },
        { valid: true, errors: [] }
      ),
      (error) => error.code === 'PASSWORD_RESET_MFA_INVALID'
        && error.statusCode === 403
    );
    assert.equal(
      queryLog.slice(queriesBeforeMfaFailure).some(({ sql }) => sql.includes('UPDATE users')),
      false
    );

    tokenAvailable = true;
    recoveryCodeAvailable = true;
    const recoveryReset = await completePasswordReset(
      { ip: '192.0.2.10', get: () => 'test' },
      {
        token: rawToken,
        new_password: newPassword,
        confirmation: RESET_CONFIRMATION,
        recovery_code: recoveryCode,
        ...cryptoPayload
      },
      { valid: true, errors: [] }
    );
    assert.equal(recoveryReset.mfaMethod, 'recovery_code');
    assert.equal(recoveryCodeAvailable, false);

    tokenAvailable = true;
    const queriesBeforeReuse = queryLog.length;
    await assert.rejects(
      completePasswordReset(
        { ip: '192.0.2.10', get: () => 'test' },
        {
          token: rawToken,
          new_password: newPassword,
          confirmation: RESET_CONFIRMATION,
          recovery_code: recoveryCode,
          ...cryptoPayload
        },
        { valid: true, errors: [] }
      ),
      (error) => error.code === 'PASSWORD_RESET_MFA_INVALID'
    );
    assert.equal(
      queryLog.slice(queriesBeforeReuse).some(({ sql }) => sql.includes('UPDATE users')),
      false
    );
    assert.equal(queryLog.some(({ params }) => params.includes(recoveryCode)), false);
  } finally {
    db.pool.connect = originalConnect;
  }

  const limiterApp = express();
  limiterApp.use(express.json());
  limiterApp.post('/password-reset', passwordResetRequestLimiter, (_req, res) => res.json({ ok: true }));
  const limiterServer = await new Promise((resolve) => {
    const server = limiterApp.listen(0, '127.0.0.1', () => resolve(server));
  });
  try {
    const port = limiterServer.address().port;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal((await post({ port, body: { email: 'guest@example.com' } })).status, 200);
    }
    const limited = await post({ port, body: { email: 'guest@example.com' } });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'PASSWORD_RESET_RATE_LIMITED');
  } finally {
    await new Promise((resolve) => limiterServer.close(resolve));
  }

  const passwordResetControllerPath = require.resolve('../src/controllers/passwordResetController');
  const passwordResetServicePath = require.resolve('../src/services/passwordResetService');
  const originalPasswordResetServiceCache = require.cache[passwordResetServicePath];
  require.cache[passwordResetServicePath] = {
    exports: {
      PASSWORD_RESET_GENERIC_MESSAGE: 'GENERIC_RESET_RESPONSE',
      PasswordResetError,
      requestPasswordReset: async () => {
        throw new Error('simulated delivery failure');
      },
      validatePasswordResetToken: async () => ({ valid: false }),
      completePasswordReset: async () => {
        throw new Error('not used');
      }
    }
  };
  delete require.cache[passwordResetControllerPath];
  const passwordResetController = require(passwordResetControllerPath);
  const genericResponse = {
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
  };
  await passwordResetController.requestReset(
    { body: { email: 'unknown@example.com' }, ip: '192.0.2.11', get: () => 'test' },
    genericResponse
  );
  assert.equal(genericResponse.statusCode, 200);
  assert.deepEqual(genericResponse.body, { message: 'GENERIC_RESET_RESPONSE' });
  require.cache[passwordResetServicePath] = originalPasswordResetServiceCache;
  delete require.cache[passwordResetControllerPath];

  const serviceSource = read('backend/src/services/passwordResetService.js');
  const controllerSource = read('backend/src/controllers/passwordResetController.js');
  const routesSource = read('backend/src/routes/authRoutes.js');
  const schemaSource = read('backend/src/config/securitySchema.js');
  const mfaSource = read('backend/src/services/mfaService.js');
  const authControllerSource = read('backend/src/controllers/authController.js');
  const userControllerSource = read('backend/src/controllers/userController.js');
  assert.match(controllerSource, /PASSWORD_RESET_GENERIC_MESSAGE/);
  assert.match(routesSource, /\/password-reset\/request/);
  assert.match(routesSource, /\/password-reset\/validate/);
  assert.match(routesSource, /\/password-reset\/complete/);
  assert.match(schemaSource, /token_hash CHAR\(64\) NOT NULL/);
  assert.doesNotMatch(schemaSource, /\btoken\s+TEXT|\braw_token\b/);
  assert.match(serviceSource, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(serviceSource, /prt\.expires_at > CURRENT_TIMESTAMP/);
  assert.match(serviceSource, /argon2\.hash\(payload\.new_password, \{ type: argon2\.argon2id \}\)/);
  assert.doesNotMatch(serviceSource, /generateKeyPair|generateRSAKeyPair/);
  assert.doesNotMatch(serviceSource, /console\.(?:log|warn|error)/);
  assert.match(mfaSource, /argon2\.verify/);
  assert.match(mfaSource, /used_at IS NULL/);
  assert.match(authControllerSource, /if \(!email \|\| !password\)/);
  assert.match(authControllerSource, /getMfaSettings\(user\.id\)/);
  assert.match(userControllerSource, /code: 'PASSWORD_RESET_EMAIL_REQUIRED'/);
  assert.doesNotMatch(
    userControllerSource.slice(
      userControllerSource.indexOf('const updateUser ='),
      userControllerSource.indexOf('// DELETE /api/users/:id')
    ),
    /hashSenhaLogin|masterKeyBuffer|wrappedKey/
  );
  assert.doesNotMatch(auditSource, /JSON\.stringify\(req\.body\)|req\.body/);
};

run()
  .then(() => {
    console.log('Zero-knowledge password reset tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
