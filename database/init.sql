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
    public_key TEXT, -- Chave pública RSA-OAEP (SPKI/Base64)
    encrypted_private_key TEXT, -- Chave privada RSA-OAEP criptografada com a Master Key
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

-- Protege o Super Admin permanente contra desativação ou rebaixamento de papel.
CREATE OR REPLACE FUNCTION protect_super_admin_user()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_super_admin = TRUE THEN
        IF NEW.role <> 'admin' OR NEW.is_active = FALSE THEN
            RAISE EXCEPTION 'O Super Admin não pode ser desativado ou deixar de ser administrador';
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
