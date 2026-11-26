const { getService, DomainError, UUID_PATTERN } = require('../services/domainManagerService');
const { recordAuditEvent } = require('../services/auditService');
const { safeLogError } = require('../utils/safeLogger');

// Super Admin only (enforced by the routes). Errors are mapped to a stable code; nothing from a registry reply is echoed.
const handle = (action) => async (req, res) => {
  try {
    return await action(req, res, getService());
  } catch (error) {
    if (error instanceof DomainError) return res.status(error.statusCode).json({ code: error.code, error: error.message });
    safeLogError('Falha no Domain Manager.', { name: error?.name, code: error?.code }, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível concluir a operação.' });
  }
};
const audit = (req, action, metadata = {}, status = 'success') => recordAuditEvent({ user: req.user, action, status, req, metadata });
const requireId = (req) => {
  if (!UUID_PATTERN.test(String(req.params.id || ''))) throw new DomainError('Identificador inválido.', 'DM_ID_INVALID', 400);
  return req.params.id;
};

const list = handle(async (req, res, service) => {
  await service.syncFromSpfbl();
  const { page, size, search, sort } = req.query;
  return res.status(200).json({ ...(await service.list({ page, size, search, sort })), settings: await service.getSettings() });
});
const detail = handle(async (req, res, service) => res.status(200).json(await service.detail(requireId(req))));
const add = handle(async (req, res, service) => {
  const domain = await service.addDomain(req.body?.name, req.user.id);
  await audit(req, 'domain_manager_domain_added', { domain: domain.name });
  return res.status(201).json({ domain });
});
const importList = handle(async (req, res, service) => {
  const result = await service.importDomains(req.body?.names, req.user.id);
  await audit(req, 'domain_manager_domains_imported', { added: result.added, duplicates: result.duplicates, invalid: result.invalid.length });
  return res.status(200).json(result);
});
const remove = handle(async (req, res, service) => {
  const id = requireId(req);
  const { domain } = await service.detail(id);
  await service.removeDomain(id);
  await audit(req, 'domain_manager_domain_removed', { domain: domain.name });
  return res.status(200).json({ ok: true });
});
const check = handle(async (req, res, service) => {
  const domain = await service.checkDomain(requireId(req), { manual: true });
  await audit(req, 'domain_manager_domain_checked', { domain: domain.name, result: domain.snapshot?.lookup_status });
  return res.status(200).json({ domain, changes: (await service.detail(domain.id)).changes });
});
const getSettings = handle(async (_req, res, service) => res.status(200).json(await service.getSettings()));
const saveSettings = handle(async (req, res, service) => {
  const settings = await service.saveSettings(req.body);
  await audit(req, 'domain_manager_settings_saved', { check_interval_days: settings.check_interval_days });
  return res.status(200).json(settings);
});

module.exports = { list, detail, add, importList, remove, check, getSettings, saveSettings };
