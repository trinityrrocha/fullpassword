// Offline Compose model test: no daemon, real .env, image pull or containers.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { validateReleaseCompose } = require('../../scripts/deploy-approved-release');
const root = path.resolve(__dirname, '../..');
const origin = 'https://example.invalid';
const env = { ...process.env, APP_ORIGIN: origin, SUPER_ADMIN_EMAIL: 'test@example.invalid',
  DB_USER: 'fixture_owner', DB_NAME: 'fixture', DB_PASSWORD: 'fixture-owner-only',
  RUNTIME_DB_USER: 'fixture_runtime', RUNTIME_DB_PASSWORD: 'fixture-runtime-only',
  JWT_SECRET: 'fixture-jwt', ADMIN_BOOTSTRAP_TOKEN: 'fixture-bootstrap',
  RELEASE_BACKEND_IMAGE: 'ghcr.io/trinityrrocha/fullpassword-backend@sha256:' + 'a'.repeat(64),
  RELEASE_FRONTEND_IMAGE: 'ghcr.io/trinityrrocha/fullpassword-frontend@sha256:' + 'b'.repeat(64) };
const overlay = 'docker-compose.release-agent.yml';
function render(files, input) {
  return JSON.parse(execFileSync('docker', ['compose', '--project-directory', root, '--env-file',
    process.platform === 'win32' ? 'NUL' : '/dev/null', ...files.flatMap(f => ['-f',f]),
    '--profile','operator','config','--format','json'], {cwd:root, env, input, encoding:'utf8'}));
}
const base = readFileSync(path.join(root,'docker-compose.yml'),'utf8');
// Only remove backend safeguards from a fixture; keep db, network and roles realistic.
const legacy = base.replace(/(  backend:\r?\n)([\s\S]*?)(?=^  \w[\w-]*:\s*$)/m, (_, header, body) =>
  header + body.replace(/^    (?:read_only|cap_drop|security_opt|tmpfs):[^\n]*\n(?:      - [^\n]*\n)*/gm,''));
const keys = ['read_only','cap_drop','security_opt','tmpfs'];
for (const key of keys) assert.equal(render(['-'],legacy).services.backend[key], undefined);
for (const input of [base,legacy]) {
  const model = render(['-',overlay],input);
  const b = model.services.backend;
  assert.equal(b.read_only,true);
  assert.ok(b.cap_drop.includes('ALL') && b.security_opt.includes('no-new-privileges:true'));
  assert.ok(b.tmpfs.includes('/tmp:rw,noexec,nosuid,size=512m'));
  const check = m => validateReleaseCompose(m,{origin,migrateSchema:true});
  check(model);
  for (const key of keys) {
    const invalid = structuredClone(model);
    delete invalid.services.backend[key];
    assert.throws(()=>check(invalid), /HARDENED_RUNTIME_REQUIRED/);
  }
}
console.log('PASS: current and legacy bases; all four missing-control cases rejected');
