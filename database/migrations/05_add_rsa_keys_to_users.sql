-- Migration para adicionar chaves RSA aos usuários

ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;
