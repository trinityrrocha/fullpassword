const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { verifyToken } = require('../middleware/authMiddleware');

// Todas as rotas de clientes requerem autenticação
router.use(verifyToken);

// GET /api/clients
router.get('/', clientController.getClients);

// POST /api/clients
router.post('/', clientController.createClient);
router.put('/:clientId', clientController.updateClient);
// Deleting a client cascades every record, history and envelope: owner or Super Admin, after reauth.
router.delete('/:clientId', require('../services/reauthService').guard('client_delete', 'clientId'), clientController.deleteClient);
router.get('/:clientId/modules', clientController.getClientModules);
router.put('/:clientId/modules', clientController.updateClientModules);
router.put('/:clientId/domain-expiration-notifications', clientController.updateDomainExpirationNotifications);
router.delete('/:clientId/modules/:moduleId', clientController.deleteClientModule);

module.exports = router;
