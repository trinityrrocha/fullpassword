ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION protect_super_admin_user()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_super_admin = TRUE THEN
        IF NEW.role <> 'admin' OR NEW.is_active = FALSE OR NEW.is_super_admin = FALSE THEN
            RAISE EXCEPTION 'O Super Admin não pode ser desativado, rebaixado ou perder a permissão de Super Admin';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_super_admin_user ON users;
CREATE TRIGGER trg_protect_super_admin_user
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION protect_super_admin_user();

CREATE OR REPLACE FUNCTION clear_must_change_password_on_hash_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.hash_senha_login IS DISTINCT FROM NEW.hash_senha_login THEN
        NEW.must_change_password = FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clear_must_change_password ON users;
CREATE TRIGGER trg_clear_must_change_password
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION clear_must_change_password_on_hash_update();
