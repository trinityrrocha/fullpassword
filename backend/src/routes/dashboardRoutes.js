const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const controller = require('../controllers/dashboardController');

router.use(verifyToken);
router.use(requireSuperAdmin);
router.get('/', controller.overview);
router.put('/layout', controller.saveLayout);
router.delete('/layout', controller.resetLayout);

module.exports = router;
