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
