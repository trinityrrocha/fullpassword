-- Domain Manager: two opt-outs for the whole list. A domain that rejects mail by policy may deliberately receive no DMARC reports, and
-- an installation may not want the certificate checked at all.
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dmarc_no_report_warning BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS ssl_check_enabled BOOLEAN NOT NULL DEFAULT TRUE;
