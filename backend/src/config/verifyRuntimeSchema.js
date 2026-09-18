const db=require('./database');
const {assertNavigationPreferencesSchema}=require('./navigationPreferences');
const verifyRuntimeSchema=async(queryable=db)=>{
  await assertNavigationPreferencesSchema(queryable);
  await queryable.query('SELECT u.crypto_identity,c.crypto_epoch,c.crypto_revision,c.rotation_required FROM users u CROSS JOIN clients c LIMIT 0');
  const tables=['vault_crypto_epochs','vault_crypto_envelopes','vault_records','vault_record_history','vault_migration_stages','sensitive_auth_grants','sensitive_auth_attempts','email_change_requests','mfa_login_challenges'];
  for(const table of tables) {
    if(!(await queryable.query('SELECT to_regclass($1) AS present',[table])).rows[0].present) throw new Error('DATABASE_SCHEMA_OUTDATED');
  }
  const role=(await queryable.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create,
    has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','S')
      AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_objects
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if(!role || Object.values(role).some(Boolean)) throw new Error('PRIVILEGED_RUNTIME_DATABASE_ROLE');
};
module.exports={verifyRuntimeSchema};
