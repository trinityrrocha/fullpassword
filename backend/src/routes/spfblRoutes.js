const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const { requireModuleEnabled } = require('../services/modulesService');
const { guard, guardFixed } = require('../services/reauthService');
const { spfblTestLimiter, spfblActionLimiter } = require('../middleware/writeRateLimiters');
const controller = require('../controllers/spfblController');

const uuidParam = (name) => (req, res, next) => require('../middleware/uuidParam').requireUuidParam(req, res, next, req.params[name]);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Order matters: authenticate first, then refuse everything while the module is off.
router.use(verifyToken);
router.use(requireModuleEnabled('spfbl'));

// Open to any account with a grant (checked in the handler, per request); everything below is Super Admin only.
router.get('/overview', asyncRoute(controller.overview));

// Read-only history views. Scope (current active domains of the caller) is resolved per request in the handlers.
router.get('/dashboard', asyncRoute(controller.dashboard));
router.get('/history', asyncRoute(controller.historyList));
router.post('/history/refresh', asyncRoute(controller.refreshHistory));
router.get('/records/:id', asyncRoute(controller.recordDetail));
router.post('/records/:id/status', spfblActionLimiter, asyncRoute(controller.recordStatus));
// Requests and decisions. CSRF comes from the shared middleware; each action is confirmed by a server-issued proof bound to the
// record state (no per-action reauthentication: the 5-per-15-minutes grant limiter would make a review session unusable).
router.post('/records/:id/request', spfblActionLimiter, asyncRoute(controller.requestReview));
router.post('/records/:id/unlock', spfblActionLimiter, asyncRoute(controller.unlockRecord));
router.post('/records/:id/block', spfblActionLimiter, asyncRoute(controller.blockSender));
router.get('/requests', asyncRoute(controller.listRequests));
router.get('/requests/:id', requireSuperAdmin, uuidParam('id'), asyncRoute(controller.requestDetail));
router.post('/requests/:id/keep', requireSuperAdmin, uuidParam('id'), spfblActionLimiter, asyncRoute(controller.keepRequest));
router.post('/requests/:id/release', requireSuperAdmin, uuidParam('id'), spfblActionLimiter, asyncRoute(controller.releaseRequest));
router.post('/requests/:id/block', requireSuperAdmin, uuidParam('id'), spfblActionLimiter, asyncRoute(controller.blockRequest));

router.get('/dashboard/domains', requireSuperAdmin, asyncRoute(controller.adminDomains));
router.get('/history-settings', requireSuperAdmin, asyncRoute(controller.getHistorySettings));
router.put('/history-settings', requireSuperAdmin, guardFixed('spfbl_settings'), asyncRoute(controller.saveHistorySettings));
router.post('/history/collect', requireSuperAdmin, spfblTestLimiter, asyncRoute(controller.collectNow));
router.get('/audit', requireSuperAdmin, asyncRoute(controller.auditList));

router.get('/whm-servers', requireSuperAdmin, asyncRoute(controller.listWhmServers));
router.post('/whm-servers', requireSuperAdmin, guardFixed('spfbl_settings'), asyncRoute(controller.createWhmServer));
router.put('/whm-servers/:id', requireSuperAdmin, uuidParam('id'), guardFixed('spfbl_settings'), asyncRoute(controller.updateWhmServer));
router.delete('/whm-servers/:id', requireSuperAdmin, uuidParam('id'), guardFixed('spfbl_settings'), asyncRoute(controller.removeWhmServer));
router.post('/whm-servers/:id/test', requireSuperAdmin, uuidParam('id'), spfblTestLimiter, asyncRoute(controller.testWhm));
router.post('/whm-servers/:id/sync', requireSuperAdmin, uuidParam('id'), spfblTestLimiter, asyncRoute(controller.syncWhmServer));
router.post('/whm-servers/:id/matrix/test', requireSuperAdmin, uuidParam('id'), spfblTestLimiter, asyncRoute(controller.testMatrix));

router.get('/domains', requireSuperAdmin, asyncRoute(controller.listDomains));
router.post('/domains', requireSuperAdmin, asyncRoute(controller.addDomain));
router.post('/domains/sync', requireSuperAdmin, spfblTestLimiter, asyncRoute(controller.syncDomains));
router.delete('/domains/:id', requireSuperAdmin, (req, res, next) => require('../middleware/uuidParam').requireUuidParam(req, res, next, req.params.id), asyncRoute(controller.removeDomain));

router.get('/access', requireSuperAdmin, asyncRoute(controller.listAccess));
router.put('/access/:userId', requireSuperAdmin, uuidParam('userId'), guard('spfbl_access', 'userId'), asyncRoute(controller.saveAccess));
router.delete('/access/:userId', requireSuperAdmin, uuidParam('userId'), guard('spfbl_access', 'userId'), asyncRoute(controller.revokeAccess));

module.exports = router;
