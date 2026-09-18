import { deriveMasterKey, resolveKdfParams, unwrapMasterKeyForTransientUse } from './cryptoService.js';
import { createIndependentIdentity, unlockIndependentIdentity, sealLegacyArchive, openLegacyArchive } from './vaultCryptoV2.js';

export const hasUserCryptoIdentity = user => user?.crypto_identity?.version === 2;
export const ensureUserCryptoIdentity = async ({user,password,unlockSecret,saveIdentity,mfaCode}) => {
  if (!user) throw new Error('Usuário não autenticado.');
  if (hasUserCryptoIdentity(user)) return {user,created:false};
  if (!unlockSecret || unlockSecret.length < 16 || unlockSecret === password) {
    throw new Error('Use um segredo de desbloqueio diferente da senha de login, com pelo menos 16 caracteres.');
  }
  const identity = await createIndependentIdentity(user.id,unlockSecret);
  const keys = await unlockIndependentIdentity(identity,unlockSecret);
  if (user.wrapped_key) {
    const kek = await deriveMasterKey(password,user.crypto_salt,resolveKdfParams(user));
    const legacyKey = await unwrapMasterKeyForTransientUse(user.wrapped_key,kek,'rewrap');
    const bytes = new Uint8Array(await crypto.subtle.exportKey('raw',legacyKey));
    try {
      identity.legacyArchive = await sealLegacyArchive(keys.masterKey,user.id,{
        masterKey:btoa(String.fromCharCode(...bytes)), encryptedPrivateKey:user.encrypted_private_key || null,
        publicKey:user.public_key || null
      });
    } finally { bytes.fill(0); }
  }
  // Only authentication password is submitted. unlockSecret never leaves this function.
  const response = await saveIdentity({identity,current_password:password,mfa_code:mfaCode || undefined});
  return {created:true,user:{...user,crypto_identity:response.identity},keys};
};

export const unlockUserIdentity = async (user,secret) => {
  const keys = await unlockIndependentIdentity(user.crypto_identity,secret);
  const archive = await openLegacyArchive(keys.masterKey,user.crypto_identity);
  if (archive) {
    const raw = Uint8Array.from(atob(archive.masterKey),c=>c.charCodeAt(0));
    try {
      keys.legacyMasterKey=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
      keys.legacyEncryptedPrivateKey=archive.encryptedPrivateKey;
    } finally { raw.fill(0); archive.masterKey=null; }
  }
  return keys;
};
