// Native loopback-only disposable PostgreSQL. No remote URL or existing installation accepted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Client}=require('pg');
async function main(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'fp-runtime-role-test-'));
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const {default:EmbeddedPostgres}=await import('embedded-postgres');
 const password=crypto.randomBytes(32).toString('hex'),runtimePassword=crypto.randomBytes(32).toString('hex');
 const postgres=new EmbeddedPostgres({databaseDir:path.join(directory,'pgdata'),user:'postgres',password,port,persistent:true,
  authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 let owner,runtime;
 try {
  await postgres.initialise();await postgres.start();
  const connection={host:'127.0.0.1',port,user:'postgres',password,database:'postgres'};
  owner=new Client(connection);await owner.connect();
  await owner.query(await fs.readFile(path.join(__dirname,'../../database/init.sql'),'utf8'));
  const env={...process.env,DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_USER:'postgres',DB_PASSWORD:password,DB_NAME:'postgres',
   JWT_SECRET:crypto.randomBytes(64).toString('hex'),ADMIN_BOOTSTRAP_TOKEN:crypto.randomBytes(64).toString('hex'),
   APP_ORIGIN:'https://audit.example.invalid',SUPER_ADMIN_EMAIL:'audit@example.invalid',NODE_ENV:'test'};
  for(let pass=0;pass<2;pass++) {
   const migrated=spawnSync(process.execPath,[path.join(__dirname,'migrate-schema.js')],{env,encoding:'utf8',timeout:60000});
   assert.equal(migrated.status,0,'Owner migration CLI must complete and close its pool');
  }
  const ownerBefore=(await owner.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname='postgres'")).rows[0];
  await owner.query('CREATE TABLE runtime_dml_fixture(id serial PRIMARY KEY, value text NOT NULL)');
  await owner.query(await fs.readFile(path.join(__dirname,'../../database/provision-runtime-role.sql'),'utf8'));
  // Random synthetic hex only; never emitted to stdout or accepted from operator data.
  await owner.query("ALTER ROLE fullpassword_runtime PASSWORD '"+runtimePassword+"'");
  await owner.query('CREATE TABLE runtime_default_fixture(id serial PRIMARY KEY, value text NOT NULL)');
  runtime=new Client({...connection,user:'fullpassword_runtime',password:runtimePassword});await runtime.connect();
  const role=(await runtime.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
   has_schema_privilege(current_user,'public','CREATE') AS schema_create FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert(Object.values(role).every(value=>value===false));
  for(const table of ['runtime_dml_fixture','runtime_default_fixture']) {
   await runtime.query('BEGIN');
   const id=(await runtime.query(`INSERT INTO ${table}(value) VALUES ('SYNTHETIC') RETURNING id`)).rows[0].id;
   assert.equal((await runtime.query(`SELECT value FROM ${table} WHERE id=$1`,[id])).rows[0].value,'SYNTHETIC');
   assert.equal((await runtime.query(`UPDATE ${table} SET value='SYNTHETIC_UPDATED' WHERE id=$1`,[id])).rowCount,1);
   assert.equal((await runtime.query(`DELETE FROM ${table} WHERE id=$1`,[id])).rowCount,1);
   await runtime.query('ROLLBACK');
  }
  for(const sql of ['CREATE TABLE runtime_forbidden(id int)','ALTER TABLE runtime_dml_fixture ADD COLUMN forbidden int',
    'DROP TABLE runtime_dml_fixture','CREATE ROLE runtime_forbidden_role','CREATE DATABASE runtime_forbidden_db']) {
   await assert.rejects(runtime.query(sql),error=>error.code==='42501');
  }
  assert.deepEqual((await owner.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname='postgres'")).rows[0],ownerBefore);
  assert.equal((await owner.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()")).rows[0].owner,'postgres');
  // Real backend startup in verify mode, with every query restricted to SELECT and listen mocked.
  const verifyCode=`(async()=>{const assert=require('node:assert/strict');const d=require('./src/config/database');const query=d.query;d.query=(sql,...args)=>{assert(/^SELECT\\b/.test(sql.trim()),'Runtime startup attempted non-SELECT SQL');return query(sql,...args)};const {app,startServer}=require('./src/server');let listens=0;app.listen=()=>{listens++;return 'TEST_LISTEN'};assert.equal(await startServer(),'TEST_LISTEN');assert.equal(listens,1);await d.pool.end()})().catch(()=>{console.error('RUNTIME_VERIFY_STARTUP_FAILED');process.exit(1)})`;
  const verified=spawnSync(process.execPath,['-e',verifyCode],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:60000,
   env:{...env,DB_USER:'fullpassword_runtime',DB_PASSWORD:runtimePassword,DB_SCHEMA_MODE:'verify'}});
  assert.equal(verified.status,0,'Runtime schema verify/startup must work without DDL');
  console.log('PASS native PostgreSQL: owner migration CLI twice, runtime DML/sequences/default privileges, CREATE/ALTER/DROP/ROLE/DATABASE denied, owner unchanged, backend verify startup SELECT-only.');
 } finally {
  await runtime?.end().catch(()=>{});await owner?.end().catch(()=>{});await postgres.stop().catch(()=>{});
  assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fp-runtime-role-test-'));
  await fs.rm(directory,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
