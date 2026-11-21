const { recordAuditEvent } = require('../services/auditService');
const { ConfigEncryptionError } = require('../services/configSecretCrypto');
const { SpfblSettingsError, getSettings, updateSettings, getMatrixCredentials } = require('../services/spfblSettingsService');
const matrix = require('../services/spfblMatrixClient');
const { MatrixError } = matrix;
const { safeLogError } = require('../utils/safeLogger');

const CONFIG_KEY_MESSAGE = 'A chave de criptografia das configurações não está disponível ou é inválida. Defina CONFIG_ENCRYPTION_KEY no servidor e reinicie o backend.';

// Authorization (Super Admin) and the module toggle are enforced by the router before these handlers run.
const mapKnownError = (res, error) => {
  if (error instanceof SpfblSettingsError || error instanceof MatrixError) {
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

module.exports = { getSettings: getSettingsHandler, saveSettings, testMatrix, resetTestState, TEST_COOLDOWN_MS };
