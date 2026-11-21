-- Domínios do módulo SPFBL e estado da última sincronização com o WHM.
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS domain_sync_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS domain_sync_status VARCHAR(48);

-- Catálogo de domínios: digitados ou importados do WHM. "active" = visto no WHM em conta não suspensa.
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
);
