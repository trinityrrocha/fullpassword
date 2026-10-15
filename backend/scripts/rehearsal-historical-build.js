// Diagnostics exclusively for public historical builds, never runtime commands.
const {spawnSync}=require('node:child_process');
const STEPS=new Set(['historical-base-backend','historical-base-frontend','bootstrap-backend','bootstrap-frontend']);
const sanitize=value=>String(value||'')
 .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
 .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]')
 .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[REDACTED]@')
 .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED JWT]')
 .replace(/\b([A-Za-z0-9_]*(?:password|secret|token|cookie|recovery|(?:private|encryption|master|wrapped|vault)_key|ciphertext)[A-Za-z0-9_]*|authorization)(["']?\s*[:=]\s*)[^\r\n]*/gi,'$1$2[REDACTED]');
const excerpt=value=>{
 const lines=sanitize(value).split(/\r?\n/);
 const selected=lines.length>100?[...lines.slice(0,15),'[... output omitted ...]',...lines.slice(-85)]:lines;
 return selected.join('\n').slice(-16000).split('\n').map(line=>'| '+line).join('\n');
};
function historicalBuild({step,revision,args}, {spawn=spawnSync,log=console.log,cwd}={}){
 if(!STEPS.has(step)||!/^[a-f0-9]{40}$/.test(revision)||args[0]!=='build')throw new Error('INVALID_HISTORICAL_BUILD_STEP');
 log('REHEARSAL STEP: '+step+' revision='+revision);
 // Only commit metadata is passed as build args by the four audited call sites.
 // Never print argv, process.env, Docker run/exec output or recovery material.
 const result=spawn('docker',['build','--progress=plain',...args.slice(1)],{cwd,encoding:'utf8',windowsHide:true,timeout:1200000,maxBuffer:64*1024*1024});
 if(result.status!==0){
  const exit=Number.isInteger(result.status)?String(result.status):'none';
  const signal=/^[A-Z0-9]+$/.test(result.signal||'')?result.signal:'none';
  const errorCode=/^[A-Z0-9_]+$/.test(result.error?.code||'')?result.error.code:'none';
  log('REHEARSAL_COMMAND_FAILED\nstep: '+step+'\nexit: '+exit+'\nsignal: '+signal+'\nspawn_error: '+errorCode+'\nstdout:\n'+excerpt(result.stdout)+'\nstderr:\n'+excerpt(result.stderr));
  throw new Error('REHEARSAL_COMMAND_FAILED: '+step+' exit='+exit);
 }
 log('REHEARSAL STEP COMPLETE: '+step);
}
module.exports={historicalBuild};
