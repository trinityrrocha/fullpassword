const db=require('./database');
const {assertNavigationPreferencesSchema}=require('./navigationPreferences');
const verifyRuntimeSchema=async(queryable=db)=>{
  await assertNavigationPreferencesSchema(queryable);
  await queryable.query('SELECT u.vault_secret_changed_at,p.login_min_length,p.login_rotation_months,p.vault_min_length,p.vault_rotation_months FROM users u CROSS JOIN password_policy_settings p LIMIT 0');
  await queryable.query('SELECT u.crypto_identity,c.crypto_epoch,c.crypto_revision,c.rotation_required FROM users u CROSS JOIN clients c LIMIT 0');
  await queryable.query('SELECT s.scoped_items,i.envelope,e.user_id FROM vault_migration_stages s CROSS JOIN vault_item_crypto i CROSS JOIN vault_item_crypto_envelopes e LIMIT 0');
  await queryable.query('SELECT history_retention_days,history_interval_hours,history_interval_minutes,history_last_run_at FROM spfbl_settings LIMIT 0');
  await queryable.query('SELECT provider_limit,gap FROM spfbl_history_runs LIMIT 0');
  await queryable.query('SELECT r.record_key,r.event_type,r.sent_at,r.sender_domain,r.detail,s.sent_last_run_at,s.sent_collected_through FROM spfbl_sent_records r CROSS JOIN spfbl_whm_servers s LIMIT 0');
  await queryable.query('SELECT s.encrypted_token,s.server_kind,s.matrix_user,s.encrypted_matrix_password,s.history_last_run_at,d.server_id FROM spfbl_whm_servers s CROSS JOIN spfbl_domains d LIMIT 0');
  await queryable.query('SELECT s.mail_check_enabled,s.mail_check_interval_days,s.dkim_selectors,s.dns_servers,s.dmarc_no_report_warning,s.ssl_check_enabled,s.domain_sync_enabled,s.domain_sync_interval_hours,s.domain_sync_last_at,s.domain_sync_last_status,d.next_mail_check_at FROM dm_settings s CROSS JOIN dm_domains d LIMIT 0');
  await queryable.query('SELECT user_id,can_view,can_edit,can_add,can_delete FROM client_user_access LIMIT 0');
  await queryable.query('SELECT user_shares FROM vault_migration_stages LIMIT 0');
  const tables=['vault_crypto_epochs','vault_crypto_envelopes','vault_records','vault_record_history','vault_migration_stages','sensitive_auth_grants','sensitive_auth_attempts','email_change_requests','mfa_login_challenges','system_modules','spfbl_settings','spfbl_domains','spfbl_user_access','spfbl_user_domains','spfbl_requests','spfbl_operations','spfbl_release_events','spfbl_history_records','spfbl_history_runs','spfbl_whm_servers','dm_settings','dm_domains','dm_snapshots','dm_changes','dm_alert_settings','dm_notifications_sent','dm_user_access','dm_user_domains','dm_mail_checks','dm_mail_domain_settings'];
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
