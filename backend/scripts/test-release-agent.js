const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {approval,readRequest,processRequest}=require('../../scripts/release-agent');
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
const manifest=Buffer.from(JSON.stringify({repository:'trinityrrocha/fullpassword',revision:'a'.repeat(40),origin:'https://audit.example.invalid',backend:'ghcr.io/trinityrrocha/fullpassword-backend@sha256:'+'b'.repeat(64),frontend:'ghcr.io/trinityrrocha/fullpassword-frontend@sha256:'+'c'.repeat(64)}));
const signature=crypto.sign('sha256',manifest,keys.privateKey);
const policy={approvedRevision:'a'.repeat(40),environment:'test',origin:'https://audit.example.invalid',approvalId:crypto.randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),manifestFile:'manifest',signatureFile:'signature',publicKeyFile:'public'};
const read=file=>({manifest,signature,public:keys.publicKey}[file]);
async function run(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fp-agent-test-'));
 try {
  const release=approval(policy,read),request={approvalId:release.approvalId,revision:release.revision,manifestHash:release.manifestHash,requestId:crypto.randomUUID()};
  const file=path.join(directory,'request.json');
  fs.writeFileSync(file,JSON.stringify(request));
  assert.deepEqual(readRequest(file),request);
  for(const extra of [{command:'rm -rf /'},{path:'../../evil'},{url:'https://evil.example.invalid'}]){
   fs.writeFileSync(file,JSON.stringify({...request,...extra}));
   assert.throws(()=>readRequest(file),/INVALID_REQUEST/);
  }
  fs.writeFileSync(file,'x'.repeat(1025));assert.throws(()=>readRequest(file),/INVALID_REQUEST_FILE/);
  assert.throws(()=>approval({...policy,expiresAt:'invalid'},read),/APPROVAL_EXPIRED/);
  assert.throws(()=>approval({...policy,approvedRevision:'d'.repeat(40)},read),/RELEASE_NOT_APPROVED/);
  assert.throws(()=>approval(policy,file=>file==='signature'?Buffer.alloc(signature.length):read(file)),/INVALID_RELEASE_SIGNATURE/);
  let deployed=0,verified=0,waited=0;
  const options={policy,request,state:directory,status:directory,read,performDeploy:()=>{deployed++;},verify:()=>{verified++;},wait:async ms=>{waited=ms;}};
  await processRequest(options);
  assert.equal(deployed,1);assert.equal(verified,1);assert.equal(waited,60000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'status.json'))).state,'completed');
  await assert.rejects(processRequest(options),e=>e.code==='EEXIST');assert.equal(deployed,1);
  const second={...policy,approvalId:crypto.randomUUID()};
  await assert.rejects(processRequest({...options,policy:second,request:{...request,approvalId:second.approvalId},performDeploy:()=>{throw Error('secret log must not leak');}}),/DEPLOYMENT_FAILED/);
  const failed=JSON.parse(fs.readFileSync(path.join(directory,'status.json')));
  assert.equal(failed.state,'recovery_required');assert.equal(failed.errorCode,'DEPLOYMENT_FAILED');assert.ok(!JSON.stringify(failed).includes('secret'));
  // Crash simulation: durable consumed approval exists with no completed status. Never redeploy it.
  await assert.rejects(processRequest({...options,policy:second,request:{...request,approvalId:second.approvalId}}),e=>e.code==='EEXIST');
  const third={...policy,approvalId:crypto.randomUUID()};
  await assert.rejects(processRequest({...options,policy:third,request:{...request,approvalId:third.approvalId,manifestHash:'0'.repeat(64)}}),/REQUEST_NOT_APPROVED/);
  console.log('PASS agent: signature, approval/expiry, strict requests, one-use durable ledger, exact 60s window, failure/replay.');
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
