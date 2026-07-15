const db = require('./database');

const MAX_CONNECTION_ATTEMPTS = 15;
const MAX_RETRY_DELAY_MS = 5000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const connectWithRetry = async () => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.pool.connect();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_CONNECTION_ATTEMPTS) break;

      const retryDelay = Math.min(1000 * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS);
      console.warn(
        `Banco de dados ainda indisponível para o schema de segurança ` +
        `(tentativa ${attempt}/${MAX_CONNECTION_ATTEMPTS}). Nova tentativa em ${retryDelay / 1000}s.`
      );
      await sleep(retryDelay);
    }
  }

  throw new Error(
    `Não foi possível conectar ao banco de dados após ${MAX_CONNECTION_ATTEMPTS} tentativas em aproximadamente 60 segundos.`,
    { cause: lastError }
  );
};

const ensureSecuritySchema = async () => {
  const client = await connectWithRetry();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [8142026]);
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE');

    await client.query(`
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
      $$ LANGUAGE plpgsql
    `);
    await client.query('DROP TRIGGER IF EXISTS trg_protect_super_admin_user ON users');
    await client.query(`
      CREATE TRIGGER trg_protect_super_admin_user
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION protect_super_admin_user()
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION clear_must_change_password_on_hash_update()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.hash_senha_login IS DISTINCT FROM NEW.hash_senha_login THEN
          NEW.must_change_password = FALSE;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query('DROP TRIGGER IF EXISTS trg_clear_must_change_password ON users');
    await client.query(`
      CREATE TRIGGER trg_clear_must_change_password
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION clear_must_change_password_on_hash_update()
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { ensureSecuritySchema };
