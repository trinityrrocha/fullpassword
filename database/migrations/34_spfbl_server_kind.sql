-- SPFBL: tipo de servidor (por ora só cPanel/WHM; o campo existe para aceitar outros tipos sem nova migração de dados).
ALTER TABLE spfbl_whm_servers ADD COLUMN IF NOT EXISTS server_kind VARCHAR(16) NOT NULL DEFAULT 'cpanel' CHECK (server_kind IN ('cpanel'));
