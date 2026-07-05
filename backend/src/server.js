const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Importação das rotas (serão criadas nos próximos passos)
const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientRoutes');
const vaultRoutes = require('./routes/vaultRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globais de segurança e parse
app.use(helmet()); // Proteção de headers HTTP
app.use(cors()); // Permitir requisições do frontend
app.use(express.json()); // Parse de JSON no body

// Rota de verificação de saúde (Healthcheck)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Servidor rodando perfeitamente!' });
});

// Configuração das rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/vault-items', vaultRoutes);
app.use('/api/users', userRoutes);

// Middleware para tratamento de erros não capturados
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`Servidor backend rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
