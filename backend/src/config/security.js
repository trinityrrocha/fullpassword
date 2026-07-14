const crypto = require('crypto');

const PLACEHOLDER_VALUES = new Set([
  'sua_chave_secreta_super_segura_aqui',
  'SEU_JWT_SECRET_GERADO_AQUI',
  'change-me',
  'changeme'
]);

const getRequiredSecret = (name, minimumLength = 32) => {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }

  if (PLACEHOLDER_VALUES.has(value) || value.length < minimumLength) {
    throw new Error(`Variável insegura ou curta demais: ${name}`);
  }

  return value;
};

const timingSafeEqualText = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const JWT_SECRET = getRequiredSecret('JWT_SECRET', 64);
const ADMIN_BOOTSTRAP_TOKEN = getRequiredSecret('ADMIN_BOOTSTRAP_TOKEN', 48);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ADMIN_BOOTSTRAP_TOKEN,
  timingSafeEqualText
};
