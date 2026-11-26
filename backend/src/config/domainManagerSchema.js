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

const ensureDomainManagerSchema = async (client) => {
  for (const statement of DOMAIN_MANAGER_STATEMENTS) await client.query(statement);
};

module.exports = { DOMAIN_MANAGER_STATEMENTS, ensureDomainManagerSchema };
