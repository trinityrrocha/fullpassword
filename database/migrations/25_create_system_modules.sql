-- Módulos opcionais do sistema (ex.: SPFBL). O estado liga/desliga é validado no servidor.
CREATE TABLE IF NOT EXISTS system_modules (
    module_key VARCHAR(32) PRIMARY KEY CHECK (module_key ~ '^[a-z][a-z0-9_]{1,31}$'),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_modules (module_key)
VALUES ('spfbl')
ON CONFLICT (module_key) DO NOTHING;
