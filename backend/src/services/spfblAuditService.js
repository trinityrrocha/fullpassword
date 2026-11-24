const db = require('../config/database');

// Read-only view of the SPFBL entries of the system audit trail (Super Admin only). Metadata is passed through an allow-list:
// only what the screen needs, never anything that could carry a secret, a provider key or free text from the provider.
const ACTION_LABELS = {
  spfbl_settings_updated: 'Configuração alterada',
  spfbl_matrix_test: 'Teste da conexão Matrix',
  spfbl_whm_test: 'Teste da conexão WHM',
  spfbl_domains_synced: 'Domínios sincronizados',
  spfbl_domain_added: 'Domínio cadastrado',
  spfbl_domain_removed: 'Domínio excluído',
  spfbl_access_saved: 'Acesso salvo',
  spfbl_access_revoked: 'Acesso revogado',
  spfbl_status_checked: 'Status atual consultado',
  spfbl_review_requested: 'Revisão solicitada',
  spfbl_unlock_done: 'Desbloqueio',
  spfbl_block_done: 'Bloqueio de remetente',
  spfbl_request_keep: 'Bloqueio mantido (revisão)',
  spfbl_request_release: 'Liberação (revisão)',
  spfbl_request_block: 'Novo bloqueio (revisão)'
};
const STATUS_LABELS = { success: 'Sucesso', failed: 'Falha', denied: 'Negado', blocked: 'Bloqueado' };
const PAGE_SIZE = 25;
const DOMAIN_RE = /^[a-z0-9.-]{1,253}$/;
const UUID_RE = /^[0-9a-f-]{36}$/;
const REASON_RE = /^[A-Za-z0-9_:. -]{1,80}$/;

class AuditError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'AuditError'; this.code = code; this.statusCode = statusCode; }
}

const safeMetadata = (metadata) => {
  const m = metadata && typeof metadata === 'object' ? metadata : {};
  const out = {};
  if (typeof m.domain === 'string' && DOMAIN_RE.test(m.domain)) out.domain = m.domain;
  if (typeof m.request_id === 'string' && UUID_RE.test(m.request_id)) out.request_id = m.request_id;
  if (typeof m.reason === 'string' && REASON_RE.test(m.reason)) out.reason = m.reason;
  if (['direct', 'review'].includes(m.mode)) out.mode = m.mode;
  if (['WHITELISTED', 'BLOCKED', 'NONE', 'UNKNOWN'].includes(m.provider_status)) out.provider_status = m.provider_status;
  if (['sent', 'smtp_skipped', 'none'].includes(m.notification)) out.notification = m.notification;
  if (typeof m.diagnostic === 'string' && /^[A-Za-z0-9_= .]{1,120}$/.test(m.diagnostic)) out.diagnostic = m.diagnostic;
  return out;
};

const list = async ({ action, status, domain, start, end, page } = {}) => {
  const where = ["action LIKE 'spfbl\\_%' ESCAPE '\\'"];
  const params = [];
  if (action) {
    if (!ACTION_LABELS[action]) throw new AuditError('Filtro de evento inválido.', 'SPFBL_AUDIT_FILTER');
    params.push(action); where.push(`action = $${params.length}`);
  }
  if (status) {
    if (!STATUS_LABELS[status]) throw new AuditError('Filtro de situação inválido.', 'SPFBL_AUDIT_FILTER');
    params.push(status); where.push(`status = $${params.length}`);
  }
  if (domain) {
    const name = String(domain).toLowerCase();
    if (!DOMAIN_RE.test(name)) throw new AuditError('Informe um domínio válido.', 'SPFBL_AUDIT_FILTER');
    params.push(name); where.push(`metadata->>'domain' = $${params.length}`);
  }
  // Day boundaries in America/Sao_Paulo; the end day is inclusive.
  for (const [value, bound] of [[start, `>= ($N::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`], [end, `< ($N::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo'`]]) {
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new AuditError('Informe uma data válida.', 'SPFBL_AUDIT_FILTER');
    params.push(value); where.push(`created_at ${bound.replace('$N', `$${params.length}`)}`);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = Number((await db.query(`SELECT COUNT(*)::integer AS n FROM system_audit_events ${clause}`, params)).rows[0].n);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const rows = (await db.query(`SELECT id, created_at, action, status, user_email, metadata FROM system_audit_events ${clause}
    ORDER BY created_at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET ${(current - 1) * PAGE_SIZE}`, params)).rows;
  return {
    events: rows.map((r) => ({ id: r.id, at: r.created_at, action: r.action, label: ACTION_LABELS[r.action] || 'Evento do SPFBL', status: r.status,
      status_label: STATUS_LABELS[r.status] || r.status, user: r.user_email || null, details: safeMetadata(r.metadata) })),
    total, page: current, pages,
    actions: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))
  };
};

module.exports = { AuditError, ACTION_LABELS, list, safeMetadata };
