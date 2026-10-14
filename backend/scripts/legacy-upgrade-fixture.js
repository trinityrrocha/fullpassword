// The old guard is loaded from the exact Git object, not recreated with today's schema.
const {spawnSync}=require('node:child_process');
const Module=require('node:module');
const path=require('node:path');
const BASE='d9a7a3786143379df43ff1910263894df33449bf';
const source=file=>{
 const result=spawnSync('git',['show',BASE+':'+file],{cwd:path.join(__dirname,'../..'),encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 if(result.status!==0) throw new Error('LEGACY_BASE_UNAVAILABLE');
 return result.stdout;
};
const oldModule=(file,dependencies)=>{
 const module=new Module(file);
 module.require=name=>{
  if(!Object.hasOwn(dependencies,name))throw new Error('UNEXPECTED_LEGACY_DEPENDENCY');
  return dependencies[name];
 };
 module._compile(source(file),file);
 return module.exports;
};
const prepareLegacySchema=async database=>{
 await database.query(source('database/init.sql'));
 const navigation=oldModule('backend/src/config/navigationPreferences.js',{});
 const guard=oldModule('backend/src/config/securitySchema.js',{'./database':database,'./navigationPreferences':navigation});
 await guard.ensureSecuritySchema();
 console.log('Legacy schema initialized from exact revision '+BASE);
};
module.exports={prepareLegacySchema,BASE};
