-- SPFBL: vários servidores WHM, cada um com a sua conexão Matrix. Cada domínio importado guarda de qual servidor veio; ao remover
-- um servidor, os domínios podem ficar "sem servidor de consulta" (continuam com o histórico, sem ações no Matrix).
-- O servidor WHM e a conexão Matrix únicos de antes (spfbl_settings) são movidos para a lista, uma vez.
CREATE TABLE IF NOT EXISTS spfbl_whm_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) >= 1),
    host VARCHAR(253) NOT NULL,
    whm_user VARCHAR(32) NOT NULL,
    encrypted_token TEXT NOT NULL,
    matrix_user VARCHAR(254) NOT NULL DEFAULT '',
    encrypted_matrix_password TEXT,
    sync_at TIMESTAMP WITH TIME ZONE,
    sync_status VARCHAR(48),
    history_last_run_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS spfbl_whm_servers_name_idx ON spfbl_whm_servers (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS spfbl_whm_servers_target_idx ON spfbl_whm_servers (host, whm_user);
CREATE UNIQUE INDEX IF NOT EXISTS spfbl_whm_servers_matrix_idx ON spfbl_whm_servers (lower(matrix_user)) WHERE matrix_user <> '';
ALTER TABLE spfbl_domains ADD COLUMN IF NOT EXISTS server_id UUID REFERENCES spfbl_whm_servers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS spfbl_domains_server_idx ON spfbl_domains (server_id);
INSERT INTO spfbl_whm_servers (name, host, whm_user, encrypted_token, matrix_user, encrypted_matrix_password, sync_at, sync_status, history_last_run_at)
SELECT whm_host, whm_host, whm_user, encrypted_whm_token, matrix_user, encrypted_matrix_password, domain_sync_at, domain_sync_status, history_last_run_at FROM spfbl_settings
 WHERE id = 1 AND whm_host <> '' AND whm_user <> '' AND encrypted_whm_token IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE spfbl_domains d SET server_id = s.id FROM spfbl_whm_servers s, spfbl_settings st
 WHERE st.id = 1 AND s.host = st.whm_host AND s.whm_user = st.whm_user AND d.source = 'whm' AND d.server_id IS NULL;
UPDATE spfbl_settings SET whm_host = '', whm_user = '', encrypted_whm_token = NULL, matrix_user = '', encrypted_matrix_password = NULL
 WHERE id = 1 AND EXISTS (SELECT 1 FROM spfbl_whm_servers s WHERE s.host = spfbl_settings.whm_host AND s.whm_user = spfbl_settings.whm_user);
