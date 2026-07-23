const BACKUP_TABLES = Object.freeze([
  'users',
  'groups',
  'user_groups',
  'clients',
  'client_group_access',
  'client_key_shares',
  'vault_items',
  'vault_shares',
  'vault_access_audit',
  'user_mfa_settings',
  'user_mfa_recovery_codes',
  'password_policy_settings',
  'login_security_policy',
  'ip_security_rules',
  'system_audit_events'
]);

module.exports = { BACKUP_TABLES };
