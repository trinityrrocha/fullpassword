import api from './api';

// Thin wrappers: reauthentication prompts and CSRF are handled by the shared api client.
export const getMenuModules = async () => (await api.get('/system/modules/menu')).data.modules || {};
export const listModules = async () => (await api.get('/system/modules')).data.modules || [];
export const setModuleEnabled = async (key, enabled) => (await api.put(`/system/modules/${encodeURIComponent(key)}`, { enabled })).data.module;

export const getOverview = async () => (await api.get('/spfbl/overview')).data;
// WHM servers, each with its Matrix connection. Secrets travel only on create/edit and are never returned.
export const listWhmServers = async () => (await api.get('/spfbl/whm-servers')).data.servers || [];
export const createWhmServer = async (payload) => (await api.post('/spfbl/whm-servers', payload)).data.server;
export const updateWhmServer = async (id, payload) => (await api.put(`/spfbl/whm-servers/${encodeURIComponent(id)}`, payload)).data.server;
export const removeWhmServer = async (id, removeDomains) => (await api.delete(`/spfbl/whm-servers/${encodeURIComponent(id)}`, { data: { remove_domains: removeDomains } })).data;
export const testWhmServer = async (id) => (await api.post(`/spfbl/whm-servers/${encodeURIComponent(id)}/test`, {})).data;
export const syncWhmServer = async (id) => (await api.post(`/spfbl/whm-servers/${encodeURIComponent(id)}/sync`, {})).data;
export const testMatrixServer = async (id) => (await api.post(`/spfbl/whm-servers/${encodeURIComponent(id)}/matrix/test`, {})).data;
export const syncDomains = async () => (await api.post('/spfbl/domains/sync', {})).data;

export const listDomains = async () => (await api.get('/spfbl/domains')).data.domains || [];
export const addDomain = async (name) => (await api.post('/spfbl/domains', { name })).data.domain;
export const removeDomain = async (id) => (await api.delete(`/spfbl/domains/${encodeURIComponent(id)}`)).data;

export const listAccess = async () => (await api.get('/spfbl/access')).data.access || [];
export const saveAccess = async (userId, { unlock_mode, domain_ids }) => (await api.put(`/spfbl/access/${encodeURIComponent(userId)}`, { unlock_mode, domain_ids })).data.access;
export const revokeAccess = async (userId) => (await api.delete(`/spfbl/access/${encodeURIComponent(userId)}`)).data;
export const listUsers = async () => (await api.get('/users')).data || [];

// History views (read only). Filters travel as query parameters; the server validates and scopes everything.
export const getDashboard = async () => (await api.get('/spfbl/dashboard')).data;
export const getHistory = async (params) => (await api.get('/spfbl/history', { params })).data;
export const refreshHistory = async (window = {}) => (await api.post('/spfbl/history/refresh', { start: window.start, end: window.end })).data;
export const getRecord = async (id, domain) => (await api.get(`/spfbl/records/${encodeURIComponent(id)}`, { params: { domain } })).data;
export const checkRecordStatus = async (id, domain) => (await api.post(`/spfbl/records/${encodeURIComponent(id)}/status`, { domain })).data;

// Requests and decisions. No reauthentication here: each action carries the server-issued proof for the record state.
export const requestReview = async (id, domain) => (await api.post(`/spfbl/records/${encodeURIComponent(id)}/request`, { domain, confirm: true })).data.request;
export const unlockRecord = async (id, domain, proof) => (await api.post(`/spfbl/records/${encodeURIComponent(id)}/unlock`, { domain, proof, confirm: true })).data.request;
export const listRequests = async (status) => (await api.get('/spfbl/requests', { params: status ? { status } : {} })).data;
export const getRequestDetail = async (id) => (await api.get(`/spfbl/requests/${encodeURIComponent(id)}`)).data;
export const keepRequest = async (id, { revision, notify }) => (await api.post(`/spfbl/requests/${encodeURIComponent(id)}/keep`, { revision, notify })).data;
export const releaseRequest = async (id, { revision, notify, proof }) => (await api.post(`/spfbl/requests/${encodeURIComponent(id)}/release`, { revision, notify, proof })).data;
export const blockRequest = async (id, { revision, notify, proof }) => (await api.post(`/spfbl/requests/${encodeURIComponent(id)}/block`, { revision, notify, proof })).data;
export const blockSender = async (id, domain, proof) => (await api.post(`/spfbl/records/${encodeURIComponent(id)}/block`, { domain, proof, confirm: true })).data.request;

export const getHistorySettings = async () => (await api.get('/spfbl/history-settings')).data;
export const saveHistorySettings = async (payload) => (await api.put('/spfbl/history-settings', payload)).data;
export const collectHistoryNow = async (serverId) => (await api.post('/spfbl/history/collect', serverId ? { server_id: serverId } : {})).data;

export const getAdminDomains = async () => (await api.get('/spfbl/dashboard/domains')).data;
export const getAudit = async (params) => (await api.get('/spfbl/audit', { params })).data;
