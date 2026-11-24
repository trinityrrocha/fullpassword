const { recordAuditEvent } = require('../services/auditService');
const { ConfigEncryptionError } = require('../services/configSecretCrypto');
const { SpfblSettingsError, getSettings, updateSettings, getMatrixCredentials } = require('../services/spfblSettingsService');
const matrix = require('../services/spfblMatrixClient');
const { MatrixError } = matrix;
const { WhmError } = require('../services/spfblWhmClient');
const domains = require('../services/spfblDomainsService');
const access = require('../services/spfblAccessService');
const history = require('../services/spfblHistoryService');
const release = require('../services/spfblReleaseService');
const repository = require('../services/spfblHistoryRepository');
const { createCollector, integrationOf } = require('../services/spfblCollectorService');
const historySettings = require('../services/spfblHistorySettingsService');
const notifications = require('../services/spfblNotifications');
const auditService = require('../services/spfblAuditService');
const { isSuperAdmin } = require('../config/security');
const { canUserAccessModule } = require('../services/modulesService');
const { safeLogError } = require('../utils/safeLogger');

const CONFIG_KEY_MESSAGE = 'A chave de criptografia das configurações não está disponível ou é inválida. Defina CONFIG_ENCRYPTION_KEY no servidor e reinicie o backend.';

// Authorization (Super Admin) and the module toggle are enforced by the router before these handlers run.
const mapKnownError = (res, error) => {
  if (error instanceof SpfblSettingsError || error instanceof MatrixError || error instanceof WhmError || error instanceof domains.DomainError || error instanceof access.AccessError || error instanceof history.HistoryError || error instanceof release.ReleaseError || error instanceof auditService.AuditError) {
    return res.status(error.statusCode).json({ code: error.code, error: error.message });
  }
  if (error instanceof ConfigEncryptionError) return res.status(503).json({ code: error.code, error: CONFIG_KEY_MESSAGE });
  return null;
};

const getSettingsHandler = async (_req, res) => res.status(200).json(await getSettings());

const saveSettings = async (req, res) => {
  try {
    const { settings, matrix_password_changed: matrixChanged, whm_token_changed: whmChanged } = await updateSettings(req.body, req.user.id);
    // new credentials: never serve the previous Matrix account's stored history
    const fresh = await getMatrixCredentials().catch(() => null);
    if (fresh) { await repository.purgeOtherIntegrations(integrationOf(fresh)).catch(() => {}); await repository.resetRuns(integrationOf(fresh)).catch(() => {}); }
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

// ---- history, dashboard, record detail (read only) ----------------------------------------------------------------
const collector = createCollector({
  fetchPage: (cursor, credentials) => matrix.historyPage(credentials, cursor),
  credentials: getMatrixCredentials,
  catalogue: async () => (await domains.listDomains()).map((d) => d.name)
});

// The caller's CURRENT domains (active only), resolved on every request: revoking access or deactivating a domain applies at once.
const scopeDomains = async (user) => {
  if (!(await canUserAccessModule('spfbl', user))) throw new access.AccessError('Você não tem acesso ao módulo SPFBL.', 'SPFBL_ACCESS_DENIED', 403);
  if (isSuperAdmin(user)) return (await domains.listDomains()).filter((d) => d.active).map((d) => d.name);
  const own = await access.getOwnAccess(user);
  if (!own) throw new access.AccessError('Você não tem acesso ao módulo SPFBL.', 'SPFBL_ACCESS_DENIED', 403);
  return own.domains.filter((d) => d.active).map((d) => d.name);
};
const requireDomain = (scope, value) => {
  const domain = history.normalizeDomain(value);
  if (!scope.includes(domain)) throw new access.AccessError('Domínio fora do seu acesso.', 'SPFBL_DOMAIN_FORBIDDEN', 403);
  return domain;
};
const guarded = (action, handler) => async (req, res) => {
  try { return await handler(req, res); } catch (error) {
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError(`Falha em ${action} do SPFBL.`, error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível concluir a consulta do SPFBL.' });
  }
};
const DAY = 86400;
// Starts (in the background) any crawl needed to cover the wanted window and returns what the screens show about coverage.
const loadHistory = async (windowStartTs, force = false) => {
  const credentials = await getMatrixCredentials();
  const { integration, state } = await collector.ensure({ windowStartTs, force });
  return { integration, state, view: stateView(state) };
};
const stateView = (state) => ({ loading: state.loading, partial: !state.complete, complete: state.complete, capped: state.capped, error: state.error,
  updated_at: state.updated_at, oldest_at: state.oldest_at, pages: 0, rows: 0, now: Date.now() });
const emptyView = () => ({ loading: false, partial: false, complete: true, capped: false, error: '', updated_at: null, oldest_at: null, pages: 0, rows: 0, now: Date.now() });
const retentionStart = async () => (Date.now() / 1000) - Number((await historySettings.read()).history_retention_days) * DAY;

const dashboard = guarded('dashboard', async (req, res) => {
  const scope = await scopeDomains(req.user);
  // Nothing authorized yet (or no active domain): no provider call, a clear empty answer.
  if (scope.length === 0) return res.status(200).json({ ...history.buildOverview([], []), latest_unlocks: [], domains_scope: [], state: emptyView() });
  const period = history.parseFilters({});
  const { integration, view } = await loadHistory(period.start_ts);
  const overview = await repository.overview({ integration, domains: scope, startTs: period.start_ts, endTs: period.end_ts });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...overview, period: { start: period.start, end: period.end, timezone: history.TIMEZONE }, latest_unlocks: await release.latestUnlocks(scope), domains_scope: scope, state: view });
});

const historyList = guarded('histórico', async (req, res) => {
  const scope = await scopeDomains(req.user);
  if (scope.length === 0) {
    const f = history.parseFilters({});
    return res.status(200).json({ domain: null, domains_scope: [], filters: { status: f.status, by: f.by, email: '', start: f.start, end: f.end }, rows: [], period_total: 0, filtered_total: 0, page: 1, pages: 1, state: emptyView() });
  }
  const domain = requireDomain(scope, req.query.domain ?? scope[0]);
  const filters = history.parseFilters(req.query);
  const keptSince = await retentionStart();
  if (filters.start_ts < keptSince - DAY) {
    const days = Number((await historySettings.read()).history_retention_days);
    throw new history.HistoryError(`O histórico é guardado por ${days} dias. Escolha uma data inicial mais recente.`, 'SPFBL_FILTER_RETENTION', 422, 'start');
  }
  const { integration, view } = await loadHistory(filters.start_ts);
  const unlockedIds = filters.status === 'Desbloqueados' ? [...await release.unlockedRecordIds(domain)] : [];
  const selected = await repository.selectPage({ integration, domain, filters, page: req.query.page, unlockedIds });
  const info = await release.releaseInfo(selected.rows.map((r) => r.id));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ domain, domains_scope: scope, filters: { status: filters.status, by: filters.by, email: filters.email, start: filters.start, end: filters.end },
    rows: selected.rows.map((r) => history.publicRow(r, info.get(r.id) || null)), period_total: selected.period, filtered_total: selected.filtered, page: selected.page, pages: selected.pages,
    state: view });
});

const refreshHistory = guarded('atualização do histórico', async (req, res) => {
  await scopeDomains(req.user);
  const filters = history.parseFilters(req.body || {}, Date.now());
  const { view } = await loadHistory(filters.start_ts, true);
  return res.status(200).json({ state: view });
});

// The provider status changed through this portal: reflect it in the stored copy right away (a failure here never blocks the action).
const markStatus = (id, status) => repository.setProviderStatus(id, status).catch(() => {});

const RECORD_ID = /^[a-f0-9]{64}$/;
const findRecord = async (req) => {
  const scope = await scopeDomains(req.user);
  const domain = requireDomain(scope, req.query.domain ?? req.body?.domain);
  if (!RECORD_ID.test(req.params.id)) throw new history.HistoryError('Registro indisponível. Atualize a consulta.', 'SPFBL_RECORD_NOT_FOUND', 404);
  const credentials = await getMatrixCredentials();
  const row = await repository.find(integrationOf(credentials), req.params.id, domain);
  if (!row) throw new history.HistoryError('Registro indisponível. Atualize a consulta.', 'SPFBL_RECORD_NOT_FOUND', 404);
  return { row, domain, credentials };
};

// The caller as the release service needs it, resolved per request (scope and unlock mode are never taken from the client).
const actorOf = async (req) => {
  const scope = await scopeDomains(req.user);
  const superAdmin = isSuperAdmin(req.user);
  const own = superAdmin ? null : await access.getOwnAccess(req.user);
  return { user: { id: req.user.id }, isSuperAdmin: superAdmin, scope, unlockMode: superAdmin ? 'direct' : (own?.unlock_mode || 'review') };
};
const audit = (req, action, status, metadata) => recordAuditEvent({ user: req.user, action, status, req, metadata });

const recordDetail = guarded('detalhe do registro', async (req, res) => {
  const { row, domain } = await findRecord(req);
  const state = await release.recordState(await actorOf(req), row);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ domain, record: history.publicRow(row, state.release), ...state });
});

// Current provider status of one record: one at a time per account with a short cool-down.
const STATUS_COOLDOWN_MS = 8000;
const statusState = new Map();
const resetStatusState = () => statusState.clear();
const recordStatus = guarded('consulta de status', async (req, res) => {
  const { row, domain, credentials } = await findRecord(req);
  const last = statusState.get(req.user.id) || 0;
  if (Date.now() - last < STATUS_COOLDOWN_MS) return res.status(429).json({ code: 'SPFBL_STATUS_COOLDOWN', error: 'Aguarde alguns segundos antes de consultar de novo.' });
  statusState.set(req.user.id, Date.now());
  const result = await release.checkCurrent(await actorOf(req), row, domain, credentials);
  const meaning = { WHITELISTED: 'Liberado no SPFBL', BLOCKED: 'Bloqueado no SPFBL', NONE: 'Sem regra no SPFBL', UNKNOWN: 'Situação não informada' };
  await audit(req, 'spfbl_status_checked', 'success', { domain, provider_status: result.provider_status });
  return res.status(200).json({ provider_status: result.provider_status, label: meaning[result.provider_status], changed_reason: result.changed_reason });
});

const requireConfirmed = (req) => {
  if (req.body?.confirm !== true) throw new release.ReleaseError('Confirme a solicitação antes de enviar.', 'SPFBL_CONFIRM_REQUIRED', 422);
};
const toAuditMessage = (result) => ({ skipped: 'smtp_skipped', sent: 'sent' }[result] || 'none');

const requestReview = guarded('solicitação de revisão', async (req, res) => {
  requireConfirmed(req);
  const { row, domain, credentials } = await findRecord(req);
  const result = await release.requestReview(await actorOf(req), row, domain, credentials);
  let mail = 'none';
  if (result.created) mail = await notifications.notifyAdmins(result.request);
  await audit(req, 'spfbl_review_requested', 'success', { domain, request_id: result.request.id, notification: toAuditMessage(mail) });
  return res.status(result.created ? 201 : 200).json({ request: release.publicRequest(result.request) });
});

const unlockRecord = guarded('desbloqueio', async (req, res) => {
  requireConfirmed(req);
  const { row, domain, credentials } = await findRecord(req);
  try {
    const result = await release.execute(await actorOf(req), { row, domain, proof: req.body?.proof }, credentials);
    await markStatus(row.id, 'WHITELISTED');
    await audit(req, 'spfbl_unlock_done', 'success', { domain, request_id: result.request.id, mode: 'direct' });
    return res.status(200).json({ request: release.publicRequest(result.request) });
  } catch (error) {
    await audit(req, 'spfbl_unlock_done', 'failed', { domain, reason: error?.code || 'internal_error', ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}) });
    throw error;
  }
});

const blockSender = guarded('bloqueio do remetente', async (req, res) => {
  requireConfirmed(req);
  const { row, domain, credentials } = await findRecord(req);
  try {
    const request = await release.blockRecord(await actorOf(req), { row, domain, proof: req.body?.proof }, credentials);
    await markStatus(row.id, 'BLOCKED');
    await audit(req, 'spfbl_block_done', 'success', { domain, request_id: request.id });
    return res.status(200).json({ request: release.publicRequest(request) });
  } catch (error) {
    await audit(req, 'spfbl_block_done', 'failed', { domain, reason: error?.code || 'internal_error', ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}) });
    throw error;
  }
});

// Super Admin: results of EVERY registered domain (active or not) over the dashboard window.
const adminDomains = guarded('visão dos domínios', async (req, res) => {
  const catalogue = await domains.listDomains();
  const period = history.parseFilters({});
  const credentials = await getMatrixCredentials().catch(() => null);
  let view = emptyView();
  let counts = new Map();
  if (credentials) {
    const loaded = await loadHistory(period.start_ts);
    view = loaded.view;
    counts = await repository.domainCounts({ integration: loaded.integration, domains: catalogue.map((d) => d.name), startTs: period.start_ts, endTs: period.end_ts });
  }
  const activity = await release.domainActivity(period.start_ts, period.end_ts);
  const list = catalogue.map((d) => {
    const c = counts.get(d.name) || {};
    return { domain: d.name, active: d.active, source: d.source, total: c.total || 0, blocked: c.blocked || 0, banimento: c.banimento || 0, 'segurança': c.seguranca || 0, 'inexistência': c.inexistencia || 0,
      unlocked: activity.unlocked.get(d.name) || 0, pending: activity.pending.get(d.name) || 0 };
  }).sort((a, b) => (b.blocked - a.blocked) || (b.total - a.total) || (a.domain < b.domain ? -1 : 1));
  const totals = list.reduce((t, d) => ({ total: t.total + d.total, blocked: t.blocked + d.blocked }), { total: 0, blocked: 0 });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ domains: list, totals, period: { start: period.start, end: period.end, timezone: history.TIMEZONE }, state: view });
});

// ---- stored history: retention, schedule, manual collection (Super Admin) ------------------------------------------------
const currentIntegration = async () => integrationOf(await getMatrixCredentials().catch(() => ({ user: '' })));
const getHistorySettings = guarded('configuração do histórico', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...(await historySettings.get(await currentIntegration())), running: collector.isRunning() });
});
const saveHistorySettings = guarded('configuração do histórico', async (req, res) => {
  try {
    const result = await historySettings.update(req.body, await currentIntegration());
    await audit(req, 'spfbl_history_settings_updated', 'success', { retention_days: result.retention_days, schedule_hour: result.schedule_hour, deleted: result.deleted });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof historySettings.HistorySettingsError) {
      await audit(req, 'spfbl_history_settings_updated', 'failed', { reason: error.code });
      return res.status(error.statusCode).json({ code: error.code, error: error.message, ...(error.rows_to_delete !== undefined ? { rows_to_delete: error.rows_to_delete } : {}) });
    }
    throw error;
  }
});
const COLLECT_COOLDOWN_MS = 60000;
const collectState = { lastAt: 0 };
const resetCollectState = () => { collectState.lastAt = 0; };
const collectNow = guarded('coleta do histórico', async (req, res) => {
  if (collector.isRunning()) return res.status(409).json({ code: 'SPFBL_COLLECT_BUSY', error: 'Já há uma coleta em andamento.' });
  if (Date.now() - collectState.lastAt < COLLECT_COOLDOWN_MS) return res.status(429).json({ code: 'SPFBL_COLLECT_COOLDOWN', error: 'Aguarde um minuto antes de coletar de novo.' });
  collectState.lastAt = Date.now();
  const retention = Number((await historySettings.read()).history_retention_days);
  const started = await collector.start({ trigger: 'manual', windowStartTs: Date.now() / 1000 - retention * DAY, retentionDays: retention });
  started.done.then((outcome) => recordAuditEvent({ user: req.user, action: 'spfbl_history_collected', status: outcome.status === 'failed' ? 'failed' : 'success', req,
    metadata: { run: 'manual', pages: outcome.pages, rows: outcome.stored, capped: outcome.status === 'capped', ...(outcome.error ? { reason: String(outcome.error) } : {}) } })).catch(() => {});
  return res.status(202).json({ started: started.started });
});

const auditList = guarded('auditoria', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(await auditService.list(req.query));
});

const listRequests = guarded('lista de solicitações', async (req, res) => {
  const actor = await actorOf(req);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ requests: await release.listRequests(actor, { status: req.query.status }), is_admin: actor.isSuperAdmin });
});

const requestDetail = guarded('detalhe da solicitação', async (req, res) => {
  const actor = await actorOf(req);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(await release.requestDetail(actor, req.params.id));
});

const decisionInput = (req) => {
  const { revision, notify, proof } = req.body || {};
  if (!Number.isInteger(revision) || revision < 0 || (notify !== undefined && typeof notify !== 'boolean') || (proof !== undefined && typeof proof !== 'string')) {
    throw new release.ReleaseError('Decisão inválida. Recarregue a solicitação.', 'SPFBL_DECISION_INVALID', 422);
  }
  return { revision, notify: notify === true, proof };
};
const decide = (action, run) => guarded(`decisão (${action})`, async (req, res) => {
  const input = decisionInput(req);
  const actor = await actorOf(req);
  try {
    const request = await run(actor, req, input);
    if (action !== 'keep') await markStatus(request.record_id, action === 'release' ? 'WHITELISTED' : 'BLOCKED');
    const mail = input.notify ? await notifications.notifyDecision(request, { keep: 'kept', release: 'unlocked', block: 'reblocked' }[action]) : 'none';
    await audit(req, `spfbl_request_${action}`, 'success', { request_id: request.id, domain: request.domain, notification: toAuditMessage(mail) });
    return res.status(200).json({ request: release.publicRequest(request, { admin: true }), notification: mail });
  } catch (error) {
    await audit(req, `spfbl_request_${action}`, 'failed', { request_id: req.params.id, reason: error?.code || 'internal_error', ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}) });
    throw error;
  }
});
const snapshotRow = async (request, credentials) => (await repository.find(integrationOf(credentials), request.record_id, request.domain)
  || { id: request.record_id, provider_key: request.provider_key, recipient: request.recipient, sender: request.sender, result: request.reason });
const keepRequest = decide('keep', (actor, req, input) => release.keep(actor, req.params.id, input.revision));
const releaseRequest = decide('release', async (actor, req, input) => {
  const request = await release.getRequest(req.params.id);
  const credentials = await getMatrixCredentials();
  const result = await release.execute(actor, { row: await snapshotRow(request, credentials), domain: request.domain, requestId: request.id, revision: input.revision, proof: input.proof }, credentials);
  return result.request;
});
const blockRequest = decide('block', async (actor, req, input) => release.blockAgain(actor, req.params.id, input, await getMatrixCredentials()));

module.exports = {
  dashboard, historyList, refreshHistory, recordDetail, recordStatus, requestReview, unlockRecord, blockSender, adminDomains, auditList, listRequests, requestDetail, keepRequest, releaseRequest, blockRequest, resetStatusState, getHistorySettings, saveHistorySettings, collectNow, resetCollectState, collector, STATUS_COOLDOWN_MS,
  getSettings: getSettingsHandler, saveSettings, testMatrix, resetTestState, TEST_COOLDOWN_MS,
  testWhm, syncDomains, listDomains, addDomain, removeDomain, resetWhmState, WHM_COOLDOWN_MS,
  listAccess, saveAccess, revokeAccess, overview
};
