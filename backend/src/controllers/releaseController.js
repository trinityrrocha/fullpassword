const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../config/database');
const { consume } = require('../services/reauthService');
const { isSuperAdmin } = require('../config/security');
const { recordAuditEvent } = require('../services/auditService');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const createController = (publicDirectory='/var/lib/fullpassword-release-public', queueDirectory='/var/lib/fullpassword-release-queue') => {
const readJson = name => {
  const file = path.join(publicDirectory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('INVALID_AGENT_STATE');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const catalog = () => {
  const value = readJson('catalog.json');
  if (!uuid.test(value.approvalId) || !/^[a-f0-9]{40}$/.test(value.revision) || !/^[a-f0-9]{64}$/.test(value.manifestHash) ||
    !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new Error('NO_APPROVED_RELEASE');
  return value;
};
const status = (req, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Acesso restrito ao Super Admin.' });
  let release = null, progress = null;
  try { release = catalog(); } catch { /* not provisioned or expired */ }
  try {
    const value = readJson('status.json');
    progress = Object.fromEntries(['approvalId','requestId','revision','backend','frontend','state','startedAt','healthyAt','finishedAt','errorCode'].filter(key => value[key] !== undefined).map(key => [key,value[key]]));
  } catch { /* no request yet */ }
  let requested = false;
  if (release) requested = fs.existsSync(path.join(queueDirectory, release.approvalId + '.json'));
  res.json({ release, progress, requested });
};
const request = async (req, res) => {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'Acesso restrito ao Super Admin.' });
  const client = await db.pool.connect();
  try {
    const keys = Object.keys(req.body).filter(key => key !== '_reauth_token').sort().join(',');
    if (keys !== 'approvalId,manifestHash,revision') return res.status(400).json({ code: 'INVALID_RELEASE_REQUEST', error: 'Solicitação de release inválida.' });
    const release = catalog();
    if (['approvalId','manifestHash','revision'].some(key => req.body[key] !== release[key])) return res.status(409).json({ code: 'APPROVAL_CHANGED', error: 'A aprovação mudou. Atualize o painel.' });
    await client.query('BEGIN');
    await consume(client, req, 'system_release');
    await recordAuditEvent({queryable:client,throwOnError:true,user:req.user,req,action:'signed_release_requested',status:'success',metadata:{revision:release.revision,approval_id:release.approvalId}});
    await client.query('COMMIT'); // credentials/grant are never written to the untrusted queue
    const requestId = crypto.randomUUID();
    const file = path.join(queueDirectory, release.approvalId + '.json');
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ approvalId:release.approvalId, revision:release.revision, manifestHash:release.manifestHash, requestId })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    res.status(202).json({ requestId, state:'requested' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === 'EEXIST') return res.status(409).json({ code:'ALREADY_REQUESTED',error:'Esta aprovação já foi solicitada. Consulte o progresso.' });
    res.status(error.statusCode || 503).json({ code:error.code === 'REAUTH_REQUIRED' ? error.code : 'RELEASE_REQUEST_UNAVAILABLE',purpose:error.purpose,error:'Não foi possível solicitar a release. Consulte o progresso antes de tentar novamente.' });
  } finally { client.release(); }
};
return { status, request };
};
module.exports = { ...createController(), createController };
