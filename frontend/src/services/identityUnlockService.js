import { independentIdentityHash, rewrapIndependentIdentityUnlock } from './vaultCryptoV2.js';
import {passwordMinimum} from './passwordPolicy.js';

export async function changeIdentityUnlockSecret({api, identity, currentSecret, newSecret, confirmation, loginPassword, mfaCode, policy = {vault_min_length:16}}) {
  if (!loginPassword) throw new Error('Informe a senha atual do perfil para confirmar sua identidade.');
  if (newSecret !== confirmation) throw new Error('As novas senhas dos cofres não coincidem.');
  if (newSecret === loginPassword) throw new Error('A senha dos cofres deve ser diferente da senha do perfil.');
  const next = await rewrapIndependentIdentityUnlock(identity, currentSecret, newSecret, passwordMinimum(policy,'vault'));
  const action = {expectedIdentityHash:await independentIdentityHash(identity),kdf:next.kdf,salt:next.salt,wrappedMasterKey:next.wrappedMasterKey};
  // Only the login credential goes to the existing reauth service. No unlock secrets in either request.
  const {data:grant} = await api.post('/auth/reauth', {purpose:'crypto_unlock_secret_change',action,current_password:loginPassword,mfa_code:mfaCode || undefined});
  return (await api.put('/crypto/identity/unlock-secret', {...action,_reauth_token:grant.token})).data.identity;
}
