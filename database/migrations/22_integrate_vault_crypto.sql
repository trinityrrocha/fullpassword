ALTER TABLE users ADD COLUMN IF NOT EXISTS crypto_identity JSONB;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS crypto_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS crypto_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rotation_required BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS vault_crypto_epochs (
 client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 epoch INTEGER NOT NULL CHECK(epoch>0), created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(client_id,epoch)
);
CREATE TABLE IF NOT EXISTS vault_crypto_envelopes (
 client_id UUID NOT NULL, epoch INTEGER NOT NULL, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 identity_fingerprint TEXT NOT NULL, envelope JSONB NOT NULL,
 PRIMARY KEY(client_id,epoch,user_id), FOREIGN KEY(client_id,epoch) REFERENCES vault_crypto_epochs(client_id,epoch) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS vault_records (
 client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE, id UUID NOT NULL,
 category TEXT NOT NULL, collection TEXT NOT NULL, entity_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), epoch INTEGER NOT NULL CHECK(epoch>0),
 envelope JSONB NOT NULL, deleted BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(client_id,id), UNIQUE(client_id,category,collection,entity_id)
);
CREATE TABLE IF NOT EXISTS vault_record_history (
 client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE, id UUID NOT NULL,
 revision INTEGER NOT NULL, epoch INTEGER NOT NULL, category TEXT NOT NULL,
 collection TEXT NOT NULL, entity_id TEXT NOT NULL, envelope JSONB NOT NULL,
 archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(client_id,id,revision,epoch)
);
CREATE TABLE IF NOT EXISTS vault_migration_stages (
 id UUID PRIMARY KEY, client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 actor_id UUID NOT NULL REFERENCES users(id), source_revision BIGINT NOT NULL,
 source_hash TEXT NOT NULL, target_epoch INTEGER NOT NULL, recipients_hash TEXT NOT NULL,
 shares JSONB NOT NULL, records JSONB NOT NULL, envelopes JSONB NOT NULL,
 record_count INTEGER NOT NULL DEFAULT 0, manifest_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'staging' CHECK(state IN ('staging','active','aborted')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS vault_one_pending_stage ON vault_migration_stages(client_id) WHERE state='staging';
CREATE OR REPLACE FUNCTION vault_recipient_allowed(vault UUID, recipient UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN clients c ON c.id=vault
 WHERE u.id=recipient AND u.is_active=TRUE AND (
 c.created_by=u.id OR EXISTS(SELECT 1 FROM user_groups ug JOIN groups g ON g.id=ug.group_id
 JOIN client_group_access a ON a.group_id=g.id AND a.client_id=c.id
 WHERE ug.user_id=u.id AND g.can_view=TRUE AND a.can_view=TRUE)))
$$;
CREATE OR REPLACE FUNCTION invalidate_revoked_vault_envelopes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE vault RECORD; removed INTEGER;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM clients WHERE crypto_epoch>0) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(8142027);
 FOR vault IN SELECT id,crypto_epoch FROM clients WHERE crypto_epoch>0 ORDER BY id FOR UPDATE LOOP
   DELETE FROM vault_crypto_envelopes e WHERE e.client_id=vault.id AND NOT vault_recipient_allowed(vault.id,e.user_id);
   GET DIAGNOSTICS removed = ROW_COUNT;
   IF removed>0 THEN
     UPDATE clients SET rotation_required=TRUE,crypto_revision=crypto_revision+1 WHERE id=vault.id;
   END IF;
 END LOOP;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS vault_membership_revoked ON user_groups;
CREATE TRIGGER vault_membership_revoked AFTER INSERT OR UPDATE OR DELETE ON user_groups FOR EACH STATEMENT EXECUTE FUNCTION invalidate_revoked_vault_envelopes();
DROP TRIGGER IF EXISTS vault_group_revoked ON groups;
CREATE TRIGGER vault_group_revoked AFTER UPDATE OR DELETE ON groups FOR EACH STATEMENT EXECUTE FUNCTION invalidate_revoked_vault_envelopes();
DROP TRIGGER IF EXISTS vault_acl_revoked ON client_group_access;
CREATE TRIGGER vault_acl_revoked AFTER INSERT OR UPDATE OR DELETE ON client_group_access FOR EACH STATEMENT EXECUTE FUNCTION invalidate_revoked_vault_envelopes();
DROP TRIGGER IF EXISTS vault_account_revoked ON users;
CREATE TRIGGER vault_account_revoked AFTER UPDATE OF is_active ON users FOR EACH STATEMENT EXECUTE FUNCTION invalidate_revoked_vault_envelopes();

CREATE OR REPLACE FUNCTION revoke_deleted_recipient() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(8142027);
 UPDATE clients SET rotation_required=TRUE,crypto_revision=crypto_revision+1 WHERE crypto_epoch>0 AND id IN
 (SELECT client_id FROM vault_crypto_envelopes WHERE user_id=OLD.id);
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS vault_account_deleted ON users;
CREATE TRIGGER vault_account_deleted BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION revoke_deleted_recipient();
