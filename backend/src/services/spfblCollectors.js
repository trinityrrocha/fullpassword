const db = require('../config/database');
const matrix = require('./spfblMatrixClient');
const servers = require('./spfblServersService');
const { createCollector } = require('./spfblCollectorService');

// One collector per WHM server (each has its own Matrix connection and its own 1024-record window). They are created on demand.
const create = (serverId) => createCollector({
  fetchPage: (cursor, credentials) => matrix.historyPage(credentials, cursor),
  credentials: () => servers.getMatrixCredentials(serverId),
  catalogue: async () => (await db.query('SELECT name FROM spfbl_domains WHERE server_id = $1', [serverId])).rows.map((row) => row.name)
});

const byServer = new Map();
const forServer = (serverId) => { if (!byServer.has(serverId)) byServer.set(serverId, create(serverId)); return byServer.get(serverId); };
const forget = (serverId) => byServer.delete(serverId);
const isRunning = () => [...byServer.values()].some((collector) => collector.isRunning());
const isServerRunning = (serverId) => Boolean(byServer.get(serverId)?.isRunning());
const markInterrupted = async () => { for (const collector of byServer.values()) await collector.markInterrupted().catch(() => {}); };
const waitIdle = async () => { await Promise.all([...byServer.values()].map((collector) => collector.waitIdle())); };

module.exports = { forServer, forget, isRunning, isServerRunning, markInterrupted, waitIdle };
