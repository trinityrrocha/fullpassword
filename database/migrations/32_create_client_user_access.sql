-- Compartilhamento de cofre direto com usuários (além de grupos). A concessão só é gravada pela rotação de chaves do dono
-- (activateEpoch), junto com os envelopes, na mesma transação.
CREATE TABLE IF NOT EXISTS client_user_access (
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    can_add BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, user_id)
);
CREATE INDEX IF NOT EXISTS client_user_access_user_idx ON client_user_access (user_id);
ALTER TABLE vault_migration_stages ADD COLUMN IF NOT EXISTS user_shares JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION vault_recipient_allowed(vault UUID, recipient UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN clients c ON c.id=vault
 WHERE u.id=recipient AND u.is_active=TRUE AND (
 c.created_by=u.id
 OR EXISTS(SELECT 1 FROM client_user_access ua WHERE ua.client_id=c.id AND ua.user_id=u.id AND ua.can_view=TRUE)
 OR EXISTS(SELECT 1 FROM user_groups ug JOIN groups g ON g.id=ug.group_id
 JOIN client_group_access a ON a.group_id=g.id AND a.client_id=c.id
 WHERE ug.user_id=u.id AND g.can_view=TRUE AND a.can_view=TRUE)))
$$;
DROP TRIGGER IF EXISTS vault_user_acl_revoked ON client_user_access;
CREATE TRIGGER vault_user_acl_revoked AFTER INSERT OR UPDATE OR DELETE ON client_user_access FOR EACH STATEMENT EXECUTE FUNCTION invalidate_revoked_vault_envelopes();
