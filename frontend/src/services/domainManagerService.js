import api from './api';

// Thin wrappers over the Domain Manager API (Super Admin only in this phase). The server validates everything.
export const listDomains = async (params) => (await api.get('/domain-manager/domains', { params })).data;
export const getDomainDetail = async (id) => (await api.get(`/domain-manager/domains/${encodeURIComponent(id)}`)).data;
export const addDomain = async (name) => (await api.post('/domain-manager/domains', { name })).data.domain;
export const importDomains = async (names) => (await api.post('/domain-manager/domains/import', { names })).data;
export const removeDomain = async (id) => (await api.delete(`/domain-manager/domains/${encodeURIComponent(id)}`)).data;
export const checkDomain = async (id) => (await api.post(`/domain-manager/domains/${encodeURIComponent(id)}/check`, {})).data;
export const getDomainSettings = async () => (await api.get('/domain-manager/settings')).data;
export const saveDomainSettings = async (payload) => (await api.put('/domain-manager/settings', payload)).data;
export const getDomainAlerts = async (id) => (await api.get(`/domain-manager/domains/${encodeURIComponent(id)}/alerts`)).data;
export const saveDomainAlerts = async (id, payload) => (await api.put(`/domain-manager/domains/${encodeURIComponent(id)}/alerts`, payload)).data;
// Access of ordinary accounts (Super Admin): who sees which domains, read only.
export const listDomainAccess = async () => (await api.get('/domain-manager/access')).data.access || [];
export const listAccessDomains = async () => (await api.get('/domain-manager/access/domains')).data.domains || [];
export const saveDomainAccess = async (userId, domainIds) => (await api.put(`/domain-manager/access/${encodeURIComponent(userId)}`, { domain_ids: domainIds })).data.access;
export const revokeDomainAccess = async (userId) => (await api.delete(`/domain-manager/access/${encodeURIComponent(userId)}`)).data;
export const getDomainMailSettings = async (id) => (await api.get(`/domain-manager/domains/${encodeURIComponent(id)}/mail-settings`)).data;
export const saveDomainMailSettings = async (id, payload) => (await api.put(`/domain-manager/domains/${encodeURIComponent(id)}/mail-settings`, payload)).data;
