import {deriveMasterKey,resolveKdfParams,unwrapMasterKeyForTransientUse,wrapMasterKey,isValidCryptoSalt,KDF_PARAMS} from './cryptoService.js';
import {passwordMinimum} from './passwordPolicy.js';

export async function profilePasswordPayload(user, currentPassword, newPassword, confirmation, policy = {login_min_length:12}) {
  if (!currentPassword) throw new Error('A senha atual é obrigatória para alterar a senha.');
  if (newPassword !== confirmation) throw new Error('As novas senhas não coincidem.');
  const minimum=passwordMinimum(policy,'login');
  if (!newPassword || newPassword.length < minimum) throw new Error(`A nova senha deve ter pelo menos ${minimum} caracteres.`);
  const payload={name:user.name,email:user.email,current_password:currentPassword,new_password:newPassword};
  if (!user.crypto_identity && user.wrapped_key) {
    if (!isValidCryptoSalt(user.crypto_salt)) throw new Error('Não foi possível inicializar a chave criptográfica do usuário.');
    const currentKek=await deriveMasterKey(currentPassword,user.crypto_salt,resolveKdfParams(user));
    let transientMasterKey=await unwrapMasterKeyForTransientUse(user.wrapped_key,currentKek,'rewrap');
    try {
      payload.wrapped_key=await wrapMasterKey(transientMasterKey,await deriveMasterKey(newPassword,user.crypto_salt,KDF_PARAMS));
      Object.assign(payload,{kdf_version:KDF_PARAMS.version,kdf_name:KDF_PARAMS.name,kdf_hash:KDF_PARAMS.hash,kdf_iterations:KDF_PARAMS.iterations});
    } finally {
      // Deliberately release the exportable legacy rewrap reference immediately.
      // eslint-disable-next-line no-useless-assignment
      transientMasterKey=null;
    }
  }
  return payload;
}
