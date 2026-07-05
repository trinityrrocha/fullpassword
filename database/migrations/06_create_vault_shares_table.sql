-- Migration para adicionar tabela de compartilhamento de cofres (RSA)

CREATE TABLE IF NOT EXISTS vault_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_item_id UUID REFERENCES vault_items(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_vault_key TEXT NOT NULL, -- A chave simétrica do cofre criptografada com a Chave Pública RSA do usuário
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vault_item_id, user_id)
);
