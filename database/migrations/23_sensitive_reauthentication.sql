CREATE TABLE IF NOT EXISTS sensitive_auth_grants(
 token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id UUID NOT NULL,token_version INTEGER NOT NULL,purpose TEXT NOT NULL,
 action_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS email_change_requests(
 token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 old_email TEXT NOT NULL,new_email TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS sensitive_auth_attempts(
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 window_started_at TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL);
