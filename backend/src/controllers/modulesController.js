const { recordAuditEvent } = require('../services/auditService');
const { ModuleError, listModules, setModuleEnabled, getMenuModules } = require('../services/modulesService');
// Loading the SPFBL access service registers who may open the module (a grant), which the menu asks about.
require('../services/spfblAccessService');
const { safeLogError } = require('../utils/safeLogger');

const list = async (_req, res) => res.status(200).json({ modules: await listModules() });

const setState = async (req, res) => {
  const key = req.params.key;
  try {
    const module = await setModuleEnabled(key, req.body?.enabled, req.user.id);
    await recordAuditEvent({
      user: req.user,
      action: 'system_module_toggled',
      status: 'success',
      req,
      metadata: { module: module.key, enabled: module.enabled }
    });
    return res.status(200).json({ module });
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      action: 'system_module_toggled',
      status: 'failed',
      req,
      metadata: { module: String(key).slice(0, 32), reason: error?.code || 'internal_error' }
    });
    if (error instanceof ModuleError) return res.status(error.statusCode).json({ code: error.code, error: error.message });
    safeLogError('Falha ao alterar módulo do sistema.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível alterar o módulo.' });
  }
};

const menu = async (req, res) => res.status(200).json({ modules: await getMenuModules(req.user) });

module.exports = { list, setState, menu };
