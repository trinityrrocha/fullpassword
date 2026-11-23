// Tables of the SPFBL module. One statement per query, like the other ensure* helpers.
const CREATE_SPFBL_SETTINGS_SQL = `
CREATE TABLE IF NOT EXISTS spfbl_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    matrix_user VARCHAR(254) NOT NULL DEFAULT '',
    encrypted_matrix_password TEXT,
    whm_host VARCHAR(253) NOT NULL DEFAULT '',
    whm_user VARCHAR(32) NOT NULL DEFAULT '',
    encrypted_whm_token TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const SEED_SPFBL_SETTINGS_SQL = 'INSERT INTO spfbl_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING';

const ADD_SYNC_COLUMNS_SQL = [
  'ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS domain_sync_at TIMESTAMP WITH TIME ZONE',
  'ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS domain_sync_status VARCHAR(48)'
];

// Domain catalogue: typed by hand or imported from WHM. "active" = last seen on WHM on a non-suspended account.
const CREATE_SPFBL_DOMAINS_SQL = `
CREATE TABLE IF NOT EXISTS spfbl_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(253) NOT NULL UNIQUE CHECK (name = lower(name) AND length(name) >= 4),
    source VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'whm')),
    cpanel_user VARCHAR(32),
    suspended BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// Who may open the module besides the Super Admin: a FullPassword account, the domains it may see and how it
// handles blocks (review by an admin, or direct unlock). Evaluated on every request, so revoking takes effect at once.
const CREATE_SPFBL_USER_ACCESS_SQL = `
CREATE TABLE IF NOT EXISTS spfbl_user_access (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    unlock_mode VARCHAR(16) NOT NULL DEFAULT 'review' CHECK (unlock_mode IN ('review', 'direct')),
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const CREATE_SPFBL_USER_DOMAINS_SQL = `
CREATE TABLE IF NOT EXISTS spfbl_user_domains (
    user_id UUID NOT NULL REFERENCES spfbl_user_access(user_id) ON DELETE CASCADE,
    domain_id UUID NOT NULL REFERENCES spfbl_domains(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, domain_id)
)`;

// Requests, one-operation-per-record control and decision history (migration 29). One statement per query.
const SPFBL_REQUEST_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS spfbl_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    record_id CHAR(64) NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    domain VARCHAR(253) NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    sender VARCHAR(254) NOT NULL DEFAULT '',
    provider_key VARCHAR(128) NOT NULL,
    integration_hash CHAR(64) NOT NULL,
    reason VARCHAR(254) NOT NULL DEFAULT '',
    source VARCHAR(8) NOT NULL DEFAULT 'review' CHECK (source IN ('review', 'direct')),
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'unlocked', 'kept', 'failed', 'uncertain', 'reopened', 'reblocked')),
    revision INTEGER NOT NULL DEFAULT 0,
    result_info VARCHAR(160) NOT NULL DEFAULT '',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS spfbl_requests_record_actor_idx ON spfbl_requests (record_id, actor_id) WHERE actor_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS spfbl_requests_status_idx ON spfbl_requests (status, requested_at DESC)`,
  `CREATE INDEX IF NOT EXISTS spfbl_requests_domain_idx ON spfbl_requests (domain)`,
  `CREATE TABLE IF NOT EXISTS spfbl_operations (
    record_id CHAR(64) PRIMARY KEY,
    status VARCHAR(12) NOT NULL DEFAULT 'blocked' CHECK (status IN ('processing', 'uncertain', 'done', 'blocked')),
    revision INTEGER NOT NULL DEFAULT 0,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS spfbl_release_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES spfbl_requests(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    domain VARCHAR(253) NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    sender VARCHAR(254) NOT NULL DEFAULT '',
    reason VARCHAR(254) NOT NULL DEFAULT '',
    action VARCHAR(12) NOT NULL CHECK (action IN ('unlocked', 'kept', 'reopened', 'reblocked')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS spfbl_release_events_action_idx ON spfbl_release_events (action, created_at DESC)`
];

const ensureSpfblSchema = async (client) => {
  await client.query(CREATE_SPFBL_SETTINGS_SQL);
  await client.query(SEED_SPFBL_SETTINGS_SQL);
  for (const statement of ADD_SYNC_COLUMNS_SQL) await client.query(statement);
  await client.query(CREATE_SPFBL_DOMAINS_SQL);
  await client.query(CREATE_SPFBL_USER_ACCESS_SQL);
  await client.query(CREATE_SPFBL_USER_DOMAINS_SQL);
  for (const statement of SPFBL_REQUEST_STATEMENTS) await client.query(statement);
};

module.exports = { SPFBL_REQUEST_STATEMENTS, CREATE_SPFBL_SETTINGS_SQL, SEED_SPFBL_SETTINGS_SQL, ADD_SYNC_COLUMNS_SQL, CREATE_SPFBL_DOMAINS_SQL, CREATE_SPFBL_USER_ACCESS_SQL, CREATE_SPFBL_USER_DOMAINS_SQL, ensureSpfblSchema };
