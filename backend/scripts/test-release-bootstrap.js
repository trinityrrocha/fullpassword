// Executes the real preflight function with fake Node versions; never installs Node.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const script=path.resolve(__dirname,'../../scripts/bootstrap-release-agent.sh');
const source=fs.readFileSync(script,'utf8');
assert(source.indexOf('\nvalidate_host_node\n')<source.indexOf('\nsystemctl stop'));
assert.doesNotMatch(source,/^\s*systemctl enable/m);
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fp-bootstrap-contract-'));
const shellPath=value=>process.platform==='win32'?value.replaceAll('\\','/').replace(/^([a-z]):/i,(_,drive)=>'/'+drive.toLowerCase()):value;
try {
 const node=path.join(directory,'node');
 const invoke=()=>spawnSync(bash,['-c','source "$1"; PATH="$2"; validate_host_node; printf "GATE_PASS\\n"','preflight',shellPath(script),shellPath(directory)],{encoding:'utf8',timeout:15000});
 let result=invoke();assert.notEqual(result.status,0);assert.match(result.stderr,/NODE_HOST_UNAVAILABLE/);
 for(const version of ['v18.20.0','v22.22.0','v24.18.9','v25.0.0','v24.21.0-rc.1','invalid']) {
  fs.writeFileSync(node,'#!/bin/sh\nprintf "%s\\n" "'+version+'"\n',{mode:0o755});fs.chmodSync(node,0o755);
  result=invoke();assert.notEqual(result.status,0);assert.match(result.stderr,/NODE_HOST_VERSION_UNSUPPORTED/);
 }
 for(const version of ['v24.19.0','v24.21.0','v24.99.1']) {
  fs.writeFileSync(node,'#!/bin/sh\nprintf "%s\\n" "'+version+'"\n');
  result=invoke();assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/GATE_PASS/);
 }
 if(process.platform==='linux' && process.getuid()===0) {
  // Exercise the executable root entry point, before any install/systemd/state effects.
  fs.writeFileSync(node,'#!/bin/sh\nprintf "v18.20.0\\n"\n');
  const marker=path.join(directory,'side-effect');
  for(const command of ['install','systemctl'])fs.writeFileSync(path.join(directory,command),'#!/bin/sh\nprintf invoked >> "'+marker+'"\n',{mode:0o755});
  fs.symlinkSync('/usr/bin/realpath',path.join(directory,'realpath'));
  const before=fs.existsSync('/etc/systemd/system/fullpassword-release-agent.timer');
  result=spawnSync(bash,[script,path.resolve(__dirname,'../..'),'1000'],{encoding:'utf8',env:{...process.env,PATH:directory},timeout:15000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/NODE_HOST_VERSION_UNSUPPORTED/);
  assert.equal(fs.existsSync(marker),false);
  assert.equal(fs.existsSync('/etc/systemd/system/fullpassword-release-agent.timer'),before);
  console.log('PASS bootstrap root entry: unsupported Node causes zero install/systemd effects.');
 } else console.log('Bootstrap root entry effect test requires root Linux CI; preflight function exercised locally.');
 console.log('PASS host Node gate: absent/old/future-major/prerelease rejected; Node 24.x >=24.19 accepted; timer remains opt-in.');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
