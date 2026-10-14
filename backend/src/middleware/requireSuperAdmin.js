const { isSuperAdmin } = require('../config/security');

module.exports = (req, res, next) => {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito ao Super Admin.', code: 'SUPER_ADMIN_REQUIRED' });
  }
  return next();
};
