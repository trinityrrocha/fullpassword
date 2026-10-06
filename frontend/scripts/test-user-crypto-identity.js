import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const authContext = read('src/context/AuthContext.jsx');
const login = read('src/pages/Login.jsx');
const setupModal = read('src/components/UserCryptoIdentitySetup.jsx');
const sharingManager = read('src/components/VaultSharingManager.jsx');
const clientsList = read('src/pages/ClientsList.jsx');

const unlockVaultSection = authContext.slice(
  authContext.indexOf('const unlockVault'),
  authContext.indexOf('const encryptOwnerVaultKeyForPublicKeys')
);

assert.match(authContext, /ensureUserCryptoIdentity\(\{[\s\S]*user,[\s\S]*password, unlockSecret, mfaCode/);
assert.doesNotMatch(authContext.slice(authContext.indexOf('const login ='),authContext.indexOf('const verifyMfaLogin')), /ensureUserCryptoIdentity/);
assert.match(authContext, /cryptoIdentitySetupRequired: !hasUserCryptoIdentity\(data\.user\)/);
assert.match(authContext, /ensureCurrentUserCryptoIdentity/);
assert.doesNotMatch(unlockVaultSection, /generateRSAKeyPair|exportPublicKey|encryptPrivateKey|\/users\/keys/);

assert.match(login, /const submittedPassword = password;\s+setPassword\(''\);\s+const result = await login/);
assert.match(setupModal, /values\.get\('master_password'\)/);
assert.match(setupModal, /form\.reset\(\)/);
assert.doesNotMatch(setupModal, /\[password,\s*setPassword\]/);
assert.match(setupModal, /Configuração de segurança necessária/);
assert.match(setupModal, /segredo de desbloqueio diferente da senha de login/);

assert.doesNotMatch(
  sharingManager,
  /desbloquear o cofre uma vez|desbloquearem o cofre|entrar e desbloquear o cofre/
);
assert.match(
  sharingManager,
  /saveCryptoShares\(cleanedShares\)/
);
assert.match(
  clientsList,
  /Nenhum cofre disponível para sua conta\. Quando um cofre for compartilhado com você, ele aparecerá aqui\./
);

console.log('User crypto identity bootstrap tests passed.');
