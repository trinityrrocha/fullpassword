import { openVaultEnvelope, decryptVaultRecord } from './vaultCryptoV2.js';

export const openSharedItem = async ({api,itemId,user,keys,signal}) => {
  if (!keys?.privateKey) throw new Error('IDENTITY_LOCKED');
  const {data:item} = await api.get('/crypto/shared-items/'+itemId, {signal});
  if (item.id !== itemId) throw new Error('ITEM_CONTEXT_MISMATCH');
  const key = await openVaultEnvelope(keys.privateKey,item.key_envelope,{
    vaultId:itemId,epoch:1,userId:user.id,fingerprint:user.crypto_identity.fingerprint
  });
  const snapshot = await decryptVaultRecord(key,{
    vaultId:itemId,recordId:itemId,category:'legacy-item',epoch:1,revision:1
  },item.envelope);
  if (snapshot.sourceId !== itemId || snapshot.category !== item.category) throw new Error('ITEM_CONTEXT_MISMATCH');
  return snapshot;
};
