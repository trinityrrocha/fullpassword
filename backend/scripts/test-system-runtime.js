const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test-password';
process.env.DB_NAME ||= 'test';
process.env.APP_ORIGIN ||= 'https://cofre.example.test';
process.env.CONFIG_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.JWT_SECRET ||= crypto.randomBytes(64).toString('base64url');
process.env.ADMIN_BOOTSTRAP_TOKEN ||= crypto.randomBytes(48).toString('base64url');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const {
  getSystemPermissions,
  getConfiguredSuperAdminEmail
} = require('../src/controllers/systemController');

const createResponse = () => ({
  statusCode: null,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  }
});

const run = async () => {
  process.env.SUPER_ADMIN_EMAIL = ' Initial.Admin@Example.TEST ';
  assert.equal(getConfiguredSuperAdminEmail(), 'initial.admin@example.test');

  let response = createResponse();
  await getSystemPermissions({
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'admin',
      is_super_admin: true,
      email: 'initial.admin@example.test'
    }
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.super_admin_email, 'initial.admin@example.test');
  assert.equal(response.payload.is_super_admin, true);

  delete process.env.SUPER_ADMIN_EMAIL;
  assert.equal(getConfiguredSuperAdminEmail(), null);
  response = createResponse();
  await getSystemPermissions({
    user: {
      role: 'user',
      is_super_admin: false,
      email: 'user@example.test'
    }
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.super_admin_email, null);
  assert.equal(response.payload.is_super_admin, false);

  [
    '../src/controllers/systemController',
    '../src/controllers/cloudBackupController',
    '../src/services/cloudBackupService',
    '../src/services/cloudBackupSettingsService',
    '../src/services/cloudBackupScheduler'
  ].forEach((modulePath) => assert.doesNotThrow(() => require(modulePath)));

  const serverSource = read('src/server.js');
  const authRoutesSource = read('src/routes/authRoutes.js');
  const dockerfileSource = read('Dockerfile');
  const composeSource = read('../docker-compose.yml');
  const updaterSource = read('../scripts/update.sh');
  const packageManifest = JSON.parse(read('package.json'));
  assert.match(serverSource, /app\.use\('\/api\/auth\/login', authenticationLimiter\)/);
  assert.match(serverSource, /app\.use\('\/api\/system\/update', systemUpdateLimiter\)/);
  assert.doesNotMatch(serverSource, /app\.use\('\/api\/cloud-backup', sensitiveOperationLimiter\)/);
  assert.match(authRoutesSource, /router\.post\('\/login', authController\.login\)/);
  assert.match(authRoutesSource, /router\.get\('\/me', verifyToken, authController\.me\)/);
  assert.match(authRoutesSource, /router\.get\('\/bootstrap\/status', authController\.bootstrapStatus\)/);
  ['@aws-sdk/client-s3', '@aws-sdk/lib-storage', 'basic-ftp'].forEach((dependency) => {
    assert.ok(packageManifest.dependencies[dependency], `Dependência ausente no backend: ${dependency}`);
  });
  assert.match(dockerfileSource, /COPY package\*\.json \.\//);
  assert.match(dockerfileSource, /RUN npm install/);
  assert.match(updaterSource, /git pull --ff-only origin main/);
  assert.match(updaterSource, /compose up -d --build --remove-orphans/);
  assert.match(updaterSource, /APP_COMMIT="\$\(git rev-parse --short HEAD/);
  assert.match(composeSource, /VITE_APP_COMMIT: \$\{VITE_APP_COMMIT:-unknown\}/);
  const backendServiceBlock = composeSource.slice(
    composeSource.indexOf('  backend:'),
    composeSource.indexOf('  updater:')
  );
  const updaterServiceBlock = composeSource.slice(
    composeSource.indexOf('  updater:'),
    composeSource.indexOf('  frontend:')
  );
  assert.doesNotMatch(backendServiceBlock, /docker\.sock/);
  assert.match(updaterServiceBlock, /docker\.sock/);
  assert.equal((composeSource.match(/\/var\/run\/docker\.sock:/g) || []).length, 1);

  console.log('System permissions and runtime import tests passed.');
};

run()
  .then(() => require('../src/config/database').pool.end())
  .catch(async (error) => {
    console.error(error);
    await require('../src/config/database').pool.end();
    process.exitCode = 1;
  });
