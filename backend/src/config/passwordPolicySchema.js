// Additive evolution. Legacy columns remain readable by historical backups.
const SQL = `
DO $password_policy$ BEGIN
ALTER TABLE password_policy_settings ADD COLUMN IF NOT EXISTS login_min_length INTEGER;
ALTER TABLE password_policy_settings ADD COLUMN IF NOT EXISTS login_rotation_months INTEGER;
ALTER TABLE password_policy_settings ADD COLUMN IF NOT EXISTS vault_min_length INTEGER;
ALTER TABLE password_policy_settings ADD COLUMN IF NOT EXISTS vault_rotation_months INTEGER;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM password_policy_settings WHERE login_min_length IS NULL AND min_length > 20) THEN
  RAISE EXCEPTION 'PASSWORD_POLICY_LEGACY_MINIMUM_UNSUPPORTED: operator review required; minimum was not reduced';
 END IF;
END $$;
UPDATE password_policy_settings SET
 login_min_length=COALESCE(login_min_length,CASE WHEN min_length<=12 THEN 12 WHEN min_length<=16 THEN 16 ELSE 20 END),
 login_rotation_months=COALESCE(login_rotation_months,CASE WHEN password_change_notice_months IS NULL THEN 12 WHEN password_change_notice_months<=6 THEN 6 WHEN password_change_notice_months<=12 THEN 12 ELSE 18 END),
 vault_min_length=COALESCE(vault_min_length,16),vault_rotation_months=COALESCE(vault_rotation_months,12);
ALTER TABLE password_policy_settings ALTER COLUMN login_min_length SET DEFAULT 12, ALTER COLUMN login_min_length SET NOT NULL,
 ALTER COLUMN login_rotation_months SET DEFAULT 12, ALTER COLUMN login_rotation_months SET NOT NULL,
 ALTER COLUMN vault_min_length SET DEFAULT 16, ALTER COLUMN vault_min_length SET NOT NULL,
 ALTER COLUMN vault_rotation_months SET DEFAULT 12, ALTER COLUMN vault_rotation_months SET NOT NULL;
DO $$ BEGIN
 ALTER TABLE password_policy_settings ADD CONSTRAINT password_policy_explicit_options CHECK (
 login_min_length IN (8,12,16,20) AND vault_min_length IN (8,12,16,20)
 AND login_rotation_months IN (6,12,18) AND vault_rotation_months IN (6,12,18));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vault_secret_changed_at TIMESTAMPTZ;
-- Identity JSON has no reliable creation date. Give existing identities a full
-- first period; unrelated profile updated_at must not imply a secret change.
UPDATE users SET vault_secret_changed_at=CURRENT_TIMESTAMP
 WHERE crypto_identity IS NOT NULL AND vault_secret_changed_at IS NULL;
END $password_policy$;
`;
module.exports = {SQL, ensurePasswordPolicySchema: client => client.query(SQL)};
