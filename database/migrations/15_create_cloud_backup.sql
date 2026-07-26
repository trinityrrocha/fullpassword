BEGIN;

CREATE TABLE IF NOT EXISTS cloud_backup_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_provider VARCHAR(32) NOT NULL DEFAULT 'none'
    CHECK (active_provider IN ('none', 'google_drive', 'backblaze_b2', 'mega_s3', 'ftp')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_days JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
  schedule_times JSONB NOT NULL DEFAULT '["02:00"]'::jsonb,
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days IN (7, 15, 30, 60)),
  encrypted_backup_passphrase TEXT,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_error_at TIMESTAMP WITH TIME ZONE,
  last_error_message TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cloud_backup_settings (
  id,
  active_provider,
  enabled,
  schedule_enabled,
  schedule_days,
  schedule_times,
  retention_days,
  encrypted_backup_passphrase,
  last_success_at,
  last_error_at,
  last_error_message,
  updated_by,
  updated_at
)
SELECT
  1,
  CASE WHEN enabled = TRUE THEN 'google_drive' ELSE 'none' END,
  enabled,
  schedule_enabled,
  schedule_days,
  schedule_times,
  retention_days,
  encrypted_backup_passphrase,
  last_success_at,
  last_error_at,
  last_error_message,
  updated_by,
  updated_at
FROM google_drive_backup_settings
WHERE id = 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO cloud_backup_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

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
);

INSERT INTO cloud_backup_providers (provider)
VALUES ('google_drive'), ('backblaze_b2'), ('mega_s3'), ('ftp')
ON CONFLICT (provider) DO NOTHING;

UPDATE cloud_backup_providers
SET enabled = (
  SELECT active_provider = 'google_drive'
  FROM cloud_backup_settings
  WHERE id = 1
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
WHERE provider = 'google_drive';

CREATE TABLE IF NOT EXISTS cloud_backup_runs (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(32) NOT NULL
    CHECK (provider IN ('google_drive', 'backblaze_b2', 'mega_s3', 'ftp')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  trigger_type VARCHAR(32) NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'test', 'retention_cleanup')),
  backup_format VARCHAR(16) NOT NULL DEFAULT 'v2' CHECK (backup_format = 'v2'),
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
);

CREATE INDEX IF NOT EXISTS idx_cloud_backup_runs_started_at
  ON cloud_backup_runs (started_at DESC);

COMMIT;
