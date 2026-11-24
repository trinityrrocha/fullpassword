-- SPFBL: histórico coletado do Matrix (cache recoletável, FORA dos backups), execuções da coleta e agenda diária.
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (history_retention_days IN (30, 60, 90));
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_schedule_hour INTEGER NOT NULL DEFAULT 3 CHECK (history_schedule_hour BETWEEN 0 AND 23);
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_last_run_date DATE;

CREATE TABLE IF NOT EXISTS spfbl_history_records (
    record_id CHAR(64) PRIMARY KEY,
    integration_hash CHAR(64) NOT NULL,
    domain VARCHAR(253) NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    sender VARCHAR(254) NOT NULL DEFAULT '',
    from_address VARCHAR(254) NOT NULL DEFAULT '',
    replyto VARCHAR(254) NOT NULL DEFAULT '',
    result VARCHAR(254) NOT NULL DEFAULT '',
    provider_status VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN' CHECK (provider_status IN ('WHITELISTED', 'BLOCKED', 'NONE', 'UNKNOWN')),
    provider_key VARCHAR(128) NOT NULL,
    arrival_at TIMESTAMP WITH TIME ZONE NOT NULL,
    collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS spfbl_history_records_domain_idx ON spfbl_history_records (integration_hash, domain, arrival_at DESC);
CREATE INDEX IF NOT EXISTS spfbl_history_records_arrival_idx ON spfbl_history_records (arrival_at);

CREATE TABLE IF NOT EXISTS spfbl_history_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_hash CHAR(64) NOT NULL,
    trigger VARCHAR(12) NOT NULL CHECK (trigger IN ('schedule', 'manual', 'query')),
    status VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'capped', 'failed')),
    window_start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    pages INTEGER NOT NULL DEFAULT 0,
    rows_seen INTEGER NOT NULL DEFAULT 0,
    rows_stored INTEGER NOT NULL DEFAULT 0,
    newest_at TIMESTAMP WITH TIME ZONE,
    oldest_at TIMESTAMP WITH TIME ZONE,
    reached_end BOOLEAN NOT NULL DEFAULT FALSE,
    skipped_rows BOOLEAN NOT NULL DEFAULT FALSE,
    error_code VARCHAR(60)
);
CREATE INDEX IF NOT EXISTS spfbl_history_runs_finished_idx ON spfbl_history_runs (integration_hash, finished_at DESC);
