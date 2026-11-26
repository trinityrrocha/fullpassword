import api from './api';

// Thin wrappers over the dashboard API (Super Admin only). The server decides what each card contains.
export const getDashboard = async () => (await api.get('/dashboard')).data;
export const saveDashboardLayout = async (layout) => (await api.put('/dashboard/layout', layout)).data.layout;
export const resetDashboardLayout = async () => (await api.delete('/dashboard/layout')).data.layout;
