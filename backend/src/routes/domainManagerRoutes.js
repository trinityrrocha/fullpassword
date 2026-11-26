const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const { requireModuleEnabled } = require('../services/modulesService');
const { guard } = require('../services/reauthService');
const { domainManagerLookupLimiter } = require('../middleware/writeRateLimiters');
const controller = require('../controllers/domainManagerController');

const uuidParam = (name) => (req, res, next) => require('../middleware/uuidParam').requireUuidParam(req, res, next, req.params[name]);

// Order matters: authenticate first, then refuse everything while the module is off.
router.use(verifyToken);
router.use(requireModuleEnabled('domain_manager'));

// Read-only routes open to the Super Admin and to accounts with a grant (scoped to their domains in the handlers).
router.get('/domains', controller.requireDomainAccess, controller.list);
router.get('/domains/:id', controller.requireDomainAccess, controller.detail);
router.post('/domains/:id/check', controller.requireDomainAccess, domainManagerLookupLimiter, controller.check);

// Everything below is Super Admin only.
router.use(requireSuperAdmin);

router.post('/domains', controller.add);
router.post('/domains/import', controller.importList);
router.delete('/domains/:id', controller.remove);
router.get('/access', controller.listAccess);
router.get('/access/domains', controller.listAccessDomains);
router.put('/access/:userId', uuidParam('userId'), guard('domain_manager_access', 'userId'), controller.saveAccess);
router.delete('/access/:userId', uuidParam('userId'), guard('domain_manager_access', 'userId'), controller.revokeAccess);
router.get('/domains/:id/alerts', controller.getAlerts);
router.put('/domains/:id/alerts', controller.saveAlerts);
router.get('/domains/:id/mail-settings', controller.getMailSettings);
router.put('/domains/:id/mail-settings', controller.saveMailSettings);
router.get('/settings', controller.getSettings);
router.put('/settings', controller.saveSettings);

module.exports = router;
