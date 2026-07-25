import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const login = read('frontend/src/pages/Login.jsx');
const resetPassword = read('frontend/src/pages/ResetPassword.jsx');
const recoveryPanel = read('frontend/src/components/RecoveryCodesPanel.jsx');
const profile = read('frontend/src/components/UserProfileModal.jsx');
const authContext = read('frontend/src/context/AuthContext.jsx');

assert.match(login, /Não tenho acesso ao aplicativo autenticador — usar código de recuperação/);
assert.match(login, /Perdeu acesso ao aplicativo autenticador\? Use um código de recuperação\./);
assert.match(login, /setUseRecoveryCode\(\(value\) => !value\)/);
assert.match(login, /verifyMfaLogin\(mfaFlow\.challenge_token/);
assert.match(login, /const finishRecoveryCodeReview = \(\) => \{[\s\S]*setRecoveryCodes\(\[\]\)/);
assert.match(authContext, /recovery_code: recoveryCode \|\| undefined/);

assert.match(resetPassword, /Usar código de recuperação MFA/);
assert.match(resetPassword, /O código de recuperação valida seu MFA\./);
assert.match(resetPassword, /Ele não recupera sua senha antiga e não descriptografa cofres\./);
assert.match(resetPassword, /useRecoveryCode \? \{ recovery_code: mfaCode \} : \{ mfa_code: mfaCode \}/);

assert.match(recoveryPanel, /FullPassword — Códigos de Recuperação MFA/);
assert.match(recoveryPanel, /Use-os apenas se você perder acesso ao aplicativo autenticador\./);
assert.match(recoveryPanel, /Cada código pode ser usado apenas uma vez\./);
assert.match(recoveryPanel, /não recuperam sua senha mestre, não descriptografam cofres e não substituem sua senha/);
assert.match(recoveryPanel, /new jsPDF/);
assert.match(recoveryPanel, /document\.save\(`fullpassword-recovery-codes-/);

assert.match(profile, /Códigos de recuperação restantes:/);
assert.match(profile, /Você tem poucos códigos de recuperação restantes\./);
assert.match(profile, /Regenerar códigos de recuperação/);
assert.match(profile, /setRecoveryCodes\(\[\]\)/);
assert.match(profile, /useClearOnVaultLock/);

for (const [name, source] of [
  ['RecoveryCodesPanel', recoveryPanel],
  ['Login', login],
  ['ResetPassword', resetPassword],
  ['UserProfileModal', profile]
]) {
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage|indexedDB).*recovery/i, `${name} must not persist recovery codes`);
  assert.doesNotMatch(source, /console\.(?:log|warn|error).*recovery/i, `${name} must not log recovery codes`);
}

console.log('MFA recovery code frontend tests passed.');
