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
