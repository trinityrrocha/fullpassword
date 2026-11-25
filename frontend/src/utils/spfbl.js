// Pure helpers of the SPFBL module UI: no React, no network, testable in Node.
export const PAGE_SIZE = 20;
export const MAX_DOMAINS_PER_USER = 100;
// Draft of one account's SPFBL access while the user dialog (Gestão de Equipe) is open.
export const EMPTY_SPFBL_ACCESS = Object.freeze({ loaded: false, had: false, enabled: false, mode: 'review', domainIds: [], domains: [], dirty: false, error: '' });
export const MODULES_CHANGED_EVENT = 'fullpassword:modules-changed';

export const MODE_LABELS = Object.freeze({
  review: 'Solicitar revisão ao administrador',
  direct: 'Desbloqueio direto'
});

const normalize = (value) => String(value ?? '').trim().toLowerCase();

// The catalogue can hold thousands of domains: always filter and paginate, never render them all.
export const filterDomains = (domains, { query = '', status = 'all' } = {}) => {
  const needle = normalize(query);
  return (Array.isArray(domains) ? domains : []).filter((domain) => {
    if (needle && !normalize(domain.name).includes(needle) && !normalize(domain.cpanel_user).includes(needle)) return false;
    if (status === 'active') return domain.active === true;
    if (status === 'inactive') return domain.active !== true;
    if (status === 'manual' || status === 'whm') return domain.source === status;
    if (status === 'no_server') return Boolean(domain.no_server);
    return true;
  });
};

export const paginate = (items, page, size = PAGE_SIZE) => {
  const list = Array.isArray(items) ? items : [];
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  return { items: list.slice((current - 1) * size, current * size), page: current, pages, total: list.length };
};

export const domainState = (domain) => {
  if (domain.active) return { label: 'Ativo', tone: 'green' };
  if (domain.source === 'whm' && domain.suspended) return { label: 'Conta suspensa', tone: 'amber' };
  if (domain.no_server) return { label: NO_SERVER_LABEL, tone: 'slate' };
  if (domain.source === 'whm') return { label: 'Fora do servidor', tone: 'slate' };
  return { label: 'Inativo', tone: 'slate' };
};

export const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date).replace(',', '');
};

export const describeSync = (at, status) => {
  if (!at && !status) return 'Nunca sincronizado.';
  const when = formatDateTime(at);
  if (status === 'ok') return when ? `Última sincronização bem-sucedida em ${when}.` : 'Última sincronização bem-sucedida.';
  return when ? `Última tentativa em ${when} falhou (${String(status || 'erro').replace(/^failed:/, '')}).` : 'A última tentativa de sincronização falhou.';
};

const SPECIFIC_MESSAGES = Object.freeze({
  SPFBL_SECRET_REENTRY_REQUIRED: 'Você alterou o usuário ou o servidor. Por segurança, digite novamente a senha ou o token correspondente.',
  SPFBL_REMOVE_CHOICE_REQUIRED: 'Escolha o que fazer com os domínios vinculados antes de remover o servidor.',
  SPFBL_SYNC_EMPTY: 'O WHM não retornou nenhum domínio, então nada foi alterado. Confira as permissões do token.',
  MODULE_DISABLED: 'O módulo SPFBL está desativado. Ative-o em Configurações → Módulos.',
  CONFIG_ENCRYPTION_KEY_MISSING: 'A chave de criptografia das configurações não está configurada no servidor (CONFIG_ENCRYPTION_KEY).',
  CONFIG_ENCRYPTION_KEY_INVALID: 'A chave de criptografia das configurações é inválida no servidor (CONFIG_ENCRYPTION_KEY).',
  CONFIG_ENCRYPTION_KEY_PLACEHOLDER: 'A chave de criptografia das configurações ainda é um placeholder no servidor (CONFIG_ENCRYPTION_KEY).'
});

// Server messages are already user-facing pt-BR; codes only add guidance. Cool-downs show the wait.
export const describeError = (error, fallback) => {
  const data = error?.response?.data || {};
  if (error?.response?.status === 429) {
    const seconds = Number.parseInt(data.retry_after_seconds, 10);
    if (data.code === 'SPFBL_TEST_COOLDOWN' || data.code === 'SPFBL_WHM_COOLDOWN') {
      return Number.isFinite(seconds) && seconds > 0 ? `Aguarde ${seconds} segundos antes de tentar de novo.` : 'Aguarde alguns segundos antes de tentar de novo.';
    }
    return data.error || data.message || 'Muitas tentativas. Aguarde um pouco e tente novamente.';
  }
  return SPECIFIC_MESSAGES[data.code] || data.error || fallback;
};

export const SERVER_KINDS = Object.freeze([{ value: 'cpanel', label: 'cPanel (WHM)' }]);
export const kindLabel = (kind) => SERVER_KINDS.find((item) => item.value === kind)?.label || 'cPanel (WHM)';

// A server form sends only what the person typed: an empty secret means "keep the saved one" and is simply not sent.
export const buildServerPayload = ({ name, kind, host, user, token, matrixUser, matrixPassword }) => {
  const payload = { name: String(name ?? '').trim(), kind: kind || 'cpanel', host: String(host ?? '').trim(), whm_user: String(user ?? '').trim(), matrix_user: String(matrixUser ?? '').trim() };
  if (token) payload.token = String(token).trim();
  if (matrixPassword) payload.matrix_password = matrixPassword;
  return payload;
};
// What the validation buttons send (the same fields, only the ones that credential needs; the id lets a blank secret mean "the saved one").
export const buildWhmValidation = ({ id, host, user, token }) => ({ ...(id ? { id } : {}), host: String(host ?? '').trim(), whm_user: String(user ?? '').trim(), ...(token ? { token: String(token).trim() } : {}) });
export const buildMatrixValidation = ({ id, matrixUser, matrixPassword }) => ({ ...(id ? { id } : {}), matrix_user: String(matrixUser ?? '').trim(), ...(matrixPassword ? { matrix_password: matrixPassword } : {}) });

// The wording of the "remove server" choice, from the counts the list already has.
export const removalSummary = (server) => {
  const n = Number(server?.domains_total || 0);
  return n === 0 ? 'Este servidor não tem domínios vinculados.' : n === 1 ? 'Este servidor tem 1 domínio vinculado.' : `Este servidor tem ${n} domínios vinculados.`;
};
export const serverSummary = (servers) => {
  const list = Array.isArray(servers) ? servers : [];
  return { total: list.length, withMatrix: list.filter((server) => server.matrix_configured).length };
};
export const NO_SERVER_LABEL = 'Sem servidor de consulta';

export const syncSummary = (result) => {
  const parts = [`${result.domains} domínios (${result.active} ativos, ${result.suspended} de contas suspensas)`];
  if (result.added !== undefined) parts.push(`${result.added} novos, ${result.updated} atualizados, ${result.deactivated} desativados`);
  if (result.skipped) parts.push(`${result.skipped} registros ignorados por formato inválido`);
  return `${parts.join('; ')}.`;
};

export const toggleId = (ids, id) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

export const selectionSummary = (count) => (count === 1 ? '1 domínio selecionado' : `${count} domínios selecionados`);

export const canSaveAccess = (userId, mode, domainIds) => Boolean(userId) && (mode === 'review' || mode === 'direct')
  && domainIds.length >= 1 && domainIds.length <= MAX_DOMAINS_PER_USER;

// Active, non-Super-Admin accounts that do not hold a grant yet, plus the account being edited.
export const grantableUsers = (users, grants, editingId = null) => {
  const granted = new Set((grants || []).map((grant) => grant.user_id));
  return (Array.isArray(users) ? users : [])
    .filter((user) => user.is_active === true && user.is_super_admin !== true && (!granted.has(user.id) || user.id === editingId))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
};

// ---- history presentation (Phase 2) ----
const TIMEZONE = 'America/Sao_Paulo';
export const formatEpoch = (seconds) => new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  .format(new Date(seconds * 1000)).replace(',', '');
export const formatIsoDateTime = (iso) => (iso ? formatEpoch(Math.floor(Date.parse(iso) / 1000)) : '');
export const formatDay = (value) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || ''); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''; };
export const formatNumber = (value) => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
export const REASON_ICONS = { banned: '🚫', security: '💀', inexistent: '⚠️', '': '' };
export const STATE_LABELS = (state) => (state?.loading ? 'Coletando histórico do Matrix' : state?.partial ? 'Cobertura parcial' : 'Histórico carregado');
export const COVERAGE_NOTE = 'Contagens parciais; a cobertura dos sete dias não está garantida.';
export const DEFAULT_FILTERS = { status: 'Bloqueados', by: 'sender', email: '' };

export const REQUEST_STATUS_TONE = { pending: 'text-amber-800 border-amber-700', processing: 'text-blue-800 border-blue-700', unlocked: 'text-emerald-800 border-emerald-700', kept: 'text-slate-800 border-slate-500',
  failed: 'text-red-800 border-red-700', uncertain: 'text-red-800 border-red-700', reopened: 'text-amber-800 border-amber-700', reblocked: 'text-slate-800 border-slate-500' };
export const REQUEST_FILTERS = [['', 'Todas'], ['pending', 'Aguardando revisão'], ['unlocked', 'Desbloqueadas'], ['kept', 'Mantidas'], ['failed', 'Falha antes do envio'], ['uncertain', 'Resultado não confirmado'], ['reopened', 'Bloqueadas novamente']];

export const EVENT_LABELS = { unlocked: 'Desbloqueado', reblocked: 'Bloqueado', reopened: 'Voltou a bloquear (confirmado no SPFBL)', kept: 'Bloqueio mantido' };
// "Estava bloqueado e agora está desbloqueado": the portal's own record of what was done, or the provider's WHITELISTED status.
export const describeRelease = (release) => {
  if (!release) return null;
  const when = release.at ? ` em ${formatIsoDateTime(release.at)}` : '';
  const who = release.by ? ` por ${release.by}` : '';
  if (release.state === 'unlocked') return { tone: 'text-emerald-800 border-emerald-700', badge: 'Desbloqueado', line: release.at ? `Desbloqueado${when}${who}` : 'Liberado no SPFBL (fora do portal)' };
  return { tone: 'text-slate-800 border-slate-500', badge: 'Bloqueado novamente', line: `Bloqueado novamente${when}${who}` };
};

// Short time of day (no seconds) for dense tables: dd/mm/aa HH:mm.
export const formatEpochShort = (seconds) => formatEpoch(seconds).replace(/:\d{2}$/, '');
export const formatIsoShort = (iso) => (iso ? formatEpochShort(Math.floor(Date.parse(iso) / 1000)) : '');

export const REASON_SHORT = { banned: 'Banimento', security: 'Segurança', inexistent: 'Inexistência', '': 'Aceita' };

// The recipient's domain is already the selected domain: show "local@…" (full address in the tooltip) so rows never need a scrollbar.
export const shortAddress = (email) => { const at = String(email || '').indexOf('@'); return at > 0 ? `${email.slice(0, at + 1)}…` : email || '—'; };
