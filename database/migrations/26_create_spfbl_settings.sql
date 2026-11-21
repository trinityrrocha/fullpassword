-- Configuração do módulo SPFBL: credenciais Matrix e token WHM, sempre cifrados com CONFIG_ENCRYPTION_KEY.
CREATE TABLE IF NOT EXISTS spfbl_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    matrix_user VARCHAR(254) NOT NULL DEFAULT '',
    encrypted_matrix_password TEXT,
    whm_host VARCHAR(253) NOT NULL DEFAULT '',
    whm_user VARCHAR(32) NOT NULL DEFAULT '',
    encrypted_whm_token TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO spfbl_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
