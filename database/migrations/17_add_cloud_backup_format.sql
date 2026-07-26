BEGIN;

ALTER TABLE cloud_backup_settings
  ADD COLUMN IF NOT EXISTS backup_format VARCHAR(8) NOT NULL DEFAULT 'v2';

ALTER TABLE cloud_backup_settings
  DROP CONSTRAINT IF EXISTS cloud_backup_settings_backup_format_check;

ALTER TABLE cloud_backup_settings
  ADD CONSTRAINT cloud_backup_settings_backup_format_check
  CHECK (backup_format IN ('v1', 'v2'));

ALTER TABLE cloud_backup_runs
  ADD COLUMN IF NOT EXISTS backup_format VARCHAR(8) NOT NULL DEFAULT 'v2';

ALTER TABLE cloud_backup_runs
  ALTER COLUMN backup_format TYPE VARCHAR(8),
  ALTER COLUMN backup_format SET DEFAULT 'v2',
  ALTER COLUMN backup_format SET NOT NULL;

ALTER TABLE cloud_backup_runs
  DROP CONSTRAINT IF EXISTS cloud_backup_runs_backup_format_check;

ALTER TABLE cloud_backup_runs
  ADD CONSTRAINT cloud_backup_runs_backup_format_check
  CHECK (backup_format IN ('v1', 'v2'));

ALTER TABLE google_drive_backup_runs
  ADD COLUMN IF NOT EXISTS backup_format VARCHAR(8) NOT NULL DEFAULT 'v2';

ALTER TABLE google_drive_backup_runs
  ALTER COLUMN backup_format TYPE VARCHAR(8),
  ALTER COLUMN backup_format SET DEFAULT 'v2',
  ALTER COLUMN backup_format SET NOT NULL;

ALTER TABLE google_drive_backup_runs
  DROP CONSTRAINT IF EXISTS google_drive_backup_runs_backup_format_check;

ALTER TABLE google_drive_backup_runs
  ADD CONSTRAINT google_drive_backup_runs_backup_format_check
  CHECK (backup_format IN ('v1', 'v2'));

COMMIT;
