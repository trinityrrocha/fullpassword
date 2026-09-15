const crypto = require('crypto');
const path = require('path');
const db = require('../config/database');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const store = require('../services/updateStatusStore');

function createUpdateStatusController({ database = db, audit = recordAuditEvent, root = store.rootDirectory() } = {}) {
  const authorize = async (req, res) => {
    if (isSuperAdmin(req.user)) return true;
    await audit({ user: req.user, action: 'system_update_check_denied', status: 'denied', req });
    res.status(403).json({ error: 'Acesso permitido apenas ao Super Admin.' });
    return false;
  };
  const readTrustedStatus = () => {
    const status = store.readStatus(root);
    const installed = store.readInstalledCommit(root);
    return installed && status.installed_commit === installed ? status : { ...store.emptyStatus(), installed_commit: installed };
  };
  const getStatus = async (req, res) => {
    if (!await authorize(req, res)) return;
    const status = readTrustedStatus();
    const result = await database.query('SELECT update_notification_seen_commit FROM user_notification_state WHERE user_id = $1', [req.user.id]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...status,
      installed_commit_short: status.installed_commit?.slice(0, 7) || null,
      available_commit_short: status.available_commit?.slice(0, 7) || null,
      update_available: status.state === 'update_available',
      notification_unread: status.state === 'update_available' && result.rows[0]?.update_notification_seen_commit !== status.available_commit
    });
  };
  const requestCheck = async (req, res) => {
    if (!await authorize(req, res)) return;
    if (Object.keys(req.body || {}).length) return res.status(400).json({ error: 'Esta operação não recebe parâmetros.' });
    const requestId = crypto.randomUUID();
    store.atomicWrite(path.join(root, 'check-requests', `${requestId}.json`), JSON.stringify({
      request_id: requestId, requested_by_user_id: req.user.id, requested_by_email: req.user.email,
      requested_at: new Date().toISOString()
    }));
    await audit({ user: req.user, action: 'system_update_check_request', status: 'accepted', req, metadata: { request_id: requestId } });
    return res.status(202).json({ message: 'Verificação de atualização solicitada.', request_id: requestId, estimatedTime: 15 });
  };
  const markSeen = async (req, res) => {
    if (!await authorize(req, res)) return;
    if (Object.keys(req.body || {}).length) return res.status(400).json({ error: 'Esta operação não recebe parâmetros.' });
    const status = readTrustedStatus();
    if (status.state === 'update_available') {
      await database.query(`INSERT INTO user_notification_state (user_id, update_notification_seen_commit, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (user_id) DO UPDATE
        SET update_notification_seen_commit = EXCLUDED.update_notification_seen_commit, updated_at = CURRENT_TIMESTAMP`, [req.user.id, status.available_commit]);
      await audit({ user: req.user, action: 'system_update_notification_seen', status: 'success', req });
    }
    return res.json({ notification_unread: false, seen_commit: status.state === 'update_available' ? status.available_commit : null });
  };
  return { getStatus, requestCheck, markSeen };
}

module.exports = { ...createUpdateStatusController(), createUpdateStatusController };
