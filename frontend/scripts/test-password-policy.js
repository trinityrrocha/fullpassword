import assert from 'node:assert/strict';
import {MIN_LENGTH_OPTIONS,passwordMinimum} from '../src/services/passwordPolicy.js';
import * as v2 from '../src/services/vaultCryptoV2.js';
import {profilePasswordPayload} from '../src/services/profilePasswordService.js';
import {changeIdentityUnlockSecret} from '../src/services/identityUnlockService.js';
let current='Aa1!xxxx';
let identity=await v2.createIndependentIdentity('synthetic-policy-user',current,8);
const original=structuredClone(identity);
const epoch=await v2.createVaultEpoch('synthetic-policy-vault',1,[identity]);
const envelope=epoch.envelopes[0];
const metadata={vaultId:'synthetic-policy-vault',epoch:1,recordId:'record',category:'VPN',revision:1};
const record=await v2.encryptVaultRecord(epoch.key,metadata,{value:'SYNTHETIC_EXISTING_RECORD'});
for(const minimum of MIN_LENGTH_OPTIONS){
  assert.equal(passwordMinimum({vault_min_length:minimum},'vault'),minimum);
  const nextSecret='Bb2!'+String(minimum).padEnd(minimum-4,'y');
  await assert.rejects(v2.rewrapIndependentIdentityUnlock(identity,current,'x'.repeat(minimum-1),minimum));
  const calls=[];
  const api={post:async(url,data)=>{calls.push({url,data});return {data:{token:'SYNTHETIC_GRANT'}};},put:async(url,data)=>{
    calls.push({url,data});return {data:{identity:{...identity,kdf:data.kdf,salt:data.salt,wrappedMasterKey:data.wrappedMasterKey}}};
  }};
  const next=await changeIdentityUnlockSecret({api,identity,currentSecret:current,newSecret:nextSecret,confirmation:nextSecret,loginPassword:'SYNTHETIC_LOGIN_ONLY',policy:{vault_min_length:minimum}});
  for(const secret of [current,nextSecret])assert(!JSON.stringify(calls).includes(secret));
  for(const field of ['publicKey','fingerprint','encryptedPrivateKey'])assert.deepEqual(next[field],original[field]);
  await assert.rejects(v2.unlockIndependentIdentity(next,current));
  const keys=await v2.unlockIndependentIdentity(next,nextSecret);
  const key=await v2.openVaultEnvelope(keys.privateKey,envelope,envelope);
  assert.deepEqual(await v2.decryptVaultRecord(key,metadata,record),{value:'SYNTHETIC_EXISTING_RECORD'});
  await assert.rejects(profilePasswordPayload({name:'Synthetic',email:'synthetic@example.invalid',crypto_identity:identity},'old','x'.repeat(minimum-1),'x'.repeat(minimum-1),{login_min_length:minimum}));
  await profilePasswordPayload({name:'Synthetic',email:'synthetic@example.invalid',crypto_identity:identity},'old','x'.repeat(minimum),'x'.repeat(minimum),{login_min_length:minimum});
  identity=next;current=nextSecret;
}
for(const value of [9,100,null,'12'])assert.throws(()=>passwordMinimum({vault_min_length:value},'vault'));
console.log('PASS policy minima 8/12/16/20, local rewrap, old/new secret, unchanged identity/envelope/data, no unlock secrets in requests.');
