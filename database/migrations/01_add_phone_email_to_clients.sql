-- Migration para adicionar colunas phone e email na tabela clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email VARCHAR(255);
