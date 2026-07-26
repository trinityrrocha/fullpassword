const db = require('./database');

const MAX_CONNECTION_ATTEMPTS = 15;
const MAX_RETRY_DELAY_MS = 5000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const connectWithRetry = async () => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.pool.connect();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_CONNECTION_ATTEMPTS) break;

      const retryDelay = Math.min(1000 * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS);
      console.warn(
        `Banco de dados ainda indisponível para o schema de segurança ` +
        `(tentativa ${attempt}/${MAX_CONNECTION_ATTEMPTS}). Nova tentativa em ${retryDelay / 1000}s.`
      );
      await sleep(retryDelay);
    }
  }

  throw new Error(
    `Não foi possível conectar ao banco de dados após ${MAX_CONNECTION_ATTEMPTS} tentativas em aproximadamente 60 segundos.`,
    { cause: lastError }
  );
};

const ensureSecuritySchema = async () => {
  const client = await connectWithRetry();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [8142026]);
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_notice_dismissed_at TIMESTAMP WITH TIME ZONE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_version INTEGER NOT NULL DEFAULT 1');
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_name TEXT NOT NULL DEFAULT 'PBKDF2'");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_hash TEXT NOT NULL DEFAULT 'SHA-256'");
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_iterations INTEGER NOT NULL DEFAULT 100000');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS rsa_key_size INTEGER NOT NULL DEFAULT 2048');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS rsa_key_version INTEGER NOT NULL DEFAULT 1');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users (LOWER(email))');
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_policy_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        min_length INTEGER NOT NULL DEFAULT 12 CHECK (min_length >= 12),
        require_uppercase BOOLEAN NOT NULL DEFAULT TRUE,
        require_lowercase BOOLEAN NOT NULL DEFAULT TRUE,
        require_number BOOLEAN NOT NULL DEFAULT TRUE,
        require_special BOOLEAN NOT NULL DEFAULT TRUE,
        block_common_passwords BOOLEAN NOT NULL DEFAULT TRUE,
        password_change_notice_months INTEGER CHECK (password_change_notice_months IS NULL OR password_change_notice_months BETWEEN 1 AND 120),
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('INSERT INTO password_policy_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_version INTEGER NOT NULL,
        session_hash TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        browser TEXT,
        os TEXT,
        device TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        idle_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITH TIME ZONE,
        revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
        revoke_reason TEXT
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON user_sessions (user_id, revoked_at, expires_at)');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_hash ON user_sessions (session_hash)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_mfa_settings (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        totp_secret_encrypted TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        confirmed_at TIMESTAMP WITH TIME ZONE,
        recovery_codes_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP WITH TIME ZONE
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('ALTER TABLE user_mfa_settings ADD COLUMN IF NOT EXISTS recovery_codes_version INTEGER NOT NULL DEFAULT 1');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_codes_user_unused ON user_mfa_recovery_codes (user_id, used_at)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        requested_ip TEXT,
        requested_user_agent TEXT,
        used_ip TEXT,
        used_user_agent TEXT
      )
    `);
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_hash_unique ON password_reset_tokens (token_hash)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created ON password_reset_tokens (user_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry_unused ON password_reset_tokens (expires_at) WHERE used_at IS NULL');
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_audit_events (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_email TEXT,
        action VARCHAR(100) NOT NULL,
        status VARCHAR(40) NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_system_audit_events_created_at ON system_audit_events (created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_system_audit_events_action_ip_created ON system_audit_events (action, ip_address, created_at DESC)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_notification_state (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        security_notifications_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT '1970-01-01 00:00:00+00',
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS smtp_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        host VARCHAR(255) NOT NULL DEFAULT '',
        port INTEGER NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
        security VARCHAR(20) NOT NULL DEFAULT 'starttls' CHECK (security IN ('ssl_tls', 'starttls', 'none')),
        username VARCHAR(320) NOT NULL DEFAULT '',
        encrypted_password TEXT,
        from_name VARCHAR(255) NOT NULL DEFAULT 'FullPassword',
        from_email VARCHAR(254) NOT NULL DEFAULT '',
        reply_to VARCHAR(254),
        timeout_seconds INTEGER NOT NULL DEFAULT 15 CHECK (timeout_seconds BETWEEN 1 AND 120),
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('INSERT INTO smtp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query(`
      CREATE TABLE IF NOT EXISTS google_drive_backup_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        connected BOOLEAN NOT NULL DEFAULT FALSE,
        google_email TEXT,
        drive_folder_id TEXT,
        drive_folder_name TEXT NOT NULL DEFAULT 'FullPassword Backups',
        encrypted_refresh_token TEXT,
        encrypted_backup_passphrase TEXT,
        scope TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive.file',
        backup_format VARCHAR(8) NOT NULL DEFAULT 'v2' CHECK (backup_format IN ('v1', 'v2')),
        schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        schedule_days JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
        schedule_times JSONB NOT NULL DEFAULT '["02:00"]'::jsonb,
        retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days IN (7, 15, 30, 60)),
        last_success_at TIMESTAMP WITH TIME ZONE,
        last_error_at TIMESTAMP WITH TIME ZONE,
        last_error_message TEXT,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('INSERT INTO google_drive_backup_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query('ALTER TABLE google_drive_backup_settings ADD COLUMN IF NOT EXISTS google_oauth_client_id TEXT');
    await client.query('ALTER TABLE google_drive_backup_settings ADD COLUMN IF NOT EXISTS encrypted_google_oauth_client_secret TEXT');
    await client.query('ALTER TABLE google_drive_backup_settings ADD COLUMN IF NOT EXISTS google_oauth_redirect_uri TEXT');
    await client.query('ALTER TABLE google_drive_backup_settings ADD COLUMN IF NOT EXISTS google_oauth_configured_at TIMESTAMP WITH TIME ZONE');
    await client.query('ALTER TABLE google_drive_backup_settings ADD COLUMN IF NOT EXISTS google_oauth_configured_by UUID REFERENCES users(id) ON DELETE SET NULL');
    await client.query(`
      CREATE TABLE IF NOT EXISTS google_drive_backup_runs (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
        trigger_type VARCHAR(30) NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'test', 'retention_cleanup')),
        backup_format VARCHAR(8) NOT NULL DEFAULT 'v2' CHECK (backup_format IN ('v1', 'v2')),
        file_name TEXT,
        drive_file_id TEXT,
        drive_folder_id TEXT,
        size_bytes BIGINT,
        scheduled_slot TEXT UNIQUE,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP WITH TIME ZONE,
        error_message TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_google_drive_backup_runs_started_at ON google_drive_backup_runs (started_at DESC)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS cloud_backup_settings (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        active_provider VARCHAR(32) NOT NULL DEFAULT 'none'
          CHECK (active_provider IN ('none', 'google_drive', 'backblaze_b2', 'mega_s3', 'ftp')),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        schedule_days JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
        schedule_times JSONB NOT NULL DEFAULT '["02:00"]'::jsonb,
        retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days IN (7, 15, 30, 60)),
        backup_format VARCHAR(8) NOT NULL DEFAULT 'v2' CHECK (backup_format IN ('v1', 'v2')),
        encrypted_backup_passphrase TEXT,
        last_success_at TIMESTAMP WITH TIME ZONE,
        last_error_at TIMESTAMP WITH TIME ZONE,
        last_error_message TEXT,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      INSERT INTO cloud_backup_settings (
        id, active_provider, enabled, schedule_enabled, schedule_days, schedule_times,
        retention_days, encrypted_backup_passphrase, last_success_at, last_error_at,
        last_error_message, updated_by, updated_at
      )
      SELECT
        1,
        CASE WHEN enabled = TRUE THEN 'google_drive' ELSE 'none' END,
        enabled, schedule_enabled, schedule_days, schedule_times, retention_days,
        encrypted_backup_passphrase, last_success_at, last_error_at,
        last_error_message, updated_by, updated_at
      FROM google_drive_backup_settings
      WHERE id = 1
      ON CONFLICT (id) DO NOTHING
    `);
    await client.query('INSERT INTO cloud_backup_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query('ALTER TABLE cloud_backup_settings ADD COLUMN IF NOT EXISTS failure_email_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query("ALTER TABLE cloud_backup_settings ADD COLUMN IF NOT EXISTS failure_email_recipients JSONB NOT NULL DEFAULT '[]'::jsonb");
    await client.query('ALTER TABLE cloud_backup_settings ADD COLUMN IF NOT EXISTS failure_email_on_recovery BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query("ALTER TABLE cloud_backup_settings ADD COLUMN IF NOT EXISTS backup_format VARCHAR(8) NOT NULL DEFAULT 'v2'");
    await client.query('ALTER TABLE cloud_backup_settings DROP CONSTRAINT IF EXISTS cloud_backup_settings_backup_format_check');
    await client.query("ALTER TABLE cloud_backup_settings ADD CONSTRAINT cloud_backup_settings_backup_format_check CHECK (backup_format IN ('v1', 'v2'))");
    await client.query('UPDATE google_drive_backup_settings SET enabled = FALSE, schedule_enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE enabled = TRUE OR schedule_enabled = TRUE');
    await client.query(`
      CREATE TABLE IF NOT EXISTS cloud_backup_providers (
        provider VARCHAR(32) PRIMARY KEY
          CHECK (provider IN ('google_drive', 'backblaze_b2', 'mega_s3', 'ftp')),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        configured BOOLEAN NOT NULL DEFAULT FALSE,
        public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        encrypted_credentials TEXT,
        last_test_at TIMESTAMP WITH TIME ZONE,
        last_test_status VARCHAR(32),
        last_error_at TIMESTAMP WITH TIME ZONE,
        last_error_message TEXT,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      INSERT INTO cloud_backup_providers (provider)
      VALUES ('google_drive'), ('backblaze_b2'), ('mega_s3'), ('ftp')
      ON CONFLICT (provider) DO NOTHING
    `);
    await client.query(`
      UPDATE cloud_backup_providers
      SET enabled = (
        SELECT active_provider = 'google_drive' FROM cloud_backup_settings WHERE id = 1
      ),
      configured = (
        SELECT connected = TRUE
          OR encrypted_refresh_token IS NOT NULL
          OR (
            google_oauth_client_id IS NOT NULL
            AND encrypted_google_oauth_client_secret IS NOT NULL
            AND google_oauth_redirect_uri IS NOT NULL
          )
        FROM google_drive_backup_settings
        WHERE id = 1
      ),
      updated_at = CURRENT_TIMESTAMP
      WHERE provider = 'google_drive'
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS cloud_backup_runs (
        id BIGSERIAL PRIMARY KEY,
        provider VARCHAR(32) NOT NULL
          CHECK (provider IN ('google_drive', 'backblaze_b2', 'mega_s3', 'ftp')),
        status VARCHAR(32) NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
        trigger_type VARCHAR(32) NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'test', 'retention_cleanup')),
        backup_format VARCHAR(8) NOT NULL DEFAULT 'v2' CHECK (backup_format IN ('v1', 'v2')),
        file_name TEXT,
        remote_id TEXT,
        remote_path TEXT,
        size_bytes BIGINT,
        retention_removed INTEGER NOT NULL DEFAULT 0,
        scheduled_slot TEXT UNIQUE,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP WITH TIME ZONE,
        error_message TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await client.query("ALTER TABLE cloud_backup_runs ADD COLUMN IF NOT EXISTS backup_format VARCHAR(8) NOT NULL DEFAULT 'v2'");
    await client.query("ALTER TABLE google_drive_backup_runs ADD COLUMN IF NOT EXISTS backup_format VARCHAR(8) NOT NULL DEFAULT 'v2'");
    await client.query('ALTER TABLE cloud_backup_runs DROP CONSTRAINT IF EXISTS cloud_backup_runs_backup_format_check');
    await client.query("ALTER TABLE cloud_backup_runs ADD CONSTRAINT cloud_backup_runs_backup_format_check CHECK (backup_format IN ('v1', 'v2'))");
    await client.query('ALTER TABLE google_drive_backup_runs DROP CONSTRAINT IF EXISTS google_drive_backup_runs_backup_format_check');
    await client.query("ALTER TABLE google_drive_backup_runs ADD CONSTRAINT google_drive_backup_runs_backup_format_check CHECK (backup_format IN ('v1', 'v2'))");
    await client.query('CREATE INDEX IF NOT EXISTS idx_cloud_backup_runs_started_at ON cloud_backup_runs (started_at DESC)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS google_drive_oauth_states (
        state_hash CHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_google_drive_oauth_states_expires_at ON google_drive_oauth_states (expires_at)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_security_policy (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        auto_block_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        failed_attempts_threshold INTEGER NOT NULL DEFAULT 5 CHECK (failed_attempts_threshold IN (5, 10, 15)),
        observation_window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (observation_window_minutes IN (10, 15, 30, 60)),
        block_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (block_duration_minutes IN (10, 15, 30, 60, 120, 240, 360, 720, 1440)),
        screen_protection_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_by_email TEXT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('ALTER TABLE login_security_policy ADD COLUMN IF NOT EXISTS screen_protection_enabled BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('INSERT INTO login_security_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ip_security_rules (
        id BIGSERIAL PRIMARY KEY,
        ip_address TEXT NOT NULL,
        rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('block', 'allow', 'temporary_block')),
        reason TEXT,
        expires_at TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_by_email TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query("ALTER TABLE ip_security_rules ADD COLUMN IF NOT EXISTS rule_target_type VARCHAR(10) NOT NULL DEFAULT 'ip'");
    await client.query(`DO $$ BEGIN
      ALTER TABLE ip_security_rules ADD CONSTRAINT chk_ip_security_rule_target_type CHECK (rule_target_type IN ('ip', 'cidr'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_ip_security_rules_ip ON ip_security_rules (ip_address)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ip_security_rules_type ON ip_security_rules (rule_type)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ip_security_rules_active ON ip_security_rules (is_active)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ip_security_rules_expires ON ip_security_rules (expires_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ip_security_rules_created ON ip_security_rules (created_at DESC)');

    await client.query(`
      CREATE OR REPLACE FUNCTION protect_super_admin_user()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.is_super_admin = TRUE THEN
          IF NEW.role <> 'admin' OR NEW.is_active = FALSE OR NEW.is_super_admin = FALSE THEN
            RAISE EXCEPTION 'O Super Admin não pode ser desativado, rebaixado ou perder a permissão de Super Admin';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query('DROP TRIGGER IF EXISTS trg_protect_super_admin_user ON users');
    await client.query(`
      CREATE TRIGGER trg_protect_super_admin_user
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION protect_super_admin_user()
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION clear_must_change_password_on_hash_update()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.hash_senha_login IS DISTINCT FROM NEW.hash_senha_login THEN
          NEW.must_change_password = FALSE;
          NEW.password_changed_at = CURRENT_TIMESTAMP;
          NEW.password_change_notice_dismissed_at = NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query('DROP TRIGGER IF EXISTS trg_clear_must_change_password ON users');
    await client.query(`
      CREATE TRIGGER trg_clear_must_change_password
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION clear_must_change_password_on_hash_update()
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { ensureSecuritySchema };
