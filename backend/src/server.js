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
const { safeLogError } = require('./utils/safeLogger');

// Importação das rotas (serão criadas nos próximos passos)
const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientRoutes');
const vaultRoutes = require('./routes/vaultRoutes');
const userRoutes = require('./routes/userRoutes');
const systemRoutes = require('./routes/systemRoutes');
const groupRoutes = require('./routes/groupRoutes');

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
  message: { error: 'Muitas tentativas MFA. Aguarde alguns minutos e tente novamente.' }
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
app.use(express.json({ limit: '12mb' })); // Inclui anexos criptografados de cofres (máximo de 5 MB antes da criptografia)
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

// Configuração das rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/vault-items', vaultRoutes);
app.use('/api/users', userRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/groups', groupRoutes);

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
    });
  } catch (error) {
    safeLogError('Falha ao garantir o schema de segurança.', error);
    process.exit(1);
  }
};

startServer();
