// Dedicated child process used only by the disposable PostgreSQL integration test.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.DB_HOST,'127.0.0.1');
assert.ok(path.resolve(process.env.BACKUP_TEMP_DIR).startsWith(path.resolve(os.tmpdir())+path.sep+'fullpassword-audit-test-'));
const {createRestoreUploadGuard}=require('../src/middleware/restoreUploadGuard');
(async()=>{
 const req=new EventEmitter(),res=new EventEmitter();
 res.status=function(){return this;};res.json=()=>{throw new Error('Unexpected guard rejection');};
 let acquired=false;
 await createRestoreUploadGuard()(req,res,()=>{acquired=true;});
 assert.ok(acquired);
 const upload=path.join(process.env.BACKUP_TEMP_DIR,'uploads',crypto.randomUUID()+'.upload');
 await fs.writeFile(upload,'SYNTHETIC_INTERRUPTED_PROCESS');
 req.restoreUploadPath=upload;
 process.send({ready:true,upload});
 setInterval(()=>{},1000);
})().catch(()=>process.exit(1));
