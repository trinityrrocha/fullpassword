const BACKUP_TABLES = Object.freeze([
  'users',
  'groups',
  'user_groups',
  'clients',
  'client_group_access',
  'client_key_shares',
  'vault_items',
  'vault_shares',
  'vault_crypto_epochs',
  'vault_crypto_envelopes',
  'vault_records',
  'vault_record_history',
  'vault_migration_stages',
  'vault_access_audit',
  'domain_expiration_notifications',
  'user_mfa_settings',
  'user_mfa_recovery_codes',
  'password_policy_settings',
  'login_security_policy',
  'ip_security_rules',
  'system_audit_events',
  'smtp_settings',
  'cloud_backup_settings',
  'cloud_backup_providers'
]);

module.exports = { BACKUP_TABLES };
