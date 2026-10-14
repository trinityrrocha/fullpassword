import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { ensureUserCryptoIdentity } from '../src/services/userCryptoIdentityService.js';

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

// Execute the actual JSX with the existing context, not a duplicate test component.
const vite = await createServer({
  root: frontendRoot, server: { middlewareMode: true }, appType: 'custom',
  plugins: [{name:'expose-identity-context-for-test',enforce:'pre',transform(code,id) {
    if(id.endsWith('/AuthContext.jsx')) return code+'\nexport { AuthContext };';
    return null;
  }}]
});
try {
  const { default: Setup } = await vite.ssrLoadModule('/src/components/UserCryptoIdentitySetup.jsx');
  const { AuthContext } = await vite.ssrLoadModule('/src/context/AuthContext.jsx');
  for(const enabled of [false,undefined,null,true]) {
    const user={id:'synthetic-user',mfa_enabled:enabled,mfa_required:true,must_change_password:false};
    const html=renderToStaticMarkup(createElement(AuthContext.Provider,{value:{user}},createElement(Setup)));
    assert.equal(html.includes('Código MFA atual'),enabled===true);
    assert.equal(html.includes('name="mfa_code"'),enabled===true);
    for(const name of ['master_password','unlock_secret','unlock_confirm']) assert(html.includes(`name="${name}"`));
  }
  assert.match(setupModal,/const mfaEnabled = user\?\.mfa_enabled === true/);
  assert.match(setupModal,/const mfaCode = mfaEnabled \? String\(values\.get\('mfa_code'\) \|\| ''\) : undefined/);
  const requestJson=JSON.stringify({identity:{version:2},current_password:'SYNTHETIC',mfa_code:undefined});
  assert(!requestJson.includes('mfa_code'),'disabled MFA is omitted by the existing API JSON serialization');
  for(const enabled of [false,true]) {
    let sent;
    await ensureUserCryptoIdentity({user:{id:crypto.randomUUID(),mfa_enabled:enabled},password:'SYNTHETIC_LOGIN',unlockSecret:'SYNTHETIC_INDEPENDENT_UNLOCK_SECRET',
      mfaCode:enabled?'SYNTHETIC_FACTOR':undefined,saveIdentity:async payload=>{sent=JSON.parse(JSON.stringify(payload));return {identity:payload.identity};}});
    assert.equal(Object.hasOwn(sent,'mfa_code'),enabled);
    assert(!JSON.stringify(sent).includes('SYNTHETIC_INDEPENDENT_UNLOCK_SECRET'));
  }
  const update=read('src/components/UpdateStatusPanel.jsx');
  assert.doesNotMatch(update,/auth\/reauth|_reauth_token|A atualização exige senha/);
  assert.match(update,/Somente o Super Admin pode solicitar uma release previamente aprovada/);
  console.log('PASS actual identity JSX: MFA field/label absent when disabled/unknown, shown only for true; mfa_required alone does not show it.');
} finally { await vite.close(); }
console.log('User crypto identity bootstrap tests passed.');
