// Optional product modules (SPFBL, ...). Each module has one row; the toggle is enforced server-side.
// One statement per query, like the other ensure* helpers (works with every driver and test double).
const CREATE_SYSTEM_MODULES_SQL = `
CREATE TABLE IF NOT EXISTS system_modules (
    module_key VARCHAR(32) PRIMARY KEY CHECK (module_key ~ '^[a-z][a-z0-9_]{1,31}$'),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const SEED_SYSTEM_MODULES_SQL = "INSERT INTO system_modules (module_key) VALUES ('spfbl') ON CONFLICT (module_key) DO NOTHING";

const ensureModulesSchema = async (client) => {
  await client.query(CREATE_SYSTEM_MODULES_SQL);
  await client.query(SEED_SYSTEM_MODULES_SQL);
};

module.exports = { CREATE_SYSTEM_MODULES_SQL, SEED_SYSTEM_MODULES_SQL, ensureModulesSchema };
