-- Criar extensão para UUID se não existir
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela de usuários (membros da equipe)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hash_senha_login VARCHAR(255) NOT NULL,
    wrapped_key TEXT, -- Master Key envelopada com a KEK derivada da senha
    crypto_salt VARCHAR(255), -- Salt usado para derivar a KEK
    kdf_version INTEGER NOT NULL DEFAULT 1,
    kdf_name TEXT NOT NULL DEFAULT 'PBKDF2',
    kdf_hash TEXT NOT NULL DEFAULT 'SHA-256',
    kdf_iterations INTEGER NOT NULL DEFAULT 100000,
    public_key TEXT, -- Chave pública RSA-OAEP (SPKI/Base64)
    encrypted_private_key TEXT, -- Chave privada RSA-OAEP criptografada com a Master Key
    rsa_key_size INTEGER NOT NULL DEFAULT 2048,
    rsa_key_version INTEGER NOT NULL DEFAULT 1,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de grupos de acesso com permissões herdadas pelos cofres compartilhados
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    can_add BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela pivot para usuários e grupos
CREATE TABLE IF NOT EXISTS user_groups (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_id)
);

-- Tabela de clientes/cofres
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(30),
    email VARCHAR(255),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela pivot de compartilhamento de cofres/clientes com grupos
CREATE TABLE IF NOT EXISTS client_group_access (
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT TRUE,
    can_add BOOLEAN NOT NULL DEFAULT TRUE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, group_id)
);

-- Chave própria de cada cofre envelopada para cada usuário autorizado
CREATE TABLE IF NOT EXISTS client_key_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_client_key TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, user_id)
);

-- Tabela do cofre (vault_items)
CREATE TABLE IF NOT EXISTS vault_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL, -- Ex: 'cPanel', 'VPN', 'Servidor TS', 'Servidores'
    encrypted_data TEXT NOT NULL, -- JSON criptografado com os dados (Client-Side Encryption)
    encrypted_attachment TEXT, -- Arquivo TXT em base64 criptografado (Client-Side Encryption)
    metadata JSONB, -- Dados não sensíveis para busca
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de compartilhamento criptográfico item-usuário (compatibilidade RSA)
CREATE TABLE IF NOT EXISTS vault_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_item_id UUID REFERENCES vault_items(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_vault_key TEXT NOT NULL, -- A chave simétrica do cofre criptografada com a Chave Pública RSA do usuário
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vault_item_id, user_id)
);

-- Tabela de auditoria de acesso/compartilhamento
CREATE TABLE IF NOT EXISTS vault_access_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Configuração global do transporte SMTP. A senha permanece cifrada no banco
-- com a chave de aplicação CONFIG_ENCRYPTION_KEY, mantida fora do PostgreSQL.
CREATE TABLE IF NOT EXISTS smtp_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    host VARCHAR(255) NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
    security VARCHAR(20) NOT NULL DEFAULT 'starttls' CHECK (security IN ('ssl_tls', 'starttls', 'none')),
    username VARCHAR(320) NOT NULL DEFAULT '',
    encrypted_password TEXT,
    from_name VARCHAR(255) NOT NULL DEFAULT 'FullPassword',
    from_email VARCHAR(254) NOT NULL DEFAULT '',
    reply_to VARCHAR(254),
    timeout_seconds INTEGER NOT NULL DEFAULT 15 CHECK (timeout_seconds BETWEEN 1 AND 120),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO smtp_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

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

ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (history_retention_days IN (30, 60, 90));
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_schedule_hour INTEGER NOT NULL DEFAULT 3 CHECK (history_schedule_hour BETWEEN 0 AND 23);
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_last_run_date DATE;

CREATE TABLE IF NOT EXISTS spfbl_history_records (
    record_id CHAR(64) PRIMARY KEY,
    integration_hash CHAR(64) NOT NULL,
    domain VARCHAR(253) NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    sender VARCHAR(254) NOT NULL DEFAULT '',
    from_address VARCHAR(254) NOT NULL DEFAULT '',
    replyto VARCHAR(254) NOT NULL DEFAULT '',
    result VARCHAR(254) NOT NULL DEFAULT '',
    provider_status VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN' CHECK (provider_status IN ('WHITELISTED', 'BLOCKED', 'NONE', 'UNKNOWN')),
    provider_key VARCHAR(128) NOT NULL,
    arrival_at TIMESTAMP WITH TIME ZONE NOT NULL,
    collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS spfbl_history_records_domain_idx ON spfbl_history_records (integration_hash, domain, arrival_at DESC);
CREATE INDEX IF NOT EXISTS spfbl_history_records_arrival_idx ON spfbl_history_records (arrival_at);

CREATE TABLE IF NOT EXISTS spfbl_history_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_hash CHAR(64) NOT NULL,
    trigger VARCHAR(12) NOT NULL CHECK (trigger IN ('schedule', 'manual', 'query')),
    status VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'capped', 'failed')),
    window_start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    pages INTEGER NOT NULL DEFAULT 0,
    rows_seen INTEGER NOT NULL DEFAULT 0,
    rows_stored INTEGER NOT NULL DEFAULT 0,
    newest_at TIMESTAMP WITH TIME ZONE,
    oldest_at TIMESTAMP WITH TIME ZONE,
    reached_end BOOLEAN NOT NULL DEFAULT FALSE,
    skipped_rows BOOLEAN NOT NULL DEFAULT FALSE,
    error_code VARCHAR(60)
);
CREATE INDEX IF NOT EXISTS spfbl_history_runs_finished_idx ON spfbl_history_runs (integration_hash, finished_at DESC);

ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (history_interval_hours IN (1, 2, 4, 8, 12, 24));
ALTER TABLE spfbl_settings ADD COLUMN IF NOT EXISTS history_last_run_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE spfbl_history_runs ADD COLUMN IF NOT EXISTS provider_limit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE spfbl_history_runs ADD COLUMN IF NOT EXISTS gap BOOLEAN NOT NULL DEFAULT FALSE;

-- Tokens temporários de recuperação de acesso. O token puro existe apenas no
-- e-mail/navegador; o banco persiste exclusivamente seu hash SHA-256.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    requested_ip TEXT,
    requested_user_agent TEXT,
    used_ip TEXT,
    used_user_agent TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_hash_unique
    ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created
    ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry_unused
    ON password_reset_tokens (expires_at)
    WHERE used_at IS NULL;

-- Ajustes idempotentes para bancos já existentes
ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_add BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_add BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_group_access ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_name TEXT NOT NULL DEFAULT 'PBKDF2';
ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_hash TEXT NOT NULL DEFAULT 'SHA-256';
ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_iterations INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rsa_key_size INTEGER NOT NULL DEFAULT 2048;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rsa_key_version INTEGER NOT NULL DEFAULT 1;

-- Protege o Super Admin permanente contra desativação ou rebaixamento de papel.
CREATE OR REPLACE FUNCTION protect_super_admin_user()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_super_admin = TRUE THEN
        IF NEW.role <> 'admin' OR NEW.is_active = FALSE OR NEW.is_super_admin = FALSE THEN
            RAISE EXCEPTION 'O Super Admin não pode ser desativado, rebaixado ou perder a permissão de Super Admin';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_super_admin_user ON users;
CREATE TRIGGER trg_protect_super_admin_user
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION protect_super_admin_user();

-- Ao trocar a senha, remove a exigência de troca obrigatória.
CREATE OR REPLACE FUNCTION clear_must_change_password_on_hash_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.hash_senha_login IS DISTINCT FROM NEW.hash_senha_login THEN
        NEW.must_change_password = FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clear_must_change_password ON users;
CREATE TRIGGER trg_clear_must_change_password
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION clear_must_change_password_on_hash_update();

-- Criar um grupo padrão de administradores
INSERT INTO groups (id, name, description, can_view, can_edit, can_add, can_delete)
VALUES (
    uuid_generate_v4(),
    'Administradores',
    'Acesso total ao sistema',
    TRUE,
    TRUE,
    TRUE,
    TRUE
) ON CONFLICT DO NOTHING;

UPDATE groups
SET can_view = TRUE, can_edit = TRUE, can_add = TRUE, can_delete = TRUE
WHERE name = 'Administradores';

-- SPFBL: vários servidores WHM, cada um com a sua conexão Matrix (migration 33; a migração dos dados antigos roda na partida do backend).
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

-- SPFBL: tipo de servidor (migration 34).
ALTER TABLE spfbl_whm_servers ADD COLUMN IF NOT EXISTS server_kind VARCHAR(16) NOT NULL DEFAULT 'cpanel' CHECK (server_kind IN ('cpanel'));

-- Módulo Domain Manager: lista de domínios, último resultado da consulta (RDAP + SSL) e mudanças detectadas.
INSERT INTO system_modules (module_key) VALUES ('domain_manager') ON CONFLICT (module_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS dm_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    check_interval_days SMALLINT NOT NULL DEFAULT 7 CHECK (check_interval_days BETWEEN 1 AND 30),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO dm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dm_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(253) NOT NULL UNIQUE CHECK (name = lower(name) AND length(name) >= 4),
    source VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'spfbl')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    next_check_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_checked_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS dm_domains_due_idx ON dm_domains (next_check_at) WHERE active;

CREATE TABLE IF NOT EXISTS dm_snapshots (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL,
    lookup_status VARCHAR(16) NOT NULL CHECK (lookup_status IN ('ok', 'not_found', 'no_expiry', 'unsupported', 'error')),
    error_code VARCHAR(48),
    registrar VARCHAR(200),
    expires_on DATE,
    registered_on DATE,
    rdap_statuses TEXT[] NOT NULL DEFAULT '{}',
    nameservers TEXT[] NOT NULL DEFAULT '{}',
    dnssec BOOLEAN,
    ssl_state VARCHAR(16) CHECK (ssl_state IN ('valid', 'expired', 'invalid', 'none', 'error')),
    ssl_not_after TIMESTAMP WITH TIME ZONE,
    ssl_issuer VARCHAR(200),
    ssl_protocol VARCHAR(16),
    ssl_error VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS dm_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES dm_domains(id) ON DELETE CASCADE,
    field VARCHAR(24) NOT NULL CHECK (field IN ('expires_on', 'nameservers', 'dnssec', 'rdap_statuses', 'ssl_state', 'registrar')),
    old_value TEXT,
    new_value TEXT,
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS dm_changes_domain_idx ON dm_changes (domain_id, detected_at DESC);

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

-- Domain Manager, fase 5a: SPF, DKIM e DMARC por DNS. Configuração global, agenda própria por domínio, último resultado e ajustes por domínio.
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS mail_check_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS mail_check_interval_days SMALLINT NOT NULL DEFAULT 7 CHECK (mail_check_interval_days BETWEEN 1 AND 30);
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dkim_selectors TEXT[] NOT NULL DEFAULT ARRAY['default','google','selector1','selector2','k1','k2','s1','s2','mail','dkim','mandrill','mte1','ctct1','smtp','sig1']::text[];
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dns_servers TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS dmarc_no_report_warning BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS ssl_check_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE dm_domains ADD COLUMN IF NOT EXISTS next_mail_check_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS dm_domains_mail_due_idx ON dm_domains (next_mail_check_at) WHERE active;

CREATE TABLE IF NOT EXISTS dm_mail_checks (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL,
    name_exists BOOLEAN NOT NULL DEFAULT TRUE,
    spf_status VARCHAR(16) NOT NULL CHECK (spf_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    dmarc_status VARCHAR(16) NOT NULL CHECK (dmarc_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    dkim_status VARCHAR(16) NOT NULL CHECK (dkim_status IN ('ok', 'warning', 'fail', 'absent', 'not_found', 'inconclusive')),
    spf JSONB NOT NULL DEFAULT '{}'::jsonb,
    dmarc JSONB NOT NULL DEFAULT '{}'::jsonb,
    dkim JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS dm_mail_domain_settings (
    domain_id UUID PRIMARY KEY REFERENCES dm_domains(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    extra_selectors TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE dm_changes DROP CONSTRAINT IF EXISTS dm_changes_field_check;
ALTER TABLE dm_changes ADD CONSTRAINT dm_changes_field_check CHECK (field IN
    ('expires_on', 'nameservers', 'dnssec', 'rdap_statuses', 'ssl_state', 'registrar', 'spf_status', 'spf_record', 'dmarc_status', 'dmarc_policy', 'dkim_status'));

-- Dashboard: which cards each account shows and in which order. A preference, not a secret: it is not part of the backups.
CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Domain Manager: periodic domain import from the WHM servers.
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_interval_hours SMALLINT NOT NULL DEFAULT 6 CHECK (domain_sync_interval_hours IN (1, 2, 3, 4, 6, 8, 12, 24));
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_last_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE dm_settings ADD COLUMN IF NOT EXISTS domain_sync_last_status VARCHAR(16);
