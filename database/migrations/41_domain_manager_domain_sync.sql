-- Domain Manager: periodic import of the domains of the registered WHM servers (parametrizable), and a re-check of the SPF verdicts made
-- before "~all" became a warning.
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_interval_hours SMALLINT NOT NULL DEFAULT 6 CHECK (domain_sync_interval_hours IN (1, 2, 3, 4, 6, 8, 12, 24));
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_last_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_last_status VARCHAR(16);
UPDATE dm_domains SET next_mail_check_at = CURRENT_TIMESTAMP
 WHERE active AND id IN (SELECT domain_id FROM dm_mail_checks WHERE spf_status = 'ok' AND spf->>'all' = '~all');
