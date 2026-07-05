-- Migration para adicionar colunas criptográficas na tabela users
ALTER TABLE users ADD COLUMN IF NOT EXISTS wrapped_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS crypto_salt VARCHAR(255);
