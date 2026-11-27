const { getService, DomainError, UUID_PATTERN } = require('../services/domainManagerService');
const { getAlertService } = require('../services/domainManagerAlerts');
const access = require('../services/domainManagerAccessService');
const { isSuperAdmin } = require('../config/security');
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

// Ordinary accounts see only what they were granted, and never the administration details (alert recipients, settings). A domain
// outside the grant answers "not found", never "forbidden": it must not reveal that the domain exists.
const publicRow = (domain) => { const { alerts, ...rest } = domain; return rest; };
const inScope = (req, id) => {
  const key = id.toLowerCase();
  if (req.dmScope && !req.dmScope.includes(key)) throw new DomainError('Domínio não encontrado.', 'DM_NOT_FOUND', 404);
  return key;
};

const list = handle(async (req, res, service) => {
  const { page, size, search, sort } = req.query;
  if (req.dmScope) {
    const result = await service.list({ page, size, search, sort, ids: req.dmScope });
    return res.status(200).json({ ...result, domains: result.domains.map(publicRow), role: 'user' });
  }
  await service.syncFromSpfbl();
  return res.status(200).json({ ...(await service.list({ page, size, search, sort })), settings: await service.getSettings(), role: 'super_admin' });
});
const detail = handle(async (req, res, service) => {
  const result = await service.detail(inScope(req, requireId(req)));
  return res.status(200).json(req.dmScope ? { ...result, domain: publicRow(result.domain) } : result);
});
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
  const domain = await service.checkDomain(inScope(req, requireId(req)), { manual: true });
  await audit(req, 'domain_manager_domain_checked', { domain: domain.name, result: domain.snapshot?.lookup_status });
  const fresh = await service.detail(domain.id);
  return res.status(200).json({ domain: req.dmScope ? publicRow(domain) : domain, changes: fresh.changes, mail: fresh.mail });
});
const getMailSettings = handle(async (req, res, service) => res.status(200).json(await service.getMailSettings(requireId(req))));
const saveMailSettings = handle(async (req, res, service) => {
  const id = requireId(req);
  const { domain } = await service.detail(id);
  const saved = await service.saveMailSettings(id, req.body, req.user.id);
  await audit(req, 'domain_manager_mail_settings_saved', { domain: domain.name, enabled: saved.enabled, selectors: saved.extra_selectors.length });
  return res.status(200).json(saved);
});
// One import at a time, and not more than one every 30 seconds: it calls the WHM servers.
const syncState = { inFlight: false, last: 0 };
const SYNC_COOLDOWN_MS = 30 * 1000;
const syncDomains = handle(async (req, res, service) => {
  const wait = syncState.last + SYNC_COOLDOWN_MS - Date.now();
  if (syncState.inFlight || wait > 0) return res.status(429).json({ code: 'DM_SYNC_COOLDOWN', error: 'Aguarde alguns segundos entre as sincronizações.' });
  syncState.inFlight = true; syncState.last = Date.now();
  try {
    const result = await service.syncDomains(req.user.id);
    await audit(req, 'domain_manager_domains_synced', { servers: result.servers.length, failed: result.failed, imported: result.imported, skipped: result.skipped || null });
    return res.status(200).json(result);
  } finally { syncState.inFlight = false; }
});
const getSettings = handle(async (_req, res, service) => res.status(200).json(await service.getSettings()));
const saveSettings = handle(async (req, res, service) => {
  const settings = await service.saveSettings(req.body);
  await audit(req, 'domain_manager_settings_saved', { check_interval_days: settings.check_interval_days, mail_check_enabled: settings.mail_check_enabled, mail_check_interval_days: settings.mail_check_interval_days, selectors: settings.dkim_selectors.length, dns_servers: settings.dns_servers.length, dmarc_no_report_warning: settings.dmarc_no_report_warning, ssl_check_enabled: settings.ssl_check_enabled });
  return res.status(200).json(settings);
});

const getAlerts = handle(async (req, res) => res.status(200).json(await getAlertService().getAlerts(requireId(req))));
const saveAlerts = handle(async (req, res, service) => {
  const id = requireId(req);
  const { domain } = await service.detail(id);
  const alerts = await getAlertService().saveAlerts(id, req.body, req.user.id);
  await audit(req, 'domain_manager_alerts_saved', { domain: domain.name, enabled: alerts.enabled, notify_admins: alerts.notify_admins, emails: alerts.emails.length });
  return res.status(200).json(alerts);
});

const mapAccessError = (res, error) => (error instanceof access.AccessError ? res.status(error.statusCode).json({ code: error.code, error: error.message }) : null);
const listAccess = async (_req, res) => res.status(200).json({ access: await access.listAccess() });
const listAccessDomains = handle(async (_req, res, service) => res.status(200).json({ domains: await service.listNames() }));
const saveAccess = async (req, res) => {
  try {
    const saved = await access.saveAccess(req.params.userId, req.body, req.user.id);
    await audit(req, 'domain_manager_access_saved', { target_user_id: saved.user_id, domains: saved.domains.length });
    return res.status(200).json({ access: saved });
  } catch (error) {
    await audit(req, 'domain_manager_access_saved', { reason: error?.code || 'internal_error' }, 'failed');
    if (mapAccessError(res, error)) return undefined;
    safeLogError('Falha ao salvar acesso ao Domain Manager.', { name: error?.name, code: error?.code }, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível salvar o acesso.' });
  }
};
const revokeAccess = async (req, res) => {
  try {
    const revoked = await access.revokeAccess(req.params.userId);
    await audit(req, 'domain_manager_access_revoked', { target_user_id: revoked.user_id });
    return res.status(200).json({ revoked: true });
  } catch (error) {
    await audit(req, 'domain_manager_access_revoked', { reason: error?.code || 'internal_error' }, 'failed');
    if (mapAccessError(res, error)) return undefined;
    safeLogError('Falha ao revogar acesso ao Domain Manager.', { name: error?.name, code: error?.code }, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível revogar o acesso.' });
  }
};

// Runs before the per-route handlers: the Super Admin sees everything (scope null), an account with a grant sees its domains,
// everyone else is refused.
const requireDomainAccess = async (req, res, next) => {
  try {
    if (isSuperAdmin(req.user)) { req.dmScope = null; return next(); }
    const scope = await access.getScope(req.user);
    if (!scope) return res.status(403).json({ code: 'DM_ACCESS_DENIED', error: 'Você não tem acesso ao Domain Manager.' });
    req.dmScope = scope;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  syncDomains, getMailSettings, saveMailSettings, requireDomainAccess, listAccess, listAccessDomains, saveAccess, revokeAccess, getAlerts, saveAlerts, list, detail, add, importList, remove, check, getSettings, saveSettings };
