import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const app = read('src/App.jsx');
const login = read('src/pages/Login.jsx');
const forgotPassword = read('src/pages/ForgotPassword.jsx');
const resetPassword = read('src/pages/ResetPassword.jsx');
const resetCrypto = read('src/services/passwordResetCryptoService.js');
const api = read('src/services/api.js');
const teamList = read('src/pages/TeamList.jsx');

assert.match(app, /path="\/forgot-password"/);
assert.match(app, /path="\/reset-password"/);
assert.match(login, /onClick=\{\(\) => navigate\('\/forgot-password'\)\}/);
assert.match(login, /Esqueceu a senha\?/);
assert.match(forgotPassword, /Se o e-mail estiver cadastrado, enviaremos instruções para recuperação de acesso\./);
assert.doesNotMatch(forgotPassword, /usuário encontrado|e-mail não cadastrado/i);

assert.match(resetPassword, /Esta recuperação redefine o acesso à conta, mas não recupera sua senha mestre antiga\./);
assert.match(resetPassword, /Códigos de recuperação servem para validar MFA/);
assert.match(resetPassword, /RESETAR ACESSO/);
assert.match(resetPassword, /validation\.requires_mfa/);
assert.match(resetPassword, /recovery_code: mfaCode/);
assert.match(resetPassword, /mfa_code: mfaCode/);
assert.match(resetPassword, /window\.history\.replaceState\(null, '', '\/reset-password'\)/);
assert.match(resetPassword, /clearSensitiveState\(\)/);
assert.doesNotMatch(resetPassword, /localStorage|sessionStorage|indexedDB/);
assert.doesNotMatch(resetPassword, /console\.(?:log|warn|error)/);

assert.match(resetCrypto, /generateMasterKey\(\)/);
assert.match(resetCrypto, /generateRSAKeyPair\(\)/);
assert.match(resetCrypto, /encryptPrivateKey\(keyPair\.privateKey, userKey\)/);
assert.match(resetCrypto, /wrapMasterKey\(userKey, kek\)/);
assert.match(resetCrypto, /crypto_salt: cryptoSalt/);
assert.doesNotMatch(resetCrypto, /localStorage|sessionStorage|indexedDB/);
assert.doesNotMatch(resetCrypto, /api\.|axios|fetch\(/);
assert.doesNotMatch(resetCrypto, /console\.(?:log|warn|error)/);

assert.match(api, /\/auth\/password-reset\/request/);
assert.match(api, /\/auth\/password-reset\/validate/);
assert.match(api, /\/auth\/password-reset\/complete/);
assert.match(teamList, /o usuário deve usar “Esqueceu a senha\?” na tela de login/);
assert.doesNotMatch(teamList, /payload\.password = editUser\.password/);

console.log('Zero-knowledge password reset frontend tests passed.');
