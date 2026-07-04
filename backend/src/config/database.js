const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'fullpassword_user',
  password: process.env.DB_PASSWORD || 'fullpassword_pass',
  database: process.env.DB_NAME || 'fullpassword_db',
});

// Testar a conexão
pool.on('connect', () => {
  console.log('Conexão com o banco de dados estabelecida com sucesso!');
});

pool.on('error', (err) => {
  console.error('Erro inesperado no cliente idle do PostgreSQL', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
