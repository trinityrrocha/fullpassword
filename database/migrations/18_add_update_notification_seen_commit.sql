ALTER TABLE user_notification_state
    ADD COLUMN IF NOT EXISTS update_notification_seen_commit VARCHAR(40);
