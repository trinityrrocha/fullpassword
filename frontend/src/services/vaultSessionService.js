import { createVaultEpoch, openVaultEnvelope, encryptVaultRecord, decryptVaultRecord } from './vaultCryptoV2.js';
import { decryptVaultKeyShare } from './clientVaultKeyService.js';
import { decryptData } from './cryptoService.js';

const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
};
const collectionNames = new Set(['cpanels','servers','users','sshCredentials','devices','deviceLogins']);
const metadata = (vaultId,row) => ({vaultId,recordId:row.id,category:row.category+'/'+row.collection+'/'+row.entity_id,epoch:row.epoch,revision:row.revision});
const recordIdentity = row => JSON.stringify([row.category,row.collection,row.entity_id]);
const split = (category,data,seed='') => {
  const rows=[], config={};
  for (const [name,value] of Object.entries(data)) {
    if (collectionNames.has(name) && Array.isArray(value)) {
      for (const [index,item] of value.entries()) {
        if (!item || typeof item!=='object' || Array.isArray(item)) throw new Error('Registro inválido.');
        const id=String(item.id || (seed ? seed+'-'+name+'-'+index : crypto.randomUUID()));
        rows.push({category,collection:name,entity_id:id,data:{...item,id}});
      }
    } else config[name]=value;
  }
  // Only meaningful non-collection fields form a separate record.
  if(Object.keys(config).length) rows.push({category,collection:'__config',entity_id:'root',data:config});
  const identities=rows.map(recordIdentity);
  if(new Set(identities).size!==identities.length) throw new Error('IDs de registro duplicados.');
  return rows;
};

/** Used by ClientVault AND HTTP integration tests. Holds plaintext/keys only in memory. */
export class VaultSession {
  constructor({api,vaultId,user,keys}) {
    this.api=api; this.id=vaultId; this.user=user; this.keys=keys; this.rows=[]; this.key=null;
  }
  path(suffix='') { return '/crypto/vaults/'+this.id+suffix; }
  clear() { this.key=null; this.keys=null; this.rows=[]; this.state=null; }
  async readState() { return (await this.api.get(this.path())).data; }
  async openEnvelope(envelopes,epoch) {
    const envelope=Array.isArray(envelopes) ? envelopes.find(e=>e.userId===this.user.id) : envelopes;
    if(!envelope) throw new Error('Chave pendente. O proprietário precisa renovar o compartilhamento.');
    return openVaultEnvelope(this.keys.privateKey,envelope,{vaultId:this.id,epoch,userId:this.user.id,fingerprint:this.user.crypto_identity.fingerprint});
  }
  async decode(rows,key) {
    const result=[];
    for(const row of rows) {
      const data=await decryptVaultRecord(key,metadata(this.id,row),row.envelope);
      if(row.category!=='__history') {
        if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Conteúdo de registro inválido.');
        if(row.collection==='__config') {
          if(Object.keys(data).some(k=>collectionNames.has(k))) throw new Error('Configuração não pode substituir coleções.');
        } else if(String(data.id)!==row.entity_id) throw new Error('Vínculo de registro inválido.');
      }
      result.push({...row,data});
    }
    return result;
  }
  async legacyRows(state) {
    if(state.records.length && !this.keys.legacyMasterKey) throw new Error('Material de recuperação legado indisponível. Nenhum dado foi alterado.');
    let legacyKey=this.keys.legacyMasterKey;
    if(state.records.length && this.keys.legacyEncryptedPrivateKey) {
      const shared=(await this.api.get('/vault-items/'+this.id+'/key-share')).data.encrypted_client_key;
      if(shared) legacyKey=await decryptVaultKeyShare(shared,this.keys.legacyEncryptedPrivateKey,this.keys.legacyMasterKey);
    }
    const latest=new Set(), result=[];
    for(const old of state.records) {
      const data=await decryptData(old.encrypted_data,legacyKey);
      const attachment=old.encrypted_attachment ? await decryptData(old.encrypted_attachment,legacyKey) : null;
      // All old versions are preserved under the new vault key, not only the latest snapshot.
      result.push({id:crypto.randomUUID(),category:'__history',collection:'snapshots',entity_id:old.id,revision:1,deleted:false,
        data:{sourceId:old.id,category:old.category,createdAt:old.created_at,data,attachment}});
      if(!latest.has(old.category)) {
        latest.add(old.category);
        for(const row of split(old.category,data,old.id)) result.push({...row,id:crypto.randomUUID(),revision:1,deleted:false});
      }
    }
    return result;
  }
  async migrateOrRotate(shares) {
    let state=await this.readState();
    if(state.ownerId!==this.user.id) throw new Error('O proprietário precisa migrar ou renovar este cofre.');
    const original=state.epoch ? await this.decode(state.records,await this.openEnvelope(state.envelope,state.epoch)) : await this.legacyRows(state);
    if(!state.stage) {
      const directory=(await this.api.post(this.path('/recipients'),shares ? {shares} : {})).data;
      const next=await createVaultEpoch(this.id,state.epoch+1,directory.recipients);
      await this.api.post(this.path('/stages'),{sourceHash:state.sourceHash,recordCount:original.length,records:[],envelopes:next.envelopes,shares:directory.shares});
      state=await this.readState();
    }
    let stage=state.stage;
    if(!stage || stage.source_hash!==state.sourceHash) throw new Error('A origem mudou. Cancele a migração pendente e tente novamente.');
    const stagingKey=await this.openEnvelope(stage.envelopes,stage.target_epoch);
    const persisted=new Map(stage.records.map(row=>[recordIdentity(row),row]));
    let chunk=[],size=0;
    const flush=async()=>{
      if(!chunk.length)return;
      await this.api.post(this.path('/stages/'+stage.id+'/records'),{records:chunk});
      chunk=[];size=0;
    };
    for(const old of original) {
      if(persisted.has(recordIdentity(old))) continue;
      const row={id:old.id,category:old.category,collection:old.collection,entity_id:old.entity_id,revision:old.revision,deleted:!!old.deleted,epoch:stage.target_epoch};
      row.envelope=await encryptVaultRecord(stagingKey,metadata(this.id,row),old.data);
      const bytes=JSON.stringify(row).length;
      if(chunk.length && (size+bytes>6*1024*1024 || chunk.length>=500)) await flush();
      chunk.push(row);size+=bytes;
    }
    await flush();
    stage=(await this.readState()).stage;
    const candidateKey=await this.openEnvelope(stage.envelopes,stage.target_epoch);
    const verified=await this.decode(stage.records,candidateKey);
    if(state.epoch) {
      const byId=new Map(original.map(r=>[r.id,r]));
      if(verified.length!==original.length || verified.some(r=>canonical(r.data)!==canonical(byId.get(r.id)?.data))) throw new Error('Falha na verificação da rotação.');
    } else {
      // IDs may differ after a restart; compare authenticated source IDs and every decoded payload.
      const sorted=rows=>rows.map(r=>canonical([r.category,r.collection,r.entity_id,r.data])).sort();
      if(canonical(sorted(verified))!==canonical(sorted(original))) throw new Error('Falha na verificação da migração. Originais preservados.');
    }
    await this.api.post(this.path('/stages/'+stage.id+'/activate'),{verifiedManifestHash:stage.manifest_hash});
    return this.load();
  }
  async abortMigration() {
    const state=await this.readState();
    if(state.stage) await this.api.delete(this.path('/stages/'+state.stage.id));
  }
  async load() {
    this.state=await this.readState();
    if(!this.state.epoch || this.state.rotationRequired) return this.migrateOrRotate();
    this.key=await this.openEnvelope(this.state.envelope,this.state.epoch);
    this.rows=await this.decode(this.state.records,this.key);
    return this;
  }
  categories() {
    const result=new Map();
    for(const row of this.rows) {
      if(row.deleted || row.category==='__history') continue;
      const data=result.get(row.category) || {};
      if(row.collection==='__config') Object.assign(data,clone(row.data));
      else { data[row.collection] ||= []; data[row.collection].push(clone(row.data)); }
      result.set(row.category,data);
    }
    return [...result.entries()].map(([category,decrypted])=>({id:category,category,decrypted}));
  }
  async saveCategory(category,data) {
    if(!this.key || !this.state) throw new Error('Cofre bloqueado.');
    const before=this.rows.filter(r=>r.category===category && !r.deleted);
    const byIdentity=new Map(before.map(r=>[recordIdentity(r),r]));
    const after=split(category,data), remaining=new Set(before.map(r=>r.id)), mutations=[];
    for(const row of after) {
      const old=byIdentity.get(recordIdentity(row));
      if(old) remaining.delete(old.id);
      if(old && canonical(old.data)===canonical(row.data)) continue;
      const next={...row,id:old?.id || crypto.randomUUID(),revision:(old?.revision || 0)+1,epoch:this.state.epoch};
      mutations.push({...next,data:undefined,kind:old?'update':'create',expectedRevision:old?.revision,envelope:await encryptVaultRecord(this.key,metadata(this.id,next),next.data)});
    }
    for(const id of remaining) mutations.push({kind:'delete',id,expectedRevision:before.find(r=>r.id===id).revision});
    if(!mutations.length) return;
    await this.api.post(this.path('/records'),{epoch:this.state.epoch,revision:this.state.revision,mutations});
    await this.load();
  }
}
