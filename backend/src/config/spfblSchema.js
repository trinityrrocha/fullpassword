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

// Collected history (a re-collectable cache, never in backups), collection runs and the daily schedule (migration 30).
const SPFBL_HISTORY_STATEMENTS = [
  `ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (history_retention_days IN (30, 60, 90))`,
  `ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_schedule_hour INTEGER NOT NULL DEFAULT 3 CHECK (history_schedule_hour BETWEEN 0 AND 23)`,
  `ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_last_run_date DATE`,
  `CREATE TABLE IF NOT EXISTS spfbl_history_records (
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
)`,
  `CREATE INDEX IF NOT EXISTS spfbl_history_records_domain_idx ON spfbl_history_records (integration_hash, domain, arrival_at DESC)`,
  `CREATE INDEX IF NOT EXISTS spfbl_history_records_arrival_idx ON spfbl_history_records (arrival_at)`,
  `CREATE TABLE IF NOT EXISTS spfbl_history_runs (
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
)`,
  `CREATE INDEX IF NOT EXISTS spfbl_history_runs_finished_idx ON spfbl_history_runs (integration_hash, finished_at DESC)`,
  `ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (history_interval_hours IN (1, 2, 4, 8, 12, 24))`,
  `ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_last_run_at TIMESTAMP WITH TIME ZONE`,
  `ALTER TABLE spfbl_history_runs ADD COLUMN IF NOT EXISTS provider_limit BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE spfbl_history_runs ADD COLUMN IF NOT EXISTS gap BOOLEAN NOT NULL DEFAULT FALSE`
];

// Several WHM servers, each with its Matrix connection (migration 33). The legacy single server/connection is moved into the list once.
const SPFBL_SERVER_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS spfbl_whm_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) >= 1),
    host VARCHAR(253) NOT NULL,
    whm_user VARCHAR(32) NOT NULL,
    encrypted_token TEXT NOT NULL,
    matrix_user VARCHAR(254) NOT NULL DEFAULT '',
    encrypted_matrix_password TEXT,
    sync_at TIMESTAMP WITH TIME ZONE,
    sync_status VARCHAR(48),
    history_last_run_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS spfbl_whm_servers_name_idx ON spfbl_whm_servers (lower(name))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS spfbl_whm_servers_target_idx ON spfbl_whm_servers (host, whm_user)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS spfbl_whm_servers_matrix_idx ON spfbl_whm_servers (lower(matrix_user)) WHERE matrix_user <> ''`,
  `ALTER TABLE spfbl_domains ADD COLUMN IF NOT EXISTS server_id UUID REFERENCES spfbl_whm_servers(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS spfbl_domains_server_idx ON spfbl_domains (server_id)`,
  `INSERT INTO spfbl_whm_servers (name, host, whm_user, encrypted_token, matrix_user, encrypted_matrix_password, sync_at, sync_status, history_last_run_at)
SELECT whm_host, whm_host, whm_user, encrypted_whm_token, matrix_user, encrypted_matrix_password, domain_sync_at, domain_sync_status, history_last_run_at FROM spfbl_settings
 WHERE id = 1 AND whm_host <> '' AND whm_user <> '' AND encrypted_whm_token IS NOT NULL
ON CONFLICT DO NOTHING`,
  `UPDATE spfbl_domains d SET server_id = s.id FROM spfbl_whm_servers s, spfbl_settings st
 WHERE st.id = 1 AND s.host = st.whm_host AND s.whm_user = st.whm_user AND d.source = 'whm' AND d.server_id IS NULL`,
  `UPDATE spfbl_settings SET whm_host = '', whm_user = '', encrypted_whm_token = NULL, matrix_user = '', encrypted_matrix_password = NULL
 WHERE id = 1 AND EXISTS (SELECT 1 FROM spfbl_whm_servers s WHERE s.host = spfbl_settings.whm_host AND s.whm_user = spfbl_settings.whm_user)`
];

// Server type (migration 34).
const SPFBL_SERVER_KIND_STATEMENTS = [
  `ALTER TABLE spfbl_whm_servers ADD COLUMN IF NOT EXISTS server_kind VARCHAR(16) NOT NULL DEFAULT 'cpanel' CHECK (server_kind IN ('cpanel'))`
];

// Stored sent-mail history and collection every 15/30/60+ minutes (migration 42). One statement per query.
const SPFBL_SENT_STATEMENTS = [
  `ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_interval_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (history_interval_minutes IN (15, 30, 60, 120, 240, 480, 720, 1440))`,
  `UPDATE spfbl_settings SET history_interval_minutes = history_interval_hours * 60 WHERE history_interval_hours IN (1, 2, 4, 8, 12, 24) AND history_interval_minutes = 1440 AND history_interval_hours <> 24`,
  `ALTER TABLE spfbl_whm_servers ADD COLUMN IF NOT EXISTS sent_last_run_at TIMESTAMP WITH TIME ZONE`,
  `ALTER TABLE spfbl_whm_servers ADD COLUMN IF NOT EXISTS sent_collected_through TIMESTAMP WITH TIME ZONE`,
  `CREATE TABLE IF NOT EXISTS spfbl_sent_records (
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
)`,
  `CREATE INDEX IF NOT EXISTS spfbl_sent_records_sent_idx ON spfbl_sent_records (sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS spfbl_sent_records_domain_idx ON spfbl_sent_records (sender_domain, sent_at DESC)`,
  `ALTER TABLE spfbl_settings DROP CONSTRAINT IF EXISTS spfbl_settings_history_interval_minutes_check`,
  `ALTER TABLE spfbl_settings DROP CONSTRAINT IF EXISTS spfbl_settings_history_interval_options_check`,
  `UPDATE spfbl_settings SET history_interval_minutes = CASE WHEN history_interval_minutes IN (5, 10, 15, 30, 60, 120, 180) THEN history_interval_minutes WHEN history_interval_minutes = 1440 THEN 60 WHEN history_interval_minutes < 60 THEN 15 WHEN history_interval_minutes < 120 THEN 60 WHEN history_interval_minutes < 180 THEN 120 ELSE 180 END`,
  `ALTER TABLE spfbl_settings ALTER COLUMN history_interval_minutes SET DEFAULT 60`,
  `ALTER TABLE spfbl_settings ADD CONSTRAINT spfbl_settings_history_interval_options_check CHECK (history_interval_minutes IN (5, 10, 15, 30, 60, 120, 180))`
];

const ensureSpfblSchema = async (client) => {
  await client.query(CREATE_SPFBL_SETTINGS_SQL);
  await client.query(SEED_SPFBL_SETTINGS_SQL);
  for (const statement of ADD_SYNC_COLUMNS_SQL) await client.query(statement);
  await client.query(CREATE_SPFBL_DOMAINS_SQL);
  await client.query(CREATE_SPFBL_USER_ACCESS_SQL);
  await client.query(CREATE_SPFBL_USER_DOMAINS_SQL);
  for (const statement of SPFBL_REQUEST_STATEMENTS) await client.query(statement);
  for (const statement of SPFBL_HISTORY_STATEMENTS) await client.query(statement);
  for (const statement of SPFBL_SERVER_STATEMENTS) await client.query(statement);
  for (const statement of SPFBL_SERVER_KIND_STATEMENTS) await client.query(statement);
  for (const statement of SPFBL_SENT_STATEMENTS) await client.query(statement);
};

module.exports = { SPFBL_SENT_STATEMENTS, SPFBL_SERVER_KIND_STATEMENTS, SPFBL_SERVER_STATEMENTS, SPFBL_HISTORY_STATEMENTS, SPFBL_REQUEST_STATEMENTS, CREATE_SPFBL_SETTINGS_SQL, SEED_SPFBL_SETTINGS_SQL, ADD_SYNC_COLUMNS_SQL, CREATE_SPFBL_DOMAINS_SQL, CREATE_SPFBL_USER_ACCESS_SQL, CREATE_SPFBL_USER_DOMAINS_SQL, ensureSpfblSchema };
