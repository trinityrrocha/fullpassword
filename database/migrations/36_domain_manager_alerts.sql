-- Domain Manager, fase 2: alertas de vencimento por domínio e deduplicação dos avisos já enviados.
CREATE TABLE IF NOT EXISTS dm_alert_settings (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    notify_admins BOOLEAN NOT NULL DEFAULT FALSE,
    emails JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dm_notifications_sent (
    domain_id UUID NOT NULL REFERENCES dm_domains(id) ON DELETE CASCADE,
    expires_on DATE NOT NULL,
    event_key VARCHAR(16) NOT NULL,
    recipient VARCHAR(40) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (domain_id, expires_on, event_key, recipient)
);
