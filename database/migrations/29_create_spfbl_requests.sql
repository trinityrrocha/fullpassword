-- SPFBL: pedidos de revisão/desbloqueio, controle de uma operação por registro e histórico de decisões.
-- Decisões sobrevivem à exclusão do usuário (ON DELETE SET NULL).
CREATE TABLE IF NOT EXISTS spfbl_requests (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS spfbl_requests_record_actor_idx ON spfbl_requests (record_id, actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS spfbl_requests_status_idx ON spfbl_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS spfbl_requests_domain_idx ON spfbl_requests (domain);

CREATE TABLE IF NOT EXISTS spfbl_operations (
    record_id CHAR(64) PRIMARY KEY,
    status VARCHAR(12) NOT NULL DEFAULT 'blocked' CHECK (status IN ('processing', 'uncertain', 'done', 'blocked')),
    revision INTEGER NOT NULL DEFAULT 0,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spfbl_release_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES spfbl_requests(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    domain VARCHAR(253) NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    sender VARCHAR(254) NOT NULL DEFAULT '',
    reason VARCHAR(254) NOT NULL DEFAULT '',
    action VARCHAR(12) NOT NULL CHECK (action IN ('unlocked', 'kept', 'reopened', 'reblocked')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS spfbl_release_events_action_idx ON spfbl_release_events (action, created_at DESC);
