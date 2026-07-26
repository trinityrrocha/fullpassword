BEGIN;

ALTER TABLE cloud_backup_settings
  ADD COLUMN IF NOT EXISTS failure_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failure_email_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS failure_email_on_recovery BOOLEAN NOT NULL DEFAULT FALSE;

-- O scheduler genérico é a única fonte de execução. A tabela legada preserva
-- OAuth/tokens, mas não pode manter um agendamento paralelo ativo.
UPDATE google_drive_backup_settings
SET enabled = FALSE,
    schedule_enabled = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE enabled = TRUE OR schedule_enabled = TRUE;

COMMIT;
