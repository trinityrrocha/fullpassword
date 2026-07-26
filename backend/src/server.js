const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
require('dotenv').config();

require('./config/security');
const { ensureSecuritySchema } = require('./config/securitySchema');
const { ipSecurityMiddleware } = require('./middleware/ipSecurityMiddleware');
const { csrfProtection } = require('./middleware/csrfMiddleware');
const {
  DEFAULT_JSON_LIMIT_BYTES,
  VAULT_JSON_LIMIT_BYTES,
  defaultJsonParser,
  vaultJsonParser,
  enforceContentLength,
  validateEncryptedVaultPayload,
  payloadTooLargeErrorHandler
} = require('./middleware/requestLimits');
const {
  generalWriteLimiter,
  vaultWriteLimiter,
  sensitiveOperationLimiter,
  systemUpdateLimiter
} = require('./middleware/writeRateLimiters');
const { safeLogError } = require('./utils/safeLogger');

// Importação das rotas (serão criadas nos próximos passos)
const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientRoutes');
const vaultRoutes = require('./routes/vaultRoutes');
const userRoutes = require('./routes/userRoutes');
const systemRoutes = require('./routes/systemRoutes');
const groupRoutes = require('./routes/groupRoutes');
const integrationRoutes = require('./routes/integrationRoutes');
const cloudBackupRoutes = require('./routes/cloudBackupRoutes');
const { startCloudBackupScheduler } = require('./services/cloudBackupScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const authenticationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Limite de contenção acima do maior limiar configurável (15). A política
  // persistida aplica os bloqueios temporários antes deste teto de emergência.
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' }
});

const mfaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }
});

// A API recebe headers via Helmet. O documento estático do frontend recebe sua
// política de conteúdo no Nginx de borda, evitando políticas CSP conflitantes.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"]
    }
  },
  frameguard: { action: 'deny' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'display-capture=(), camera=(), microphone=(), geolocation=()');
  next();
});
const allowedOrigin = process.env.APP_ORIGIN;
if (!allowedOrigin) throw new Error('Variável obrigatória ausente: APP_ORIGIN');
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(cookieParser());
app.use('/api/auth/login', authenticationLimiter);
app.use('/api/auth/bootstrap', authenticationLimiter);
app.use('/api/auth/mfa', mfaLimiter);
app.use('/api/users/profile/mfa', mfaLimiter);

// Rota de verificação de saúde (Healthcheck)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Servidor rodando perfeitamente!' });
});

app.use('/api', ipSecurityMiddleware);
app.use('/api', csrfProtection);

// Limites de escrita são aplicados antes da leitura e do parsing do corpo.
// Backup, restore e atualização recebem uma contenção ainda mais restritiva.
app.use('/api/system/backup', sensitiveOperationLimiter);
app.use('/api/system/update', systemUpdateLimiter);
app.use('/api/integrations/google-drive', sensitiveOperationLimiter);
app.use(['/api/clients', '/api/users', '/api/system', '/api/groups'], generalWriteLimiter);

// O vault transporta anexos já criptografados no navegador e precisa de uma
// exceção controlada. Todas as demais rotas JSON permanecem no limite padrão.
app.use(
  '/api/vault-items',
  vaultWriteLimiter,
  enforceContentLength(VAULT_JSON_LIMIT_BYTES, { jsonOnly: true }),
  vaultJsonParser,
  validateEncryptedVaultPayload,
  vaultRoutes
);
app.use('/api', enforceContentLength(DEFAULT_JSON_LIMIT_BYTES, { jsonOnly: true }), defaultJsonParser);

// Configuração das rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/users', userRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/cloud-backup', cloudBackupRoutes);

app.use(payloadTooLargeErrorHandler);

// Middleware para tratamento de erros não capturados
app.use((err, req, res, next) => {
  safeLogError('Erro não tratado na API.', err);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Inicialização do servidor
const startServer = async () => {
  try {
    await ensureSecuritySchema();
    app.listen(PORT, () => {
      console.log(`Servidor backend rodando na porta ${PORT}`);
      console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
      startCloudBackupScheduler();
    });
  } catch (error) {
    safeLogError('Falha ao garantir o schema de segurança.', error);
    process.exit(1);
  }
};

startServer();
