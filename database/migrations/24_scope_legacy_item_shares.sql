ALTER TABLE vault_migration_stages ADD COLUMN IF NOT EXISTS scoped_items JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS vault_item_crypto (
 item_id UUID PRIMARY KEY REFERENCES vault_items(id) ON DELETE CASCADE,
 envelope JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vault_item_crypto_envelopes (
 item_id UUID NOT NULL REFERENCES vault_item_crypto(item_id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 envelope JSONB NOT NULL,
 PRIMARY KEY(item_id,user_id)
);
-- Scope remains the original grant. Removing/replacing it invalidates the old envelope.
CREATE OR REPLACE FUNCTION revoke_item_crypto_envelope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(8142027);
 DELETE FROM vault_item_crypto_envelopes WHERE item_id=OLD.vault_item_id AND user_id=OLD.user_id;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS item_crypto_grant_revoked ON vault_shares;
CREATE TRIGGER item_crypto_grant_revoked BEFORE DELETE OR UPDATE ON vault_shares
 FOR EACH ROW EXECUTE FUNCTION revoke_item_crypto_envelope();
