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
      CREATE TABLE IF NOT EXISTS login_security_policy (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        auto_block_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        failed_attempts_threshold INTEGER NOT NULL DEFAULT 5 CHECK (failed_attempts_threshold IN (5, 10, 15)),
        observation_window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (observation_window_minutes IN (10, 15, 30, 60)),
        block_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (block_duration_minutes IN (10, 15, 30, 60, 120, 240, 360, 720, 1440)),
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_by_email TEXT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
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
