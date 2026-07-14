const { Pool } = require('pg');
require('dotenv').config();

const requiredDatabaseValue = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  if (name === 'DB_PASSWORD' && value === 'fullpassword_pass') {
    throw new Error('DB_PASSWORD padrão é proibida');
  }
  return value;
};

const pool = new Pool({
  host: requiredDatabaseValue('DB_HOST'),
  port: Number(process.env.DB_PORT || 5432),
  user: requiredDatabaseValue('DB_USER'),
  password: requiredDatabaseValue('DB_PASSWORD'),
  database: requiredDatabaseValue('DB_NAME'),
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
