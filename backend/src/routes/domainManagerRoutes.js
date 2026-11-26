const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const { requireModuleEnabled } = require('../services/modulesService');
const { domainManagerLookupLimiter } = require('../middleware/writeRateLimiters');
const controller = require('../controllers/domainManagerController');

// Order matters: authenticate first, then refuse everything while the module is off. This phase is Super Admin only.
router.use(verifyToken);
router.use(requireModuleEnabled('domain_manager'));
router.use(requireSuperAdmin);

router.get('/domains', controller.list);
router.post('/domains', controller.add);
router.post('/domains/import', controller.importList);
router.get('/domains/:id', controller.detail);
router.delete('/domains/:id', controller.remove);
router.post('/domains/:id/check', domainManagerLookupLimiter, controller.check);
router.get('/domains/:id/alerts', controller.getAlerts);
router.put('/domains/:id/alerts', controller.saveAlerts);
router.get('/settings', controller.getSettings);
router.put('/settings', controller.saveSettings);

module.exports = router;
