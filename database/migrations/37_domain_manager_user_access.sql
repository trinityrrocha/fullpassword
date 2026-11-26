-- Domain Manager, fase 3: acesso somente leitura de contas comuns a domínios escolhidos.
CREATE TABLE IF NOT EXISTS dm_user_access (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dm_user_domains (
    user_id UUID NOT NULL REFERENCES dm_user_access(user_id) ON DELETE CASCADE,
    domain_id UUID NOT NULL REFERENCES dm_domains(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, domain_id)
);
CREATE INDEX IF NOT EXISTS dm_user_domains_domain_idx ON dm_user_domains (domain_id);
