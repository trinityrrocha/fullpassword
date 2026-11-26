// Domain Manager (migration 35). One statement per query, like the other ensure* helpers.
const DOMAIN_MANAGER_STATEMENTS = [
  `INSERT INTO system_modules (module_key) VALUES ('domain_manager') ON CONFLICT (module_key) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS dm_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    check_interval_days SMALLINT NOT NULL DEFAULT 7 CHECK (check_interval_days BETWEEN 1 AND 30),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `INSERT INTO dm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS dm_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(253) NOT NULL UNIQUE CHECK (name = lower(name) AND length(name) >= 4),
    source VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'spfbl')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    next_check_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_checked_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS dm_domains_due_idx ON dm_domains (next_check_at) WHERE active`,
  `CREATE TABLE IF NOT EXISTS dm_snapshots (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL,
    lookup_status VARCHAR(16) NOT NULL CHECK (lookup_status IN ('ok', 'not_found', 'no_expiry', 'unsupported', 'error')),
    error_code VARCHAR(48),
    registrar VARCHAR(200),
    expires_on DATE,
    registered_on DATE,
    rdap_statuses TEXT[] NOT NULL DEFAULT '{}',
    nameservers TEXT[] NOT NULL DEFAULT '{}',
    dnssec BOOLEAN,
    ssl_state VARCHAR(16) CHECK (ssl_state IN ('valid', 'expired', 'invalid', 'none', 'error')),
    ssl_not_after TIMESTAMP WITH TIME ZONE,
    ssl_issuer VARCHAR(200),
    ssl_protocol VARCHAR(16),
    ssl_error VARCHAR(64)
)`,
  `CREATE TABLE IF NOT EXISTS dm_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES dm_domains(id) ON DELETE CASCADE,
    field VARCHAR(24) NOT NULL CHECK (field IN ('expires_on', 'nameservers', 'dnssec', 'rdap_statuses', 'ssl_state', 'registrar')),
    old_value TEXT,
    new_value TEXT,
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS dm_changes_domain_idx ON dm_changes (domain_id, detected_at DESC)`
];

// Alerts (migration 36).
const DOMAIN_MANAGER_ALERT_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dm_alert_settings (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    notify_admins BOOLEAN NOT NULL DEFAULT FALSE,
    emails JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS dm_notifications_sent (
    domain_id UUID NOT NULL REFERENCES dm_domains(id) ON DELETE CASCADE,
    expires_on DATE NOT NULL,
    event_key VARCHAR(16) NOT NULL,
    recipient VARCHAR(40) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (domain_id, expires_on, event_key, recipient)
)`
];

// User access (migration 37).
const DOMAIN_MANAGER_ACCESS_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dm_user_access (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS dm_user_domains (
    user_id UUID NOT NULL REFERENCES dm_user_access(user_id) ON DELETE CASCADE,
    domain_id UUID NOT NULL REFERENCES dm_domains(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, domain_id)
)`,
  `CREATE INDEX IF NOT EXISTS dm_user_domains_domain_idx ON dm_user_domains (domain_id)`
];

// Mail authentication: SPF, DKIM, DMARC (migration 38).
const DOMAIN_MANAGER_MAIL_STATEMENTS = [
  `ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS mail_check_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS mail_check_interval_days SMALLINT NOT NULL DEFAULT 7 CHECK (mail_check_interval_days BETWEEN 1 AND 30)`,
  `ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dkim_selectors TEXT[] NOT NULL DEFAULT ARRAY['default','google','selector1','selector2','k1','k2','s1','s2','mail','dkim','mandrill','mte1','ctct1','smtp','sig1']::text[]`,
  `ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dns_servers TEXT[] NOT NULL DEFAULT ARRAY[]::text[]`,
  `ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dmarc_no_report_warning BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS ssl_check_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE dm_domains ADD COLUMN IF NOT EXISTS next_mail_check_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS dm_domains_mail_due_idx ON dm_domains (next_mail_check_at) WHERE active`,
  `CREATE TABLE IF NOT EXISTS dm_mail_checks (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL,
    name_exists BOOLEAN NOT NULL DEFAULT TRUE,
    spf_status VARCHAR(16) NOT NULL CHECK (spf_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    dmarc_status VARCHAR(16) NOT NULL CHECK (dmarc_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    dkim_status VARCHAR(16) NOT NULL CHECK (dkim_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    spf JSONB NOT NULL DEFAULT '{}'::jsonb,
    dmarc JSONB NOT NULL DEFAULT '{}'::jsonb,
    dkim JSONB NOT NULL DEFAULT '{}'::jsonb
)`,
  `CREATE TABLE IF NOT EXISTS dm_mail_domain_settings (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    extra_selectors TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `ALTER TABLE dm_changes DROP CONSTRAINT IF EXISTS dm_changes_field_check`,
  `ALTER TABLE dm_changes ADD CONSTRAINT dm_changes_field_check CHECK (field IN
    ('expires_on', 'nameservers', 'dnssec', 'rdap_statuses', 'ssl_state', 'registrar', 'spf_status', 'spf_record', 'dmarc_status', 'dmarc_policy', 'dkim_status'))`
];

const ensureDomainManagerSchema = async (client) => {
  for (const statement of DOMAIN_MANAGER_STATEMENTS) await client.query(statement);
  for (const statement of DOMAIN_MANAGER_ALERT_STATEMENTS) await client.query(statement);
  for (const statement of DOMAIN_MANAGER_ACCESS_STATEMENTS) await client.query(statement);
  for (const statement of DOMAIN_MANAGER_MAIL_STATEMENTS) await client.query(statement);
};

module.exports = { DOMAIN_MANAGER_STATEMENTS, DOMAIN_MANAGER_ALERT_STATEMENTS, DOMAIN_MANAGER_ACCESS_STATEMENTS, DOMAIN_MANAGER_MAIL_STATEMENTS, ensureDomainManagerSchema };
