const crypto = require('node:crypto');
const db = require('../config/database');
const matrixClient = require('./spfblMatrixClient');
const { classify } = require('./spfblHistoryService');

// Port of Releases.php (review requests, admin decisions, direct unlock, re-block, current status).
// Invariants (the provider call is NOT transactional, so everything is ordered around it):
//  1. one operation per record, claimed with a row lock in PostgreSQL (no process-wide lock needed);
//  2. the "processing" intent is committed BEFORE the provider call;
//  3. any doubt after the call (error, timeout, unconfirmed answer) is recorded as "uncertain" and never retried by us;
//  4. a leftover "processing" (crash between intent and answer) is turned into "uncertain" after STALE_MS, never retried.
class ReleaseError extends Error {
  constructor(message, code, statusCode = 409, extra = {}) {
    super(message);
    this.name = 'ReleaseError';
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, extra);
  }
}

const STALE_MS = 10 * 60 * 1000;
const ACTIVE_FOR_RELEASE = ['pending', 'failed'];
const LABELS = {
  pending: 'Aguardando revisão', processing: 'Liberação em processamento', unlocked: 'Desbloqueado pelo SPFBL',
  reopened: 'Bloqueado novamente; nova solicitação disponível', reblocked: 'Bloqueado novamente pelo administrador', kept: 'Bloqueio mantido',
  failed: 'Falha antes do envio', uncertain: 'Resultado não confirmado'
};
const label = (status) => LABELS[status] || 'Situação desconhecida';

// A server-issued proof bound to the account and to the exact record state the person saw (result, operation revision).
// A changed record or a stale page makes it fail, so a confirmation always refers to what is currently true.
const confirmationKey = () => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('spfbl-confirmation-v1').digest();
const confirmation = (userId, row) => crypto.createHmac('sha256', confirmationKey())
  .update(JSON.stringify([userId, ...['id', 'provider_key', 'recipient', 'sender', 'result'].map((k) => row[k] ?? ''), Number(row.operation_revision) || 0])).digest('hex');
const checkConfirmation = (userId, row, proof) => {
  const expected = Buffer.from(confirmation(userId, row), 'hex');
  const given = typeof proof === 'string' && /^[a-f0-9]{64}$/.test(proof) ? Buffer.from(proof, 'hex') : Buffer.alloc(0);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new ReleaseError('O registro mudou ou a confirmação expirou. Reabra os detalhes e confirme o motivo atual.', 'SPFBL_CONFIRMATION_STALE', 409);
  }
};

// The registry answer is the same record the history listed. If it omits the key we asked for, the asked key is the identity
// (recipient and sender are still compared, so a different record is still refused).
const normalizeLive = (live, key, integration) => {
  const { normalizeRecord } = require('./spfblHistoryService');
  return normalizeRecord({ ...live, key: live?.key ?? live?.timekey ?? key }, integration);
};

const integrationHash = (user) => crypto.createHash('sha256').update(user).digest('hex');

const transaction = async (work) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
};

const reconcileStale = async () => {
  const stale = await db.query(`UPDATE spfbl_operations SET status = 'uncertain', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'processing' AND updated_at < CURRENT_TIMESTAMP - ($1::text || ' milliseconds')::interval RETURNING record_id`, [String(STALE_MS)]);
  if (stale.rows.length) {
    await db.query(`UPDATE spfbl_requests SET status = 'uncertain', revision = revision + 1, result_info = 'Sem confirmação; conferir no fornecedor'
      WHERE status = 'processing' AND record_id = ANY($1::char(64)[])`, [stale.rows.map((r) => r.record_id)]);
  }
};

const readOperation = async (recordId, queryable = db) => {
  const result = await queryable.query('SELECT status, revision FROM spfbl_operations WHERE record_id = $1', [recordId]);
  return result.rows[0] ? { status: result.rows[0].status, revision: Number(result.rows[0].revision) } : { status: null, revision: 0 };
};
const withContext = async (row) => ({ ...row, operation_revision: (await readOperation(row.id)).revision });

// ---- authorization -----------------------------------------------------------------------------------------------
// actor = { user, isSuperAdmin, scope: [active domains], unlockMode: 'review'|'direct' } resolved per request by the controller.
const assertRecord = (actor, row, domain) => {
  if (!actor.scope.includes(domain) || !row.recipient.endsWith(`@${domain}`)) throw new ReleaseError('Registro fora do domínio autorizado.', 'SPFBL_DOMAIN_FORBIDDEN', 403);
  if (classify(row.result).status !== 'Bloqueados') throw new ReleaseError('Este registro não está classificado como bloqueado.', 'SPFBL_RECORD_NOT_BLOCKED', 409);
};
const assertDirect = (actor) => {
  if (!actor.isSuperAdmin && actor.unlockMode !== 'direct') throw new ReleaseError('Sua conta deve solicitar revisão ao administrador.', 'SPFBL_REVIEW_REQUIRED', 403);
};
const assertAdmin = (actor) => { if (!actor.isSuperAdmin) throw new ReleaseError('Acesso não permitido.', 'SPFBL_ADMIN_ONLY', 403); };
const assertIntegration = (request, credentials) => {
  if (request.integration_hash !== integrationHash(credentials.user)) throw new ReleaseError('Esta solicitação pertence a outra conta Matrix. Restaure a integração original antes de liberar.', 'SPFBL_INTEGRATION_CHANGED', 409);
};

const rowOfRequest = (request) => ({ id: request.record_id, provider_key: request.provider_key, recipient: request.recipient, sender: request.sender, result: request.reason });
const publicRequest = (r, { admin = false } = {}) => ({
  id: r.id, domain: r.domain, recipient: r.recipient, sender: r.sender, reason: classify(r.reason).reason, icon: classify(r.reason).icon,
  status: r.status, status_label: label(r.status), source: r.source, revision: Number(r.revision), result_info: r.result_info,
  requested_at: r.requested_at, reviewed_at: r.reviewed_at, ...(admin ? { actor_name: r.actor_name || null, reviewer_name: r.reviewer_name || null } : {}),
  can_keep: admin && ['pending', 'failed'].includes(r.status), can_release: admin && ['pending', 'failed'].includes(r.status), can_block: admin && ['unlocked', 'kept'].includes(r.status)
});
const getRequest = async (id, queryable = db) => {
  const result = await queryable.query(`SELECT r.*, u.name AS actor_name, v.name AS reviewer_name FROM spfbl_requests r
    LEFT JOIN users u ON u.id = r.actor_id LEFT JOIN users v ON v.id = r.reviewed_by WHERE r.id = $1`, [id]);
  if (!result.rows[0]) throw new ReleaseError('Solicitação não encontrada.', 'SPFBL_REQUEST_NOT_FOUND', 404);
  return result.rows[0];
};
const checkRevision = (request, revision) => {
  if (revision !== undefined && revision !== null && Number(revision) !== Number(request.revision)) throw new ReleaseError('Esta decisão mudou desde que a página foi aberta. Recarregue antes de continuar.', 'SPFBL_REVISION_CHANGED', 409);
};
const event = (client, actorId, request, action) => client.query(
  'INSERT INTO spfbl_release_events (request_id, actor_id, domain, recipient, sender, reason, action) VALUES ($1, $2, $3, $4, $5, $6, $7)',
  [request.id, actorId, request.domain, request.recipient, request.sender, request.reason, action]
);

// ---- review request (accounts in "review" mode) ---------------------------------------------------------------------
const requestReview = async (actor, row, domain, credentials) => {
  assertRecord(actor, row, domain);
  await reconcileStale();
  const op = await readOperation(row.id);
  if (['done', 'processing', 'uncertain'].includes(op.status)) throw new ReleaseError('Já existe uma liberação ou tentativa registrada para este e-mail. Consulte o administrador.', 'SPFBL_ALREADY_HANDLED', 409);
  return transaction(async (client) => {
    const existing = (await client.query('SELECT * FROM spfbl_requests WHERE record_id = $1 AND actor_id = $2 FOR UPDATE', [row.id, actor.user.id])).rows[0];
    if (existing) {
      if (['reopened', 'reblocked'].includes(existing.status)) {
        const updated = (await client.query(`UPDATE spfbl_requests SET status = 'pending', revision = revision + 1, requested_at = CURRENT_TIMESTAMP, reviewed_by = NULL, reviewed_at = NULL,
          result_info = 'Nova revisão solicitada' WHERE id = $1 RETURNING *`, [existing.id])).rows[0];
        return { request: updated, created: true };
      }
      return { request: existing, created: false };
    }
    // Two concurrent submits of the same person: the unique (record, account) index decides; the loser reads the winner's row.
    const insert = await client.query(`INSERT INTO spfbl_requests (record_id, actor_id, domain, recipient, sender, provider_key, integration_hash, reason, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'review') ON CONFLICT (record_id, actor_id) WHERE actor_id IS NOT NULL DO NOTHING RETURNING *`,
    [row.id, actor.user.id, domain, row.recipient, row.sender, row.provider_key, integrationHash(credentials.user), row.result]);
    if (insert.rows[0]) return { request: insert.rows[0], created: true };
    return { request: (await client.query('SELECT * FROM spfbl_requests WHERE record_id = $1 AND actor_id = $2', [row.id, actor.user.id])).rows[0], created: false };
  });
};

// ---- admin: keep the block (no provider call) -----------------------------------------------------------------------
const keep = async (actor, id, revision) => {
  assertAdmin(actor);
  return transaction(async (client) => {
    const request = (await client.query('SELECT * FROM spfbl_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!request) throw new ReleaseError('Solicitação não encontrada.', 'SPFBL_REQUEST_NOT_FOUND', 404);
    checkRevision(request, revision);
    if (!['pending', 'failed'].includes(request.status)) throw new ReleaseError('A solicitação já foi tratada ou tem resultado incerto. Atualize a lista.', 'SPFBL_REQUEST_NOT_OPEN', 409);
    const updated = (await client.query(`UPDATE spfbl_requests SET status = 'kept', revision = revision + 1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP,
      result_info = 'Sem liberação enviada ao SPFBL' WHERE id = $1 RETURNING *`, [id, actor.user.id])).rows[0];
    await event(client, actor.user.id, updated, 'kept');
    return updated;
  });
};

// ---- the unlock itself -----------------------------------------------------------------------------------------------
// requestId === null: direct unlock by the caller. Otherwise an admin releasing a request.
const execute = async (actor, { row, domain, requestId = null, revision, proof }, credentials, matrix = matrixClient) => {
  assertRecord(actor, row, domain);
  if (requestId === null) assertDirect(actor); else assertAdmin(actor);
  await reconcileStale();
  const context = await withContext(row);
  checkConfirmation(actor.user.id, context, proof);
  let request = null;
  if (requestId !== null) {
    request = await getRequest(requestId);
    checkRevision(request, revision);
    if (request.record_id !== row.id || !ACTIVE_FOR_RELEASE.includes(request.status)) throw new ReleaseError('Esta solicitação não está disponível para liberar.', 'SPFBL_REQUEST_NOT_OPEN', 409);
    assertIntegration(request, credentials);
  }
  const op = await readOperation(row.id);
  if (op.status === 'done') throw new ReleaseError('O SPFBL já confirmou a liberação deste registro. Nenhuma nova chamada foi feita.', 'SPFBL_ALREADY_DONE', 409);
  if (['processing', 'uncertain'].includes(op.status)) throw new ReleaseError('Há uma tentativa com resultado não confirmado. Confira no SPFBL antes de qualquer nova liberação.', 'SPFBL_OPERATION_UNCERTAIN', 409);
  if (op.revision !== context.operation_revision) throw new ReleaseError('A situação mudou. Reabra o registro.', 'SPFBL_OPERATION_CHANGED', 409);

  // The request row exists before anything leaves for the provider, so a failure leaves a durable trail.
  const requestRow = request || (await transaction(async (client) => {
    const existing = (await client.query('SELECT * FROM spfbl_requests WHERE record_id = $1 AND actor_id = $2 FOR UPDATE', [row.id, actor.user.id])).rows[0];
    if (existing) {
      if (!['pending', 'failed', 'reopened', 'reblocked'].includes(existing.status)) throw new ReleaseError('Este registro já tem uma decisão. Consulte o histórico de solicitações.', 'SPFBL_ALREADY_HANDLED', 409);
      return existing;
    }
    const insert = await client.query(`INSERT INTO spfbl_requests (record_id, actor_id, domain, recipient, sender, provider_key, integration_hash, reason, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'direct') ON CONFLICT (record_id, actor_id) WHERE actor_id IS NOT NULL DO NOTHING RETURNING *`,
    [row.id, actor.user.id, domain, row.recipient, row.sender, row.provider_key, integrationHash(credentials.user), row.result]);
    if (insert.rows[0]) return insert.rows[0];
    const raced = (await client.query('SELECT * FROM spfbl_requests WHERE record_id = $1 AND actor_id = $2 FOR UPDATE', [row.id, actor.user.id])).rows[0];
    if (!['pending', 'failed', 'reopened', 'reblocked'].includes(raced.status)) throw new ReleaseError('Este registro já tem uma decisão. Consulte o histórico de solicitações.', 'SPFBL_ALREADY_HANDLED', 409);
    return raced;
  }));

  const failBeforeSend = async (message, code, status) => {
    await db.query("UPDATE spfbl_requests SET status = 'failed', result_info = $2 WHERE id = $1", [requestRow.id, 'Sem envio; nada foi enviado ao SPFBL']);
    throw new ReleaseError(`Nenhuma liberação foi enviada ao SPFBL. ${message}`, code, status);
  };
  let live;
  try { live = await matrix.registry(credentials, row.provider_key); } catch (error) { return failBeforeSend(error.message, error.code || 'SPFBL_MATRIX_FAILED', error.statusCode || 502); }
  const liveRow = normalizeLive(live, row.provider_key, integrationHash(credentials.user));
  if (!liveRow || liveRow.id !== row.id || liveRow.recipient !== row.recipient || liveRow.sender !== row.sender) return failBeforeSend('O SPFBL retornou um registro diferente. Atualize a consulta antes de liberar.', 'SPFBL_RECORD_MISMATCH', 409);
  if (liveRow.result !== row.result) return failBeforeSend('O motivo mudou. Atualize o Histórico deste domínio e reabra esta decisão para confirmar o novo motivo.', 'SPFBL_REASON_CHANGED', 409);

  // Commit the intent BEFORE the non-transactional provider mutation; the row lock makes a second claim impossible.
  await transaction(async (client) => {
    await client.query("INSERT INTO spfbl_operations (record_id, status, actor_id) VALUES ($1, 'blocked', $2) ON CONFLICT (record_id) DO NOTHING", [row.id, actor.user.id]);
    const locked = (await client.query('SELECT status, revision FROM spfbl_operations WHERE record_id = $1 FOR UPDATE', [row.id])).rows[0];
    if (locked.status !== 'blocked' || Number(locked.revision) !== context.operation_revision) throw new ReleaseError('Outra operação está em andamento ou a situação mudou. Reabra o registro.', 'SPFBL_OPERATION_CHANGED', 409);
    await client.query("UPDATE spfbl_operations SET status = 'processing', actor_id = $2, updated_at = CURRENT_TIMESTAMP WHERE record_id = $1", [row.id, actor.user.id]);
    await client.query(`UPDATE spfbl_requests SET status = 'processing', revision = revision + 1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP,
      result_info = 'Envio iniciado; aguardando confirmação' WHERE id = $1`, [requestRow.id, actor.user.id]);
  });
  let diagnostic = '';
  try { diagnostic = (await matrix.unlock(credentials, row.provider_key)).diagnostic || ''; } catch (error) {
    await transaction(async (client) => {
      await client.query("UPDATE spfbl_operations SET status = 'uncertain', updated_at = CURRENT_TIMESTAMP WHERE record_id = $1", [row.id]);
      await client.query("UPDATE spfbl_requests SET status = 'uncertain', revision = revision + 1, result_info = $2 WHERE id = $1", [requestRow.id, `Sem confirmação; ${String(error.diagnostic || '').slice(0, 100)}`]);
    });
    throw new ReleaseError(`O SPFBL não confirmou o resultado. A tentativa foi registrada e não será repetida automaticamente. Consulte o administrador.${error.diagnostic ? ` [${error.diagnostic}]` : ''}`, 'SPFBL_UNCERTAIN', 503, { diagnostic: error.diagnostic });
  }
  const done = await transaction(async (client) => {
    const current = (await client.query('SELECT * FROM spfbl_requests WHERE id = $1', [requestRow.id])).rows[0];
    await event(client, actor.user.id, current, 'unlocked');
    await client.query("UPDATE spfbl_operations SET status = 'done', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE record_id = $1", [row.id]);
    await client.query(`UPDATE spfbl_requests SET status = 'unlocked', revision = revision + 1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, result_info = 'DONE: sender whitelisted'
      WHERE record_id = $1 AND status IN ('pending', 'failed', 'processing', 'reopened', 'reblocked')`, [row.id, actor.user.id]);
    return (await client.query('SELECT * FROM spfbl_requests WHERE id = $1', [requestRow.id])).rows[0];
  });
  return { request: done, diagnostic };
};

// ---- current status lookup: a confirmed BLOCKED after a completed unlock re-opens it -------------------------------------
const checkCurrent = async (actor, row, domain, credentials, matrix = matrixClient) => {
  assertRecord(actor, row, domain);
  const live = normalizeLive(await matrix.registry(credentials, row.provider_key), row.provider_key, integrationHash(credentials.user));
  if (!live || live.id !== row.id || live.recipient !== row.recipient) throw new ReleaseError('O SPFBL retornou um registro diferente. Atualize a consulta.', 'SPFBL_RECORD_MISMATCH', 409);
  if (live.provider_status === 'UNKNOWN') throw new ReleaseError('O SPFBL não informou a situação atual (status). O motivo original não comprova um novo bloqueio.', 'SPFBL_STATUS_UNKNOWN', 503);
  if (live.provider_status === 'BLOCKED') {
    await transaction(async (client) => {
      const locked = (await client.query('SELECT status FROM spfbl_operations WHERE record_id = $1 FOR UPDATE', [row.id])).rows[0];
      // An ambiguous write stays locked: a read cannot prove an in-flight write has finished.
      if (!locked || locked.status !== 'done') return;
      await client.query("UPDATE spfbl_operations SET status = 'blocked', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE record_id = $1", [row.id]);
      const unlocked = (await client.query("SELECT * FROM spfbl_requests WHERE record_id = $1 AND status = 'unlocked' FOR UPDATE", [row.id])).rows;
      for (const request of unlocked) {
        await event(client, actor.user.id, request, 'reopened');
        await client.query("UPDATE spfbl_requests SET status = 'reopened', revision = revision + 1, result_info = 'BLOCKED confirmado em consulta atual; disponível para nova solicitação' WHERE id = $1", [request.id]);
      }
    });
  }
  return { provider_status: live.provider_status, changed_reason: live.result !== row.result };
};

// ---- admin: block again after an unlock or a kept decision -------------------------------------------------------------
const blockAgain = async (actor, id, { revision, proof }, credentials, matrix = matrixClient) => {
  assertAdmin(actor);
  await reconcileStale();
  const request = await getRequest(id);
  checkRevision(request, revision);
  if (!['unlocked', 'kept'].includes(request.status)) throw new ReleaseError('Esta decisão não está disponível para bloquear novamente.', 'SPFBL_REQUEST_NOT_OPEN', 409);
  assertIntegration(request, credentials);
  const row = await withContext(rowOfRequest(request));
  checkConfirmation(actor.user.id, row, proof);
  const op = await readOperation(row.id);
  if (['processing', 'uncertain'].includes(op.status)) throw new ReleaseError('Existe uma tentativa sem resultado confirmado. Confira no fornecedor.', 'SPFBL_OPERATION_UNCERTAIN', 409);
  const live = normalizeLive(await matrix.registry(credentials, row.provider_key), row.provider_key, integrationHash(credentials.user));
  if (!live || live.id !== row.id || live.recipient !== row.recipient || live.sender !== row.sender) throw new ReleaseError('O SPFBL retornou um registro diferente. Nenhuma alteração foi enviada.', 'SPFBL_RECORD_MISMATCH', 409);
  if (live.provider_status === 'UNKNOWN') throw new ReleaseError('Situação atual não informada pelo SPFBL. Nenhum bloqueio enviado.', 'SPFBL_STATUS_UNKNOWN', 503);
  if (live.provider_status === 'BLOCKED') throw new ReleaseError('O SPFBL já informa BLOCKED. Use Consultar status atual para sincronizar a situação.', 'SPFBL_ALREADY_BLOCKED', 409);
  await transaction(async (client) => {
    await client.query("INSERT INTO spfbl_operations (record_id, status, actor_id) VALUES ($1, 'done', $2) ON CONFLICT (record_id) DO NOTHING", [row.id, actor.user.id]);
    const locked = (await client.query('SELECT status, revision FROM spfbl_operations WHERE record_id = $1 FOR UPDATE', [row.id])).rows[0];
    if (['processing', 'uncertain'].includes(locked.status) || Number(locked.revision) !== row.operation_revision) throw new ReleaseError('A situação mudou. Reabra o registro.', 'SPFBL_OPERATION_CHANGED', 409);
    await client.query("UPDATE spfbl_operations SET status = 'processing', actor_id = $2, updated_at = CURRENT_TIMESTAMP WHERE record_id = $1", [row.id, actor.user.id]);
    await client.query("UPDATE spfbl_requests SET status = 'processing', revision = revision + 1, result_info = 'Bloqueio enviado; aguardando confirmação' WHERE id = $1", [id]);
  });
  try { await matrix.block(credentials, row.provider_key); } catch (error) {
    await transaction(async (client) => {
      await client.query("UPDATE spfbl_operations SET status = 'uncertain', updated_at = CURRENT_TIMESTAMP WHERE record_id = $1", [row.id]);
      await client.query("UPDATE spfbl_requests SET status = 'uncertain', revision = revision + 1, result_info = 'Bloqueio sem confirmação; conferir no fornecedor' WHERE id = $1", [id]);
    });
    throw new ReleaseError('Bloqueio sem confirmação. A tentativa não será repetida automaticamente. Confira no SPFBL.', 'SPFBL_UNCERTAIN', 503, { diagnostic: error.diagnostic });
  }
  return transaction(async (client) => {
    const current = (await client.query('SELECT * FROM spfbl_requests WHERE id = $1', [id])).rows[0];
    await event(client, actor.user.id, current, 'reblocked');
    await client.query("UPDATE spfbl_operations SET status = 'blocked', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE record_id = $1", [row.id]);
    await client.query(`UPDATE spfbl_requests SET status = 'reblocked', revision = revision + 1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, result_info = 'DONE: sender blocked'
      WHERE record_id = $1 AND status <> 'uncertain'`, [row.id, actor.user.id]);
    return (await client.query('SELECT * FROM spfbl_requests WHERE id = $1', [id])).rows[0];
  });
};

// ---- reads ---------------------------------------------------------------------------------------------------------------
const STATUS_FILTER = new Set(['pending', 'processing', 'unlocked', 'kept', 'failed', 'uncertain', 'reopened', 'reblocked']);
const listRequests = async (actor, { status } = {}) => {
  await reconcileStale();
  const params = []; const where = [];
  if (status) {
    if (!STATUS_FILTER.has(status)) throw new ReleaseError('Filtro inválido.', 'SPFBL_FILTER_INVALID', 422);
    params.push(status); where.push(`r.status = $${params.length}`);
  }
  if (!actor.isSuperAdmin) {
    params.push(actor.user.id); where.push(`r.actor_id = $${params.length}`);
    params.push(actor.scope); where.push(`r.domain = ANY($${params.length}::text[])`);
  }
  const result = await db.query(`SELECT r.*, u.name AS actor_name, v.name AS reviewer_name FROM spfbl_requests r
    LEFT JOIN users u ON u.id = r.actor_id LEFT JOIN users v ON v.id = r.reviewed_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.requested_at DESC, r.id LIMIT 200`, params);
  return result.rows.map((r) => publicRequest(r, { admin: actor.isSuperAdmin }));
};

// Admin detail: the stored snapshot, its events and the confirmation proof needed to release or block again.
const requestDetail = async (actor, id) => {
  assertAdmin(actor);
  await reconcileStale();
  const request = await getRequest(id);
  const row = await withContext(rowOfRequest(request));
  const events = (await db.query(`SELECT e.action, e.created_at, u.name AS actor_name FROM spfbl_release_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.request_id = $1 ORDER BY e.id DESC LIMIT 50`, [id])).rows;
  return { request: publicRequest(request, { admin: true }), confirmation: confirmation(actor.user.id, row), events };
};

// State of one record for the detail page of whoever opened it.
const recordState = async (actor, row) => {
  await reconcileStale();
  const context = await withContext(row);
  const op = await readOperation(row.id);
  const own = (await db.query('SELECT id, status, revision FROM spfbl_requests WHERE record_id = $1 AND actor_id = $2', [row.id, actor.user.id])).rows[0] || null;
  const blocked = classify(row.result).status === 'Bloqueados';
  const open = blocked && !['done', 'processing', 'uncertain'].includes(op.status);
  return {
    operation: { status: op.status, uncertain: ['processing', 'uncertain'].includes(op.status), done: op.status === 'done' },
    request: own ? { id: own.id, status: own.status, status_label: label(own.status) } : null,
    can_request: open && !actor.isSuperAdmin && actor.unlockMode === 'review' && (!own || ['reopened', 'reblocked'].includes(own.status)),
    can_unlock: open && (actor.isSuperAdmin || actor.unlockMode === 'direct') && (!own || ['pending', 'failed', 'reopened', 'reblocked'].includes(own.status)),
    confirmation: confirmation(actor.user.id, context)
  };
};

// Last unlocks inside the caller's domains, for the dashboard.
const latestUnlocks = async (scope) => {
  if (!scope.length) return [];
  const result = await db.query(`SELECT created_at, domain, recipient, sender FROM spfbl_release_events WHERE action = 'unlocked' AND domain = ANY($1::text[])
    ORDER BY created_at DESC, id DESC LIMIT 10`, [scope]);
  return result.rows;
};

module.exports = { ReleaseError, STALE_MS, LABELS, label, confirmation, checkConfirmation, integrationHash, reconcileStale, requestReview, keep, execute, checkCurrent, blockAgain,
  listRequests, requestDetail, recordState, latestUnlocks, publicRequest, getRequest };
