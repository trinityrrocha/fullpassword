const db = require('../config/database');
const sent = require('./spfblSentService');
const servers = require('./spfblServersService');
const historySettings = require('./spfblHistorySettingsService');

// The one sent-mail service of the running backend: the pages and the scheduled collection share it, so a page load and a scheduled run
// of the same server never read the WHM twice at the same time.
const instance = sent.createService({
  credentialsFor: (serverId) => servers.getWhmCredentials(serverId), serverIdOf: (domain) => servers.serverIdOfDomain(domain),
  allServers: async () => (await servers.listServers()).map((server) => ({ id: server.id, name: server.name })),
  serverIdsOf: async (names) => (names.length ? new Set((await db.query('SELECT DISTINCT server_id FROM spfbl_domains WHERE name = ANY($1::text[]) AND server_id IS NOT NULL', [names])).rows.map((r) => r.server_id)) : new Set()),
  retentionDays: async () => Number((await historySettings.read()).history_retention_days)
});

module.exports = instance;
