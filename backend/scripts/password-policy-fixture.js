// Exclusive to the disposable localhost PostgreSQL integration runner.
const assert=require('node:assert/strict');
module.exports=async({database,browserClient,ownerApi,password,v2,frontend})=>{
  const service=require('../src/services/passwordPolicyService');
  const valid={login_min_length:12,login_rotation_months:12,vault_min_length:16,vault_rotation_months:12};
  const denied=status=>error=>error.response.status===status;
  for(const minimum of service.MIN_LENGTH_OPTIONS){
    const policy={...await service.getPasswordPolicy(),login_min_length:minimum};
    assert(service.evaluatePassword('Aa1!'+'x'.repeat(minimum-4),policy).valid);
    assert(!service.evaluatePassword('Aa1!'+'x'.repeat(minimum-5),policy).valid);
    for(const field of ['require_uppercase','require_lowercase','require_number','require_special','block_common_passwords'])assert.equal(policy[field],true);
    const saved=(await ownerApi.put('/system/password-policy',{...valid,login_min_length:minimum,vault_min_length:minimum})).data;
    assert.equal(saved.login_min_length,minimum);assert.equal((await ownerApi.get('/system/password-policy')).data.vault_min_length,minimum);
  }
  for(const [field,value] of [['login_min_length',9],['vault_min_length',100],['login_rotation_months',7],['vault_rotation_months',24],['login_min_length','12'],['login_rotation_months',null]])await assert.rejects(ownerApi.put('/system/password-policy',{...valid,[field]:value}),denied(400));
  await assert.rejects(ownerApi.put('/system/password-policy',{...valid,unknown:true}),denied(400));
  await assert.rejects(ownerApi.putWithoutCsrf('/system/password-policy',valid),denied(403));
  const ordinary=(await ownerApi.post('/users',{name:'SYNTHETIC_POLICY_ADMIN',email:'policy-admin@example.invalid',password,role:'admin'})).data;
  const ordinaryApi=browserClient();await ordinaryApi.post('/auth/login',{email:'policy-admin@example.invalid',password});
  await assert.rejects(ordinaryApi.put('/system/password-policy',valid),denied(403));
  assert.equal((await database.query('SELECT is_super_admin FROM users WHERE id=$1',[ordinary.id])).rows[0].is_super_admin,false);
  const publicPolicy=(await browserClient().get('/auth/password-policy')).data;
  assert(!('updated_by' in publicPolicy));assert(!('updated_at' in publicPolicy));
  await ownerApi.put('/system/password-policy',{...valid,login_min_length:8,vault_min_length:8});
  let login='Aa1!xxxx';const oldSecret='Vv1!zzzz',newSecret='SYNTHETIC_NEW_VAULT_POLICY_20';
  const account=(await ownerApi.post('/users',{name:'SYNTHETIC_POLICY',email:'policy@example.invalid',password:login,role:'user'})).data;
  const api=browserClient();await api.post('/auth/login',{email:'policy@example.invalid',password:login});
  let identity=(await api.post('/crypto/identity',{identity:await v2.createIndependentIdentity(account.id,oldSecret,8),current_password:login})).data.identity;
  const original=structuredClone(identity);
  assert((await database.query('SELECT vault_secret_changed_at FROM users WHERE id=$1',[account.id])).rows[0].vault_secret_changed_at);
  await ownerApi.put('/system/password-policy',{...valid,login_min_length:20,vault_min_length:20});
  assert.equal((await api.post('/auth/login',{email:'policy@example.invalid',password:login})).data.user.must_change_password,false,'raising minimum must not reject existing password');
  await v2.unlockIndependentIdentity(identity,oldSecret);
  await database.query("UPDATE users SET vault_secret_changed_at=CURRENT_TIMESTAMP-INTERVAL '19 months' WHERE id=$1",[account.id]);
  assert.equal((await api.get('/auth/me')).data.user.vault_secret_change_required,true);
  const {changeIdentityUnlockSecret}=await frontend('identityUnlockService.js');
  identity=await changeIdentityUnlockSecret({api,identity,currentSecret:oldSecret,newSecret,confirmation:newSecret,loginPassword:login,policy:{vault_min_length:20}});
  assert.equal((await api.get('/auth/me')).data.user.vault_secret_change_required,false);
  for(const field of ['publicKey','fingerprint','encryptedPrivateKey'])assert.deepEqual(identity[field],original[field]);
  await assert.rejects(v2.unlockIndependentIdentity(identity,oldSecret));await v2.unlockIndependentIdentity(identity,newSecret);
  for(const months of service.ROTATION_OPTIONS){
    await ownerApi.put('/system/password-policy',{...valid,login_rotation_months:months,vault_rotation_months:months});
    await database.query("UPDATE users SET password_changed_at=CURRENT_TIMESTAMP-($2::text||' months')::interval-INTERVAL '1 day' WHERE id=$1",[account.id,months]);
    const session=(await api.post('/auth/login',{email:'policy@example.invalid',password:login})).data.user;
    assert.equal(session.password_change_required,true);assert.equal(session.must_change_password,true);
    await assert.rejects(api.get('/clients'),denied(403));
    const next='SYNTHETIC_New_Login_'+months+'!';
    const payload=await (await frontend('profilePasswordService.js')).profilePasswordPayload(session,login,next,next,{login_min_length:12});
    const grant=(await api.post('/auth/reauth',{purpose:'profile_change',action:payload,current_password:login})).data.token;
    await api.put('/users/profile',{...payload,_reauth_token:grant});login=next;
    const changed=(await api.post('/auth/login',{email:'policy@example.invalid',password:login})).data.user;
    assert.equal(changed.password_change_required,false);await api.get('/clients');
    await database.query("UPDATE users SET vault_secret_changed_at=CURRENT_TIMESTAMP-($2::text||' months')::interval-INTERVAL '1 day' WHERE id=$1",[account.id,months]);
    assert.equal((await api.get('/auth/me')).data.user.vault_secret_change_required,true);
    await database.query('UPDATE users SET vault_secret_changed_at=CURRENT_TIMESTAMP WHERE id=$1',[account.id]);
    assert.equal((await api.get('/auth/me')).data.user.vault_secret_change_required,false);
  }
  const audit=(await database.query("SELECT metadata FROM system_audit_events WHERE action='password_policy_updated'")).rows;
  assert(audit.length>0);for(const row of audit)assert.deepEqual(Object.keys(row.metadata).sort(),Object.keys(valid).sort());
  assert(!JSON.stringify(audit).includes(oldSecret));assert(!JSON.stringify(audit).includes(newSecret));
  const sql=require('../src/config/passwordPolicySchema').SQL;
  const client=await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE password_policy_settings(id int,min_length int,password_change_notice_months int) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE users(id int,crypto_identity jsonb) ON COMMIT DROP');
    await client.query("INSERT INTO users VALUES(1,'{\"version\":2}'); INSERT INTO password_policy_settings VALUES(1,13,7)");
    await client.query(sql);const row=(await client.query('SELECT * FROM password_policy_settings')).rows[0];assert.equal(row.login_min_length,16);assert.equal(row.login_rotation_months,12);
    const stamp=(await client.query('SELECT vault_secret_changed_at FROM users')).rows[0].vault_secret_changed_at;
    await client.query(sql);assert.equal((await client.query('SELECT vault_secret_changed_at FROM users')).rows[0].vault_secret_changed_at.toISOString(),stamp.toISOString());
    await client.query('COMMIT');
  } finally {await client.query('ROLLBACK').catch(()=>{});client.release();}
  assert.throws(()=>service.normalizePolicy({min_length:32}));
  assert.equal(service.isExpired('2024-08-31T12:00:00Z',6,'2025-02-28T11:59:59Z'),false);
  assert.equal(service.isExpired('2024-08-31T12:00:00Z',6,'2025-02-28T12:00:00Z'),true);
  // Both v1 payload and v2 ordered-record restore use this shared real SQL path.
  const tables=require('../src/config/backupTables').BACKUP_TABLES,data={};
  for(const table of tables)data[table]=(await database.query('SELECT * FROM '+table)).rows;
  const before=(await database.query('SELECT vault_secret_changed_at FROM users WHERE id=$1',[account.id])).rows[0].vault_secret_changed_at.toISOString();
  const restore=require('../src/services/backupRestoreService');
  await restore.restoreBackupPayload({data});
  assert.equal((await database.query('SELECT vault_secret_changed_at FROM users WHERE id=$1',[account.id])).rows[0].vault_secret_changed_at.toISOString(),before);
  async function* records(){for(const table of tables)for(const row of data[table])yield {table,row};}
  await restore.restoreBackupRecords(records());
  assert.equal((await database.query('SELECT vault_secret_changed_at FROM users WHERE id=$1',[account.id])).rows[0].vault_secret_changed_at.toISOString(),before);
  assert.equal((await service.getPasswordPolicy()).vault_rotation_months,18);
  const legacy=structuredClone(data);for(const row of legacy.password_policy_settings){row.min_length=16;for(const key of Object.keys(valid))delete row[key];}
  for(const row of legacy.users)delete row.vault_secret_changed_at;
  await restore.restoreBackupPayload({data:legacy});
  assert.equal((await service.getPasswordPolicy()).login_min_length,16);
  assert((await database.query('SELECT vault_secret_changed_at FROM users WHERE id=$1',[account.id])).rows[0].vault_secret_changed_at);
  console.log('PASS password policy HTTP/PostgreSQL: roles/CSRF/allowlists, minima, existing-password validity, 6/12/18-month required changes, timestamp, identity preservation, legacy migration/idempotence and v1/v2 restore metadata.');
};
