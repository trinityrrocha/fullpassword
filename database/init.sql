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
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de grupos de acesso
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
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

-- Tabela de clientes
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(30),
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela pivot de permissão para clientes e grupos
CREATE TABLE IF NOT EXISTS client_group_access (
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, group_id)
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

-- SEEDER DO USUÁRIO ADMINISTRADOR
-- O hash da senha '@dmin123' deve ser gerado pelo backend usando bcrypt/argon2id antes de salvar.
-- Como estamos no SQL, vamos inserir um hash fictício para o Argon2id como placeholder,
-- O ideal é que na inicialização do backend, ele verifique se o admin existe e, se não, crie com o hash correto.
-- Aqui está o SQL para inserção direta:

INSERT INTO users (id, name, email, hash_senha_login, role)
VALUES (
    uuid_generate_v4(),
    'Administrador do Sistema',
    'admin@admin.com.br',
    '$argon2id$v=19$m=65536,t=3,p=4$PLACEHOLDER_HASH_FOR_@dmin123', -- O backend deve substituir por um hash real na inicialização ou o script de setup deve gerar.
    'admin'
) ON CONFLICT (email) DO NOTHING;

-- Criar um grupo padrão de administradores
INSERT INTO groups (id, name, description)
VALUES (
    uuid_generate_v4(),
    'Administradores',
    'Acesso total ao sistema'
) ON CONFLICT DO NOTHING;

-- Relacionar o admin criado ao grupo de administradores
-- (Assumindo que é a primeira inserção e usando subqueries)
INSERT INTO user_groups (user_id, group_id)
SELECT u.id, g.id
FROM users u, groups g
WHERE u.email = 'admin@admin.com.br' AND g.name = 'Administradores'
ON CONFLICT DO NOTHING;
