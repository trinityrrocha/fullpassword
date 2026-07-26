BEGIN;

ALTER TABLE google_drive_backup_settings
  ADD COLUMN IF NOT EXISTS google_oauth_client_id TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_google_oauth_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS google_oauth_redirect_uri TEXT,
  ADD COLUMN IF NOT EXISTS google_oauth_configured_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS google_oauth_configured_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
