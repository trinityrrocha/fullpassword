BEGIN;

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
  backup_format TEXT NOT NULL DEFAULT 'v2' CHECK (backup_format = 'v2'),
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
);

INSERT INTO google_drive_backup_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS google_drive_backup_runs (
  id BIGSERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  trigger_type VARCHAR(30) NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'test', 'retention_cleanup')),
  backup_format TEXT NOT NULL DEFAULT 'v2' CHECK (backup_format = 'v2'),
  file_name TEXT,
  drive_file_id TEXT,
  drive_folder_id TEXT,
  size_bytes BIGINT,
  scheduled_slot TEXT UNIQUE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_google_drive_backup_runs_started_at
  ON google_drive_backup_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS google_drive_oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_google_drive_oauth_states_expires_at
  ON google_drive_oauth_states (expires_at);

COMMIT;
