// Read-only host inventory. Never print container environment or resolved Compose secrets.
const {spawnSync}=require('node:child_process');
const run=(cmd,args,options={})=>{
  const result=spawnSync(cmd,args,{...options,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4*1024*1024});
  if(result.status!==0) throw new Error('INVENTORY_COMMAND_FAILED');
  return result.stdout.trim();
};
const ids=run('docker',['ps','-aq','--filter','label=com.docker.compose.project']).split(/\s+/).filter(Boolean);
const containers=ids.map(id=>{
  const data=JSON.parse(run('docker',['inspect',id]))[0];
  const labels=data.Config.Labels || {};
  const digests=JSON.parse(run('docker',['image','inspect','--format','{{json .RepoDigests}}',data.Image]));
  return {id:data.Id,name:data.Name,service:labels['com.docker.compose.service'],project:labels['com.docker.compose.project'],
    workingDirectory:labels['com.docker.compose.project.working_dir'],composeFiles:labels['com.docker.compose.project.config_files'],
    imageId:data.Image,digests,status:data.State.Status,health:data.State.Health?.Status,
    mounts:data.Mounts.map(m=>({type:m.Type,name:m.Name,source:m.Source,destination:m.Destination,readWrite:m.RW})),
    publishedPorts:data.NetworkSettings.Ports};
});
console.log(JSON.stringify({docker:run('docker',['version','--format','{{.Server.Version}}']),compose:run('docker',['compose','version','--short']),containers},null,2));
