ALTER TABLE user_mfa_settings ADD COLUMN IF NOT EXISTS last_totp_step BIGINT;
ALTER TABLE user_mfa_settings ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_mfa_settings ADD COLUMN IF NOT EXISTS attempt_window_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  challenge_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','setup')),
  token_version INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenge_expiry ON mfa_login_challenges(expires_at);
