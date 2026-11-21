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

const ensureSpfblSchema = async (client) => {
  await client.query(CREATE_SPFBL_SETTINGS_SQL);
  await client.query(SEED_SPFBL_SETTINGS_SQL);
  for (const statement of ADD_SYNC_COLUMNS_SQL) await client.query(statement);
  await client.query(CREATE_SPFBL_DOMAINS_SQL);
  await client.query(CREATE_SPFBL_USER_ACCESS_SQL);
  await client.query(CREATE_SPFBL_USER_DOMAINS_SQL);
};

module.exports = { CREATE_SPFBL_SETTINGS_SQL, SEED_SPFBL_SETTINGS_SQL, ADD_SYNC_COLUMNS_SQL, CREATE_SPFBL_DOMAINS_SQL, CREATE_SPFBL_USER_ACCESS_SQL, CREATE_SPFBL_USER_DOMAINS_SQL, ensureSpfblSchema };
