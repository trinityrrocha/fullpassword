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

router.get('/settings', requireSuperAdmin, asyncRoute(controller.getSettings));
router.put('/settings', requireSuperAdmin, guardFixed('spfbl_settings'), asyncRoute(controller.saveSettings));
router.post('/matrix/test', requireSuperAdmin, spfblTestLimiter, asyncRoute(controller.testMatrix));

module.exports = router;
