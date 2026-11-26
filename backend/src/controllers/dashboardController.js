const { getService } = require('../services/dashboardService');
const { safeLogError } = require('../utils/safeLogger');

// Super Admin only (enforced by the routes). The overview is one request so the page paints once; a card that fails reports itself.
const handle = (action) => async (req, res) => {
  try { return await action(req, res, getService()); } catch (error) {
    safeLogError('Falha no dashboard.', { name: error?.name, code: error?.code }, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível carregar o dashboard.' });
  }
};

const overview = handle(async (req, res, service) => {
  const [cards, layout] = await Promise.all([service.overview(), service.getLayout(req.user.id)]);
  return res.status(200).json({ generated_at: new Date().toISOString(), layout, cards });
});
const saveLayout = handle(async (req, res, service) => {
  const layout = await service.saveLayout(req.user.id, req.body);
  if (!layout) return res.status(422).json({ error: 'Disposição inválida.', code: 'DASHBOARD_LAYOUT_INVALID' });
  return res.status(200).json({ layout });
});
const resetLayout = handle(async (req, res, service) => res.status(200).json({ layout: await service.resetLayout(req.user.id) }));

module.exports = { overview, saveLayout, resetLayout };
