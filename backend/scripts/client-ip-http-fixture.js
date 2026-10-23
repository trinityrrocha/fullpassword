// Isolated test target only. Never mounted into the normal installation.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { clientIpMiddleware, getClientNetworkMetadata, getClientIpRateLimitKey } = require('../src/services/clientIpService');
const app = express();
app.set('trust proxy', 1);
app.use(clientIpMiddleware);
app.get('/api/limited', rateLimit({ windowMs:60000, limit:2, keyGenerator:getClientIpRateLimitKey, standardHeaders:false, legacyHeaders:false }), (req,res) => res.json(getClientNetworkMetadata(req)));
app.get('*', (req,res) => res.json(getClientNetworkMetadata(req)));
app.listen(3000, '0.0.0.0');
