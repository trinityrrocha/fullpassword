-- Additive staging only. No legacy key/data is removed or marked migrated.
-- Activation requires the still-pending authenticated per-record API/UI migration.
CREATE TABLE IF NOT EXISTS vault_crypto_migration_batches (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_epoch INTEGER NOT NULL CHECK (target_epoch > 0),
  source_digest CHAR(64) NOT NULL,
  expected_records INTEGER NOT NULL CHECK (expected_records >= 0),
  state VARCHAR(20) NOT NULL DEFAULT 'staging' CHECK (state IN ('staging','verified','active','aborted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_id, target_epoch)
);
CREATE TABLE IF NOT EXISTS vault_crypto_migration_records (
  batch_id UUID NOT NULL REFERENCES vault_crypto_migration_batches(id) ON DELETE RESTRICT,
  record_id UUID NOT NULL,
  category VARCHAR(80) NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted_record JSONB NOT NULL CHECK (jsonb_typeof(encrypted_record) = 'object'),
  PRIMARY KEY(batch_id, record_id)
);
CREATE TABLE IF NOT EXISTS vault_crypto_migration_envelopes (
  batch_id UUID NOT NULL REFERENCES vault_crypto_migration_batches(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  identity_fingerprint TEXT NOT NULL,
  encrypted_key JSONB NOT NULL CHECK (jsonb_typeof(encrypted_key) = 'object'),
  PRIMARY KEY(batch_id, recipient_id)
);
