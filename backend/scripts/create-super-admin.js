const argon2 = require('argon2');
const db = require('../src/config/database');
const { normalizeEmail } = require('../src/config/security');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDatabase = async () => {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === 30) throw error;
      console.log(`Aguardando banco de dados... tentativa ${attempt}/30`);
      await sleep(2000);
    }
  }
};

const ensureAdminGroup = async (client) => {
  const inserted = await client.query(
    `INSERT INTO groups (name, description, can_view, can_edit, can_add, can_delete)
     SELECT 'Administradores', 'Acesso total ao sistema', TRUE, TRUE, TRUE, TRUE
     WHERE NOT EXISTS (SELECT 1 FROM groups WHERE name = 'Administradores')
     RETURNING id`
  );

  if (inserted.rows[0]?.id) return inserted.rows[0].id;

  const existing = await client.query("SELECT id FROM groups WHERE name = 'Administradores' ORDER BY created_at LIMIT 1");
  return existing.rows[0]?.id;
};

const main = async () => {
  const email = normalizeEmail(process.env.INITIAL_SUPER_ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL);
  const password = String(process.env.INITIAL_SUPER_ADMIN_PASSWORD || '');
  const name = String(process.env.INITIAL_SUPER_ADMIN_NAME || 'Super Admin').trim() || 'Super Admin';

  if (!email) throw new Error('INITIAL_SUPER_ADMIN_EMAIL ausente');
  if (password.length < 16) throw new Error('INITIAL_SUPER_ADMIN_PASSWORD deve ter ao menos 16 caracteres');

  await waitForDatabase();

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');

    const state = await client.query(
      `SELECT
         COUNT(*)::integer AS total_users,
         COUNT(*) FILTER (WHERE is_super_admin = TRUE)::integer AS super_admins
       FROM users`
    );

    const totalUsers = state.rows[0].total_users;
    const superAdmins = state.rows[0].super_admins;

    if (superAdmins > 0) {
      await client.query('COMMIT');
      console.log('Super Admin já existe. Nenhuma alteração realizada.');
      return;
    }

    if (totalUsers > 0) {
      throw new Error('Banco já possui usuários, mas nenhum Super Admin. Criação automática bloqueada.');
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const inserted = await client.query(
      `INSERT INTO users (name, email, hash_senha_login, role, is_active, is_super_admin, must_change_password)
       VALUES ($1, $2, $3, 'admin', TRUE, TRUE, TRUE)
       RETURNING id, email`,
      [name, email, passwordHash]
    );

    const groupId = await ensureAdminGroup(client);
    if (groupId) {
      await client.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [inserted.rows[0].id, groupId]
      );
    }

    await client.query('COMMIT');
    console.log(`Super Admin inicial criado: ${inserted.rows[0].email}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
};

main().catch((error) => {
  console.error('Erro ao criar Super Admin inicial:', error.message);
  process.exit(1);
});
