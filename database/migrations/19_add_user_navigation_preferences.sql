ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_position TEXT NOT NULL DEFAULT 'side'
    CHECK (menu_position IN ('side', 'top'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_display TEXT NOT NULL DEFAULT 'labels'
    CHECK (menu_display IN ('labels', 'icons'));
