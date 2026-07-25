import {
  deriveMasterKey,
  encryptPrivateKey,
  exportPublicKey,
  generateRSAKeyPair,
  resolveKdfParams,
  unwrapMasterKey
} from './cryptoService.js';

export const hasUserCryptoIdentity = (user) => Boolean(
  user?.public_key && user?.encrypted_private_key
);

export const ensureUserCryptoIdentity = async ({
  user,
  password,
  saveIdentity
}) => {
  if (!user) throw new Error('Usuário não autenticado.');
  if (hasUserCryptoIdentity(user)) return { user, created: false };
  if (
    !password
    || !user.wrapped_key
    || !user.crypto_salt
    || typeof saveIdentity !== 'function'
  ) {
    throw new Error('Não foi possível inicializar a identidade criptográfica da conta.');
  }

  const transientCryptoMaterial = [];
  try {
    const kek = await deriveMasterKey(
      password,
      user.crypto_salt,
      resolveKdfParams(user)
    );
    transientCryptoMaterial.push(kek);

    const operationalUserKey = await unwrapMasterKey(user.wrapped_key, kek);
    transientCryptoMaterial.push(operationalUserKey);

    const keyPair = await generateRSAKeyPair();
    transientCryptoMaterial.push(keyPair.privateKey);

    const publicKey = await exportPublicKey(keyPair.publicKey);
    const encryptedPrivateKey = await encryptPrivateKey(
      keyPair.privateKey,
      operationalUserKey
    );
    const response = await saveIdentity({
      public_key: publicKey,
      encrypted_private_key: encryptedPrivateKey
    });

    return {
      created: true,
      user: {
        ...user,
        public_key: publicKey,
        encrypted_private_key: encryptedPrivateKey,
        ...(response?.key_metadata || {})
      }
    };
  } finally {
    // CryptoKeys não podem ser sobrescritas pela Web Crypto API. Remover todas
    // as referências locais garante que o material transitório seja coletável.
    transientCryptoMaterial.length = 0;
  }
};
