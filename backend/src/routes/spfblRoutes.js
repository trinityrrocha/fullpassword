const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const { requireModuleEnabled } = require('../services/modulesService');
const { guardFixed } = require('../services/reauthService');
const { spfblTestLimiter } = require('../middleware/writeRateLimiters');
const controller = require('../controllers/spfblController');

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Order matters: authenticate first, then refuse everything while the module is off.
router.use(verifyToken);
router.use(requireModuleEnabled('spfbl'));

// Open to any account with a grant (checked in the handler, per request); everything below is Super Admin only.
router.get('/overview', asyncRoute(controller.overview));

router.get('/settings', requireSuperAdmin, asyncRoute(controller.getSettings));
router.put('/settings', requireSuperAdmin, guardFixed('spfbl_settings'), asyncRoute(controller.saveSettings));
router.post('/matrix/test', requireSuperAdmin, spfblTestLimiter, asyncRoute(controller.testMatrix));
router.post('/whm/test', requireSuperAdmin, spfblTestLimiter, asyncRoute(controller.testWhm));

router.get('/domains', requireSuperAdmin, asyncRoute(controller.listDomains));
router.post('/domains', requireSuperAdmin, asyncRoute(controller.addDomain));
router.post('/domains/sync', requireSuperAdmin, spfblTestLimiter, asyncRoute(controller.syncDomains));
router.delete('/domains/:id', requireSuperAdmin, (req, res, next) => require('../middleware/uuidParam').requireUuidParam(req, res, next, req.params.id), asyncRoute(controller.removeDomain));

const uuidParam = (name) => (req, res, next) => require('../middleware/uuidParam').requireUuidParam(req, res, next, req.params[name]);
router.get('/access', requireSuperAdmin, asyncRoute(controller.listAccess));
router.put('/access/:userId', requireSuperAdmin, uuidParam('userId'), guardFixed('spfbl_access'), asyncRoute(controller.saveAccess));
router.delete('/access/:userId', requireSuperAdmin, uuidParam('userId'), guardFixed('spfbl_access'), asyncRoute(controller.revokeAccess));

module.exports = router;
