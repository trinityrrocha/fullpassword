-- Dashboard: which cards each account shows and in which order. A preference, not a secret: it is not part of the backups.
CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
