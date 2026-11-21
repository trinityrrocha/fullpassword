const { recordAuditEvent } = require('../services/auditService');
const { ConfigEncryptionError } = require('../services/configSecretCrypto');
const { SpfblSettingsError, getSettings, updateSettings, getMatrixCredentials } = require('../services/spfblSettingsService');
const matrix = require('../services/spfblMatrixClient');
const { MatrixError } = matrix;
const { WhmError } = require('../services/spfblWhmClient');
const domains = require('../services/spfblDomainsService');
const access = require('../services/spfblAccessService');
const { isSuperAdmin } = require('../config/security');
const { canUserAccessModule } = require('../services/modulesService');
const { safeLogError } = require('../utils/safeLogger');

const CONFIG_KEY_MESSAGE = 'A chave de criptografia das configurações não está disponível ou é inválida. Defina CONFIG_ENCRYPTION_KEY no servidor e reinicie o backend.';

// Authorization (Super Admin) and the module toggle are enforced by the router before these handlers run.
const mapKnownError = (res, error) => {
  if (error instanceof SpfblSettingsError || error instanceof MatrixError || error instanceof WhmError || error instanceof domains.DomainError || error instanceof access.AccessError) {
    return res.status(error.statusCode).json({ code: error.code, error: error.message });
  }
  if (error instanceof ConfigEncryptionError) return res.status(503).json({ code: error.code, error: CONFIG_KEY_MESSAGE });
  return null;
};

const getSettingsHandler = async (_req, res) => res.status(200).json(await getSettings());

const saveSettings = async (req, res) => {
  try {
    const { settings, matrix_password_changed: matrixChanged, whm_token_changed: whmChanged } = await updateSettings(req.body, req.user.id);
    await recordAuditEvent({
      user: req.user,
      action: 'spfbl_settings_updated',
      status: 'success',
      req,
      // Never the secrets, never the hosts or users: only what changed and what is configured.
      metadata: { matrix_password_changed: matrixChanged, whm_token_changed: whmChanged, matrix_configured: settings.has_matrix_password, whm_configured: settings.has_whm_token }
    });
    return res.status(200).json(settings);
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'spfbl_settings_updated', status: 'failed', req, metadata: { reason: error?.code || 'internal_error' } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError('Falha ao salvar configuração do SPFBL.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível salvar a configuração do SPFBL.' });
  }
};

// One test at a time and a cool-down between tests (also after failures), like the original portal.
const TEST_COOLDOWN_MS = 30000;
const testState = { inFlight: false, lastStartedAt: 0 };
const resetTestState = () => { testState.inFlight = false; testState.lastStartedAt = 0; };

const testMatrix = async (req, res) => {
  const now = Date.now();
  if (testState.inFlight) return res.status(429).json({ code: 'SPFBL_TEST_BUSY', error: 'Já há um teste em andamento. Aguarde alguns segundos.' });
  const wait = testState.lastStartedAt + TEST_COOLDOWN_MS - now;
  if (wait > 0) {
    return res.status(429).json({ code: 'SPFBL_TEST_COOLDOWN', error: 'Aguarde 30 segundos entre testes.', retry_after_seconds: Math.ceil(wait / 1000) });
  }
  testState.inFlight = true;
  testState.lastStartedAt = now;
  try {
    const result = await matrix.testConnection(await getMatrixCredentials());
    await recordAuditEvent({ user: req.user, action: 'spfbl_matrix_test', status: 'success', req, metadata: { diagnostic: result.diagnostic } });
    return res.status(200).json({ ok: true, message: 'Conexão com o Matrix confirmada.' });
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      action: 'spfbl_matrix_test',
      status: 'failed',
      req,
      metadata: { reason: error?.code || 'internal_error', ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}) }
    });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError('Falha inesperada no teste do Matrix.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível testar a conexão com o Matrix.' });
  } finally {
    testState.inFlight = false;
  }
};


// WHM calls (test and sync) share one lock and a cool-down: a whole server listing is heavy for the provider.
const WHM_COOLDOWN_MS = 30000;
const whmState = { inFlight: false, lastStartedAt: 0 };
const resetWhmState = () => { whmState.inFlight = false; whmState.lastStartedAt = 0; };

const withWhmGuard = (action, audit, run) => async (req, res) => {
  const now = Date.now();
  if (whmState.inFlight) return res.status(429).json({ code: 'SPFBL_WHM_BUSY', error: 'Já há uma consulta ao WHM em andamento. Aguarde alguns segundos.' });
  const wait = whmState.lastStartedAt + WHM_COOLDOWN_MS - now;
  if (wait > 0) {
    return res.status(429).json({ code: 'SPFBL_WHM_COOLDOWN', error: 'Aguarde 30 segundos entre consultas ao WHM.', retry_after_seconds: Math.ceil(wait / 1000) });
  }
  whmState.inFlight = true;
  whmState.lastStartedAt = now;
  try {
    const result = await run(req);
    await recordAuditEvent({ user: req.user, action: audit, status: 'success', req, metadata: result });
    return res.status(200).json(result);
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: audit, status: 'failed', req, metadata: { reason: error?.code || 'internal_error', ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}) } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError(`Falha inesperada em ${action}.`, error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível concluir a consulta ao WHM.' });
  } finally {
    whmState.inFlight = false;
  }
};

const testWhm = withWhmGuard('teste do WHM', 'spfbl_whm_test', () => domains.testWhm());
const syncDomains = withWhmGuard('sincronização de domínios', 'spfbl_domains_synced', (req) => domains.syncFromWhm(req.user.id));

const listDomains = async (_req, res) => res.status(200).json({ domains: await domains.listDomains() });

const addDomain = async (req, res) => {
  try {
    const domain = await domains.addManualDomain(req.body?.name, req.user.id);
    await recordAuditEvent({ user: req.user, action: 'spfbl_domain_added', status: 'success', req, metadata: { domain: domain.name } });
    return res.status(201).json({ domain });
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'spfbl_domain_added', status: 'failed', req, metadata: { reason: error?.code || 'internal_error' } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError('Falha ao cadastrar domínio do SPFBL.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível cadastrar o domínio.' });
  }
};

const removeDomain = async (req, res) => {
  try {
    const removed = await domains.removeDomain(req.params.id);
    await recordAuditEvent({ user: req.user, action: 'spfbl_domain_removed', status: 'success', req, metadata: { domain: removed.name } });
    return res.status(200).json({ removed: true });
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'spfbl_domain_removed', status: 'failed', req, metadata: { reason: error?.code || 'internal_error' } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError('Falha ao remover domínio do SPFBL.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível remover o domínio.' });
  }
};

const listAccess = async (_req, res) => res.status(200).json({ access: await access.listAccess() });

const saveAccess = async (req, res) => {
  try {
    const saved = await access.saveAccess(req.params.userId, req.body, req.user.id);
    await recordAuditEvent({
      user: req.user,
      action: 'spfbl_access_saved',
      status: 'success',
      req,
      metadata: { target_user_id: saved.user_id, unlock_mode: saved.unlock_mode, domains: saved.domains.length }
    });
    return res.status(200).json({ access: saved });
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'spfbl_access_saved', status: 'failed', req, metadata: { reason: error?.code || 'internal_error' } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError('Falha ao salvar acesso ao SPFBL.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível salvar o acesso.' });
  }
};

const revokeAccess = async (req, res) => {
  try {
    const revoked = await access.revokeAccess(req.params.userId);
    await recordAuditEvent({ user: req.user, action: 'spfbl_access_revoked', status: 'success', req, metadata: { target_user_id: revoked.user_id } });
    return res.status(200).json({ revoked: true });
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: 'spfbl_access_revoked', status: 'failed', req, metadata: { reason: error?.code || 'internal_error' } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError('Falha ao revogar acesso ao SPFBL.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível revogar o acesso.' });
  }
};

// The page's first read. Super Admin: configuration summary. Anyone else: only their own scope.
const overview = async (req, res) => {
  if (!(await canUserAccessModule('spfbl', req.user))) return res.status(403).json({ error: 'Você não tem acesso ao módulo SPFBL.', code: 'SPFBL_ACCESS_DENIED' });
  if (isSuperAdmin(req.user)) {
    const [settings, list, grants] = await Promise.all([getSettings(), domains.listDomains(), access.listAccess()]);
    return res.status(200).json({
      role: 'super_admin',
      matrix_configured: Boolean(settings.matrix_user && settings.has_matrix_password),
      whm_configured: Boolean(settings.whm_host && settings.has_whm_token),
      domain_sync_at: settings.domain_sync_at,
      domain_sync_status: settings.domain_sync_status,
      domains: { total: list.length, active: list.filter((d) => d.active).length },
      users_with_access: grants.length
    });
  }
  const own = await access.getOwnAccess(req.user);
  return res.status(200).json({
    role: 'user',
    unlock_mode: own?.unlock_mode || 'review',
    domains: (own?.domains || []).map(({ id, name, active }) => ({ id, name, active }))
  });
};

module.exports = {
  getSettings: getSettingsHandler, saveSettings, testMatrix, resetTestState, TEST_COOLDOWN_MS,
  testWhm, syncDomains, listDomains, addDomain, removeDomain, resetWhmState, WHM_COOLDOWN_MS,
  listAccess, saveAccess, revokeAccess, overview
};
