-- SPFBL: coleta do histórico a cada N horas (1, 2, 4, 8, 12 ou 24) e detecção do teto do Matrix (1024 registros por servidor).
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (history_interval_hours IN (1, 2, 4, 8, 12, 24));
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_last_run_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE spfbl_history_runs ADD COLUMN IF NOT EXISTS provider_limit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE spfbl_history_runs ADD COLUMN IF NOT EXISTS gap BOOLEAN NOT NULL DEFAULT FALSE;
