-- SPFBL: histórico de e-mails ENVIADOS armazenado (coletado do WHM emailtrack_search) e coleta a cada 15, 30 ou 60+ minutos.
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_interval_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (history_interval_minutes IN (15, 30, 60, 120, 240, 480, 720, 1440));
UPDATE spfbl_settings SET history_interval_minutes = history_interval_hours * 60 WHERE history_interval_hours IN (1, 2, 4, 8, 12, 24) AND history_interval_minutes = 1440 AND history_interval_hours <> 24;
ALTER TABLE spfbl_whm_servers ADD COLUMN IF NOT EXISTS sent_last_run_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE spfbl_whm_servers ADD COLUMN IF NOT EXISTS sent_collected_through TIMESTAMP WITH TIME ZONE;
CREATE TABLE IF NOT EXISTS spfbl_sent_records (
    server_id UUID NOT NULL REFERENCES spfbl_whm_servers(id) ON DELETE CASCADE,
    record_key CHAR(64) NOT NULL,
    event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('success', 'defer', 'failure', 'inprogress')),
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    action_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sender_domain VARCHAR(253) NOT NULL DEFAULT '',
    sender VARCHAR(254) NOT NULL DEFAULT '',
    recipient VARCHAR(254) NOT NULL DEFAULT '',
    delivered_to VARCHAR(254) NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (server_id, record_key)
);
CREATE INDEX IF NOT EXISTS spfbl_sent_records_sent_idx ON spfbl_sent_records (sent_at DESC);
CREATE INDEX IF NOT EXISTS spfbl_sent_records_domain_idx ON spfbl_sent_records (sender_domain, sent_at DESC);
