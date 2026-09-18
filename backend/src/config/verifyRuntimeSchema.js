const db=require('./database');
const {assertNavigationPreferencesSchema}=require('./navigationPreferences');
const verifyRuntimeSchema=async()=>{
  await assertNavigationPreferencesSchema(db);
  await db.query('SELECT u.crypto_identity,c.crypto_epoch,c.crypto_revision,c.rotation_required FROM users u CROSS JOIN clients c LIMIT 0');
  const tables=['vault_crypto_epochs','vault_crypto_envelopes','vault_records','vault_record_history','vault_migration_stages','sensitive_auth_grants','sensitive_auth_attempts','email_change_requests','mfa_login_challenges'];
  for(const table of tables) {
    if(!(await db.query('SELECT to_regclass($1) AS present',[table])).rows[0].present) throw new Error('DATABASE_SCHEMA_OUTDATED');
  }
  const role=(await db.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(role.rolsuper || role.rolcreatedb || role.rolcreaterole) throw new Error('PRIVILEGED_RUNTIME_DATABASE_ROLE');
};
module.exports={verifyRuntimeSchema};
