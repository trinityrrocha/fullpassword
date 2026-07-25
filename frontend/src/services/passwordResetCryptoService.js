import {
  KDF_PARAMS,
  RSA_KEY_PARAMS,
  deriveMasterKey,
  encryptPrivateKey,
  exportPublicKey,
  generateMasterKey,
  generateRSAKeyPair,
  wrapMasterKey
} from './cryptoService.js';

const randomHex = (byteLength) => {
  const bytes = window.crypto.getRandomValues(new Uint8Array(byteLength));
  try {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  } finally {
    bytes.fill(0);
  }
};

export const createPasswordResetCryptoIdentity = async (newPassword) => {
  if (typeof newPassword !== 'string' || !newPassword) {
    throw new Error('A nova senha é obrigatória.');
  }

  const transientCryptoMaterial = [];
  try {
    const cryptoSalt = randomHex(32);
    const kek = await deriveMasterKey(newPassword, cryptoSalt, KDF_PARAMS);
    transientCryptoMaterial.push(kek);

    const userKey = await generateMasterKey();
    transientCryptoMaterial.push(userKey);
    const wrappedKey = await wrapMasterKey(userKey, kek);

    const keyPair = await generateRSAKeyPair();
    transientCryptoMaterial.push(keyPair.privateKey);
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, userKey);

    return {
      crypto_salt: cryptoSalt,
      wrapped_key: wrappedKey,
      kdf_version: KDF_PARAMS.version,
      kdf_name: KDF_PARAMS.name,
      kdf_hash: KDF_PARAMS.hash,
      kdf_iterations: KDF_PARAMS.iterations,
      public_key: publicKey,
      encrypted_private_key: encryptedPrivateKey,
      rsa_key_size: RSA_KEY_PARAMS.modulusLength,
      rsa_key_version: RSA_KEY_PARAMS.version
    };
  } finally {
    // CryptoKeys não podem ser sobrescritas. Remover referências locais permite
    // que o material transitório seja coletado sem persistência no navegador.
    transientCryptoMaterial.length = 0;
  }
};
