-- Acesso de contas do FullPassword ao módulo SPFBL: domínios permitidos e modo de tratamento dos bloqueios.
CREATE TABLE IF NOT EXISTS spfbl_user_access (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    unlock_mode VARCHAR(16) NOT NULL DEFAULT 'review' CHECK (unlock_mode IN ('review', 'direct')),
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spfbl_user_domains (
    user_id UUID NOT NULL REFERENCES spfbl_user_access(user_id) ON DELETE CASCADE,
    domain_id UUID NOT NULL REFERENCES spfbl_domains(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, domain_id)
);
