-- Domain Manager, fase 5a: SPF, DKIM e DMARC por DNS. Configuração global, agenda própria por domínio, último resultado e ajustes por domínio.
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS mail_check_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS mail_check_interval_days SMALLINT NOT NULL DEFAULT 7 CHECK (mail_check_interval_days BETWEEN 1 AND 30);
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dkim_selectors TEXT[] NOT NULL DEFAULT ARRAY['default','google','selector1','selector2','k1','k2','s1','s2','mail','dkim','mandrill','mte1','ctct1','smtp','sig1']::text[];
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dns_servers TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE dm_domains ADD COLUMN IF NOT EXISTS next_mail_check_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS dm_domains_mail_due_idx ON dm_domains (next_mail_check_at) WHERE active;

CREATE TABLE IF NOT EXISTS dm_mail_checks (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL,
    name_exists BOOLEAN NOT NULL DEFAULT TRUE,
    spf_status VARCHAR(16) NOT NULL CHECK (spf_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    dmarc_status VARCHAR(16) NOT NULL CHECK (dmarc_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    dkim_status VARCHAR(16) NOT NULL CHECK (dkim_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    spf JSONB NOT NULL DEFAULT '{}'::jsonb,
    dmarc JSONB NOT NULL DEFAULT '{}'::jsonb,
    dkim JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS dm_mail_domain_settings (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    extra_selectors TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE dm_changes DROP CONSTRAINT IF EXISTS dm_changes_field_check;
ALTER TABLE dm_changes ADD CONSTRAINT dm_changes_field_check CHECK (field IN
    ('expires_on', 'nameservers', 'dnssec', 'rdap_statuses', 'ssl_state', 'registrar', 'spf_status', 'spf_record', 'dmarc_status', 'dmarc_policy', 'dkim_status'));
