const sent = require('../services/spfblSentService');
const db = require('../config/database');
const { recordAuditEvent } = require('../services/auditService');
const { ConfigEncryptionError } = require('../services/configSecretCrypto');
const { SpfblSettingsError } = require('../services/spfblSettingsService');
const servers = require('../services/spfblServersService');
const collectors = require('../services/spfblCollectors');
const matrix = require('../services/spfblMatrixClient');
const { MatrixError } = matrix;
const { WhmError } = require('../services/spfblWhmClient');
const domains = require('../services/spfblDomainsService');
const access = require('../services/spfblAccessService');
const history = require('../services/spfblHistoryService');
const release = require('../services/spfblReleaseService');
const repository = require('../services/spfblHistoryRepository');
const { integrationOf } = require('../services/spfblCollectorService');
const historySettings = require('../services/spfblHistorySettingsService');
const notifications = require('../services/spfblNotifications');
const auditService = require('../services/spfblAuditService');
const { isSuperAdmin } = require('../config/security');
const { canUserAccessModule } = require('../services/modulesService');
const { safeLogError } = require('../utils/safeLogger');

const CONFIG_KEY_MESSAGE = 'A chave de criptografia das configurações não está disponível ou é inválida. Defina CONFIG_ENCRYPTION_KEY no servidor e reinicie o backend.';

// Authorization (Super Admin) and the module toggle are enforced by the router before these handlers run.
const mapKnownError = (res, error) => {
  if (error instanceof sent.SentError) return res.status(error.statusCode).json({ code: error.code, error: error.message });
  if (error instanceof SpfblSettingsError || error instanceof MatrixError || error instanceof WhmError || error instanceof domains.DomainError || error instanceof access.AccessError || error instanceof history.HistoryError || error instanceof release.ReleaseError || error instanceof auditService.AuditError) {
    return res.status(error.statusCode).json({ code: error.code, error: error.message });
  }
  if (error instanceof ConfigEncryptionError) return res.status(503).json({ code: error.code, error: CONFIG_KEY_MESSAGE });
  return null;
};

// ---- WHM servers, each with its Matrix connection (Super Admin) ------------------------------------------------------
const listWhmServers = async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ servers: await servers.listServers(), limit: servers.SERVER_LIMIT }); };

const serverAudit = (action, handler) => async (req, res) => {
  try {
    const { status, body, metadata } = await handler(req);
    await recordAuditEvent({ user: req.user, action, status: 'success', req, metadata });
    return res.status(status).json(body);
  } catch (error) {
    await recordAuditEvent({ user: req.user, action, status: 'failed', req, metadata: { reason: error?.code || 'internal_error' } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError('Falha ao salvar servidor WHM do SPFBL.', error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível concluir a operação do servidor.' });
  }
};

// A changed Matrix account makes what was collected with the old one stale: it is dropped and a failed run is forgotten, so the next
// screen retries at once. The collector is rebuilt (it holds the credentials' source, not the secret, but its window state is per account).
const afterMatrixChange = async (previousUser) => {
  if (previousUser) await repository.purgeIntegration(integrationOf({ user: previousUser })).catch(() => {});
};

const createWhmServer = serverAudit('spfbl_whm_server_added', async (req) => {
  const { server, matrix_password_changed: matrixChanged } = await servers.createServer(req.body, req.user.id);
  // Never the secrets, hosts or users: only the name and what is configured.
  return { status: 201, body: { server }, metadata: { server: server.name, matrix_password_changed: matrixChanged, whm_token_changed: true } };
});
const updateWhmServer = serverAudit('spfbl_whm_server_updated', async (req) => {
  const result = await servers.updateServer(req.params.id, req.body, req.user.id);
  if (result.matrix_user_changed) { await afterMatrixChange(result.previous_matrix_user); collectors.forget(result.server.id); }
  // New credentials: a failed run of this connection is forgotten so the next screen retries at once.
  if (result.matrix_user_changed || result.matrix_password_changed) {
    const fresh = await servers.getMatrixCredentials(result.server.id).catch(() => null);
    if (fresh) await repository.resetRuns(integrationOf(fresh)).catch(() => {});
  }
  return { status: 200, body: { server: result.server }, metadata: { server: result.server.name, matrix_password_changed: result.matrix_password_changed, whm_token_changed: result.whm_token_changed } };
});
const removeWhmServer = serverAudit('spfbl_whm_server_removed', async (req) => {
  const removeDomains = req.body?.remove_domains;
  const result = await servers.removeServer(req.params.id, removeDomains);
  collectors.forget(req.params.id);
  return { status: 200, body: result, metadata: { server: result.name, remove_domains: removeDomains, domains_removed: result.domains_removed, domains_kept: result.domains_kept } };
});

// One test at a time and a cool-down between tests of the same server (also after failures), like the original portal.
const TEST_COOLDOWN_MS = 30000;
const testState = { inFlight: false, last: new Map() };
const resetTestState = () => { testState.inFlight = false; testState.last.clear(); };

const testMatrix = async (req, res) => {
  const now = Date.now();
  if (testState.inFlight) return res.status(429).json({ code: 'SPFBL_TEST_BUSY', error: 'Já há um teste em andamento. Aguarde alguns segundos.' });
  const wait = (testState.last.get(req.params.id) || 0) + TEST_COOLDOWN_MS - now;
  if (wait > 0) {
    return res.status(429).json({ code: 'SPFBL_TEST_COOLDOWN', error: 'Aguarde 30 segundos entre testes.', retry_after_seconds: Math.ceil(wait / 1000) });
  }
  testState.inFlight = true;
  testState.last.set(req.params.id, now);
  try {
    const result = await matrix.testConnection(await servers.getMatrixCredentials(req.params.id));
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

// Validation of credentials typed in the server form (nothing is stored). One at a time, a short cool-down per kind, audited with fixed
// tokens only. The WHM client keeps every network guard (public IPv4 only, pinned connection, read-only allow-list).
const VALIDATE_COOLDOWN_MS = 5000;
const validateState = { inFlight: false, last: new Map() };
const resetValidateState = () => { validateState.inFlight = false; validateState.last.clear(); };
const withValidation = (kind, auditAction, run) => async (req, res) => {
  const now = Date.now();
  if (validateState.inFlight) return res.status(429).json({ code: 'SPFBL_VALIDATE_BUSY', error: 'Já há uma validação em andamento. Aguarde alguns segundos.' });
  const wait = (validateState.last.get(kind) || 0) + VALIDATE_COOLDOWN_MS - now;
  if (wait > 0) return res.status(429).json({ code: 'SPFBL_TEST_COOLDOWN', error: 'Aguarde alguns segundos antes de validar de novo.', retry_after_seconds: Math.ceil(wait / 1000) });
  validateState.inFlight = true; validateState.last.set(kind, now);
  try {
    const result = await run(req);
    await recordAuditEvent({ user: req.user, action: auditAction, status: 'success', req, metadata: result.audit });
    return res.status(200).json(result.body);
  } catch (error) {
    await recordAuditEvent({ user: req.user, action: auditAction, status: 'failed', req, metadata: { reason: error?.code || 'internal_error', ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}) } });
    const handled = mapKnownError(res, error);
    if (handled) return handled;
    safeLogError(`Falha inesperada na validação (${kind}).`, error, { includeStack: false });
    return res.status(500).json({ error: 'Não foi possível validar as credenciais.' });
  } finally { validateState.inFlight = false; }
};
const validateWhm = withValidation('whm', 'spfbl_whm_test', async (req) => {
  const result = await domains.validateWhmCredentials(await servers.credentialsToValidate(req.body));
  return { body: result, audit: result };
});
const validateMatrix = withValidation('matrix', 'spfbl_matrix_test', async (req) => {
  const result = await matrix.testConnection(await servers.matrixCredentialsToValidate(req.body));
  return { body: { ok: true, message: 'Conexão com o Matrix confirmada.' }, audit: { diagnostic: result.diagnostic } };
});

// WHM calls (test and sync) share one lock and a cool-down: a whole server listing is heavy for the provider.
const WHM_COOLDOWN_MS = 30000;
const whmState = { inFlight: false, last: new Map() };
const resetWhmState = () => { whmState.inFlight = false; whmState.last.clear(); };

const withWhmGuard = (action, audit, run) => async (req, res) => {
  const now = Date.now();
  if (whmState.inFlight) return res.status(429).json({ code: 'SPFBL_WHM_BUSY', error: 'Já há uma consulta ao WHM em andamento. Aguarde alguns segundos.' });
  const key = req.params?.id || 'all';
  const wait = (whmState.last.get(key) || 0) + WHM_COOLDOWN_MS - now;
  if (wait > 0) {
    return res.status(429).json({ code: 'SPFBL_WHM_COOLDOWN', error: 'Aguarde 30 segundos entre consultas ao WHM.', retry_after_seconds: Math.ceil(wait / 1000) });
  }
  whmState.inFlight = true;
  whmState.last.set(key, now);
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

const testWhm = withWhmGuard('teste do WHM', 'spfbl_whm_test', (req) => domains.testWhm(req.params.id));
const syncWhmServer = withWhmGuard('sincronização de domínios', 'spfbl_domains_synced', (req) => domains.syncFromWhm(req.user.id, req.params.id));
const syncDomains = withWhmGuard('sincronização de domínios', 'spfbl_domains_synced', async (req) => {
  const result = await domains.syncAll(req.user.id);
  return { ...result, domains: result.servers.reduce((n, r) => n + (r.domains || 0), 0) };
});

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
    const [list, grants, serverList] = await Promise.all([domains.listDomains(), access.listAccess(), servers.listServers()]);
    return res.status(200).json({
      role: 'super_admin',
      matrix_configured: serverList.some((server) => server.matrix_configured),
      whm_configured: serverList.length > 0,
      servers: { total: serverList.length, with_matrix: serverList.filter((server) => server.matrix_configured).length },
      domains: { total: list.length, active: list.filter((d) => d.active).length, without_server: list.filter((d) => d.no_server).length },
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
// Servers (with a Matrix connection) that serve the given domains. A domain without server has none: its history is still readable.
const serversOfDomains = async (names) => {
  if (!names.length) return [];
  const ids = new Set((await db.query('SELECT DISTINCT server_id FROM spfbl_domains WHERE name = ANY($1::text[]) AND server_id IS NOT NULL', [names])).rows.map((r) => r.server_id));
  return (await servers.matrixServers()).filter((server) => ids.has(server.id));
};
const stateView = (state) => ({ loading: state.loading, partial: !state.complete, complete: state.complete, capped: state.capped, error: state.error,
  updated_at: state.updated_at, oldest_at: state.oldest_at, since: state.since, gap_before: state.gap_before, provider_limit: state.provider_limit, pages: 0, rows: 0, now: Date.now() });
const emptyView = () => ({ loading: false, partial: false, complete: true, capped: false, error: '', updated_at: null, oldest_at: null, since: null, gap_before: null, provider_limit: false, pages: 0, rows: 0, now: Date.now() });
const latest = (values) => values.filter(Boolean).sort().at(-1) || null;
const earliest = (values) => values.filter(Boolean).sort()[0] || null;
// One coverage line for all the servers involved: complete only if every one is, "reliable since" is the latest of them, any gap shows.
const mergeViews = (views) => (views.length === 0 ? emptyView() : {
  loading: views.some((v) => v.loading), partial: views.some((v) => v.partial), complete: views.every((v) => v.complete), capped: views.some((v) => v.capped),
  error: views.map((v) => v.error).find(Boolean) || '', updated_at: earliest(views.map((v) => v.updated_at)), oldest_at: latest(views.map((v) => v.oldest_at)),
  since: latest(views.map((v) => v.since)), gap_before: latest(views.map((v) => v.gap_before)), provider_limit: views.some((v) => v.provider_limit), pages: 0, rows: 0, now: Date.now()
});
// Starts (in the background) any crawl needed to cover the wanted window and returns what the screens show about coverage.
const loadHistory = async (names, windowStartTs, force = false) => {
  const views = [];
  for (const server of await serversOfDomains(names)) {
    const { state } = await collectors.forServer(server.id).ensure({ windowStartTs, force });
    views.push(stateView(state));
  }
  return { view: mergeViews(views) };
};
const retentionStart = async () => (Date.now() / 1000) - Number((await historySettings.read()).history_retention_days) * DAY;

const dashboard = guarded('dashboard', async (req, res) => {
  const scope = await scopeDomains(req.user);
  // Nothing authorized yet (or no active domain): no provider call, a clear empty answer.
  if (scope.length === 0) return res.status(200).json({ ...history.buildOverview([], []), latest_unlocks: [], domains_scope: [], state: emptyView() });
  const period = history.parseFilters({});
  const { view } = await loadHistory(scope, period.start_ts);
  const overview = await repository.overview({ domains: scope, startTs: period.start_ts, endTs: period.end_ts });
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
  const { view } = await loadHistory([domain], filters.start_ts);
  const unlockedIds = filters.status === 'Desbloqueados' ? [...await release.unlockedRecordIds(domain)] : [];
  const pageSize = history.parsePageSize(req.query.page_size);
  const selected = await repository.selectPage({ domain, filters, page: req.query.page, pageSize, unlockedIds });
  const info = await release.releaseInfo(selected.rows.map((r) => r.id));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ domain, domains_scope: scope, filters: { status: filters.status, by: filters.by, email: filters.email, start: filters.start, end: filters.end },
    rows: selected.rows.map((r) => history.publicRow(r, info.get(r.id) || null)), period_total: selected.period, filtered_total: selected.filtered, page: selected.page, pages: selected.pages, page_size: pageSize,
    // A domain without a query server keeps its history, but no action reaches the Matrix.
    domain_no_server: !(await servers.serverIdOfDomain(domain)),
    state: view });
});

// Sent mail: stored by the collection of each WHM server and read from the database. Same scope as the history: only the caller's domains.
const sentService = require('../services/spfblSentRuntime');
const sentList = guarded('e-mails enviados', async (req, res) => {
  const scope = await scopeDomains(req.user);
  if (scope.length === 0) return res.status(200).json({ domain: null, domains_scope: [], rows: [], filtered_total: 0, period_total: 0, page: 1, pages: 1, page_size: sent.PAGE_SIZES[0], filters: { period: '24h', status: 'all', by: 'any', q: '' }, truncated: false, servers_failed: 0 });
  // No domain chosen means the first domain of the scope (reading every domain at once is a choice, "all", not the default: it costs more).
  // Anything else must be a domain of the caller's scope.
  const chosen = req.query.domain === undefined || req.query.domain === '' ? [...scope].sort()[0] : String(req.query.domain);
  const domain = chosen === sent.ALL ? sent.ALL : requireDomain(scope, chosen);
  const admin = isSuperAdmin(req.user);
  const result = await sentService.search({ domain, scope, admin, query: req.query, diagnostics: admin });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ domain, domains_scope: scope, ...result });
});

const refreshHistory = guarded('atualização do histórico', async (req, res) => {
  const scope = await scopeDomains(req.user);
  const filters = history.parseFilters(req.body || {}, Date.now());
  const { view } = await loadHistory(scope, filters.start_ts, true);
  return res.status(200).json({ state: view });
});

// The provider status changed through this portal: reflect it in the stored copy right away (a failure here never blocks the action).
const markStatus = (id, status) => repository.setProviderStatus(id, status).catch(() => {});

const RECORD_ID = /^[a-f0-9]{64}$/;
const findRecord = async (req) => {
  const scope = await scopeDomains(req.user);
  const domain = requireDomain(scope, req.query.domain ?? req.body?.domain);
  if (!RECORD_ID.test(req.params.id)) throw new history.HistoryError('Registro indisponível. Atualize a consulta.', 'SPFBL_RECORD_NOT_FOUND', 404);
  const row = await repository.find(req.params.id, domain);
  if (!row) throw new history.HistoryError('Registro indisponível. Atualize a consulta.', 'SPFBL_RECORD_NOT_FOUND', 404);
  return { row, domain };
};
// Actions reach the Matrix with the connection of the domain's server, and only for records that connection collected itself.
// No server (or a record from another connection): the history stays readable, nothing else.
const readOnlyReason = async (row, domain) => {
  const serverId = await servers.serverIdOfDomain(domain);
  if (!serverId) return 'no_server';
  const credentials = await servers.getMatrixCredentials(serverId).catch(() => null);
  if (!credentials) return 'no_matrix';
  return row.integration && row.integration !== integrationOf(credentials) ? 'other_connection' : null;
};
const READ_ONLY_MESSAGES = {
  no_server: 'Este domínio está sem servidor de consulta: só o histórico fica disponível.',
  no_matrix: 'O servidor deste domínio não tem conexão Matrix: só o histórico fica disponível.',
  other_connection: 'Este registro foi coletado por outra conexão Matrix: só o histórico fica disponível.'
};
const actionCredentials = async (row, domain) => {
  const reason = await readOnlyReason(row, domain);
  if (reason) throw new release.ReleaseError(READ_ONLY_MESSAGES[reason], 'SPFBL_RECORD_READ_ONLY', 409);
  return servers.credentialsForDomain(domain);
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
  const reason = await readOnlyReason(row, domain);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ domain, record: history.publicRow(row, state.release), ...state,
    ...(reason ? { can_request: false, can_unlock: false, can_block: false, read_only: true, read_only_reason: reason, read_only_message: READ_ONLY_MESSAGES[reason] } : { read_only: false }) });
});

// Current provider status of one record: one at a time per account with a short cool-down.
const STATUS_COOLDOWN_MS = 8000;
const statusState = new Map();
const resetStatusState = () => statusState.clear();
const recordStatus = guarded('consulta de status', async (req, res) => {
  const { row, domain } = await findRecord(req);
  const credentials = await actionCredentials(row, domain);
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
  const { row, domain } = await findRecord(req);
  const credentials = await actionCredentials(row, domain);
  const result = await release.requestReview(await actorOf(req), row, domain, credentials);
  let mail = 'none';
  if (result.created) mail = await notifications.notifyAdmins(result.request);
  await audit(req, 'spfbl_review_requested', 'success', { domain, request_id: result.request.id, notification: toAuditMessage(mail) });
  return res.status(result.created ? 201 : 200).json({ request: release.publicRequest(result.request) });
});

const unlockRecord = guarded('desbloqueio', async (req, res) => {
  requireConfirmed(req);
  const { row, domain } = await findRecord(req);
  const credentials = await actionCredentials(row, domain);
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
  const { row, domain } = await findRecord(req);
  const credentials = await actionCredentials(row, domain);
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
  const names = catalogue.map((d) => d.name);
  const { view } = await loadHistory(names, period.start_ts);
  const counts = await repository.domainCounts({ domains: names, startTs: period.start_ts, endTs: period.end_ts });
  const activity = await release.domainActivity(period.start_ts, period.end_ts);
  const list = catalogue.map((d) => {
    const c = counts.get(d.name) || {};
    return { domain: d.name, active: d.active, source: d.source, server: d.server_name || null, no_server: d.no_server, total: c.total || 0, blocked: c.blocked || 0, banimento: c.banimento || 0, 'segurança': c.seguranca || 0, 'inexistência': c.inexistencia || 0,
      unlocked: activity.unlocked.get(d.name) || 0, pending: activity.pending.get(d.name) || 0 };
  }).sort((a, b) => (b.blocked - a.blocked) || (b.total - a.total) || (a.domain < b.domain ? -1 : 1));
  const totals = list.reduce((t, d) => ({ total: t.total + d.total, blocked: t.blocked + d.blocked }), { total: 0, blocked: 0 });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ domains: list, totals, period: { start: period.start, end: period.end, timezone: history.TIMEZONE }, state: view });
});

// ---- stored history: retention, schedule, manual collection (Super Admin) ------------------------------------------------
const getHistorySettings = guarded('configuração do histórico', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...(await historySettings.get()), running: collectors.isRunning() });
});
const saveHistorySettings = guarded('configuração do histórico', async (req, res) => {
  try {
    const result = await historySettings.update(req.body);
    await audit(req, 'spfbl_history_settings_updated', 'success', { retention_days: result.retention_days, interval_minutes: result.interval_minutes, deleted: result.deleted });
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
// Collects now: one server (body.server_id) or every server that has a Matrix connection. One at a time, with a short cool-down.
const collectNow = guarded('coleta do histórico', async (req, res) => {
  if (collectors.isRunning()) return res.status(409).json({ code: 'SPFBL_COLLECT_BUSY', error: 'Já há uma coleta em andamento.' });
  if (Date.now() - collectState.lastAt < COLLECT_COOLDOWN_MS) return res.status(429).json({ code: 'SPFBL_COLLECT_COOLDOWN', error: 'Aguarde um minuto antes de coletar de novo.' });
  const wanted = req.body?.server_id;
  const targets = (await servers.matrixServers()).filter((server) => !wanted || server.id === wanted);
  if (targets.length === 0) return res.status(422).json({ code: 'MATRIX_NOT_CONFIGURED', error: 'Nenhum servidor com conexão Matrix para coletar.' });
  collectState.lastAt = Date.now();
  const retention = Number((await historySettings.read()).history_retention_days);
  const run = async () => {
    for (const server of targets) {
      let outcome;
      try { outcome = await (await collectors.forServer(server.id).start({ trigger: 'manual', windowStartTs: Date.now() / 1000 - retention * DAY, retentionDays: retention })).done; } catch (error) {
        outcome = { status: 'failed', error: error?.code || 'COLLECT_FAILED', pages: 0, stored: 0 };
      }
      await recordAuditEvent({ user: req.user, action: 'spfbl_history_collected', status: outcome.status === 'failed' ? 'failed' : 'success', req,
        metadata: { run: 'manual', server: server.name, pages: outcome.pages, rows: outcome.stored, capped: outcome.status === 'capped', gap: Boolean(outcome.gap), ...(outcome.error ? { reason: String(outcome.error) } : {}) } }).catch(() => {});
    }
  };
  run();
  return res.status(202).json({ started: true, servers: targets.length });
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
const snapshotRow = async (request) => (await repository.find(request.record_id, request.domain)
  || { id: request.record_id, provider_key: request.provider_key, recipient: request.recipient, sender: request.sender, result: request.reason });
const keepRequest = decide('keep', (actor, req, input) => release.keep(actor, req.params.id, input.revision));
const releaseRequest = decide('release', async (actor, req, input) => {
  const request = await release.getRequest(req.params.id);
  const snapshot = await snapshotRow(request);
  const credentials = await actionCredentials(snapshot || { integration: null }, request.domain);
  const result = await release.execute(actor, { row: snapshot, domain: request.domain, requestId: request.id, revision: input.revision, proof: input.proof }, credentials);
  return result.request;
});
const blockRequest = decide('block', async (actor, req, input) => {
  const request = await release.getRequest(req.params.id);
  return release.blockAgain(actor, req.params.id, input, await actionCredentials(await snapshotRow(request) || { integration: null }, request.domain));
});

module.exports = {
  dashboard, historyList, refreshHistory, recordDetail, recordStatus, requestReview, unlockRecord, blockSender, adminDomains, auditList, listRequests, requestDetail, keepRequest, releaseRequest, blockRequest, resetStatusState, getHistorySettings, saveHistorySettings, collectNow, resetCollectState, STATUS_COOLDOWN_MS,
  validateWhm, validateMatrix, resetValidateState, listWhmServers, createWhmServer, updateWhmServer, removeWhmServer, testMatrix, resetTestState, TEST_COOLDOWN_MS,
  sentList, testWhm, syncWhmServer, syncDomains, listDomains, addDomain, removeDomain, resetWhmState, WHM_COOLDOWN_MS,
  listAccess, saveAccess, revokeAccess, overview
};
