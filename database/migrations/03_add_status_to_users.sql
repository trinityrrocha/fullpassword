-- Migration para adicionar coluna is_active na tabela users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
