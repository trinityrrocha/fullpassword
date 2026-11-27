import { formatDay } from './spfbl.js';

export const SOURCE_LABELS = Object.freeze({ manual: 'Manual', spfbl: 'SPFBL' });
export const MAX_IMPORT = 200;

const LOOKUP_LABELS = Object.freeze({
  ok: 'Consultado',
  no_expiry: 'Sem data de vencimento publicada',
  not_found: 'Não registrado',
  unsupported: 'Extensão sem consulta RDAP',
  error: 'Falha na consulta'
});
const ERROR_LABELS = Object.freeze({
  RATE_LIMITED: 'Registro limitou as consultas; nova tentativa em breve.',
  TIMEOUT: 'Tempo esgotado.',
  UPSTREAM_ERROR: 'Registro indisponível.',
  CONNECT_FAILED: 'Falha de conexão.',
  RDAP_INVALID: 'Resposta inválida do registro.',
  ADDRESS_FORBIDDEN: 'O servidor do registro resolve para endereço não público.',
  DNS_NO_ADDRESS: 'Servidor do registro sem endereço.'
});
const SSL_LABELS = Object.freeze({ valid: 'Válido', expired: 'Vencido', invalid: 'Inválido', none: 'Sem HTTPS', error: 'Não verificado' });
const FIELD_LABELS = Object.freeze({ expires_on: 'Vencimento', nameservers: 'Servidores DNS', dnssec: 'DNSSEC', rdap_statuses: 'Status do registro', ssl_state: 'Certificado SSL', registrar: 'Registrador', spf_status: 'SPF', spf_record: 'Registro SPF', dmarc_status: 'DMARC', dmarc_policy: 'Política DMARC', dkim_status: 'DKIM' });
const MAIL_STATUS_LABELS = Object.freeze({ ok: 'Válido', warning: 'Aviso', fail: 'Falha', absent: 'Ausente', not_found: 'Não encontrado', inconclusive: 'Inconclusivo' });
const VALUE_LABELS = Object.freeze({ true: 'ativo', false: 'desativado', ...SSL_LABELS, ...MAIL_STATUS_LABELS });

export const lookupLabel = (snapshot) => (snapshot ? LOOKUP_LABELS[snapshot.lookup_status] || 'Consultado' : 'Aguardando consulta');
export const errorLabel = (code) => ERROR_LABELS[code] || (code ? 'Falha na consulta.' : '');
export const sslLabel = (state) => SSL_LABELS[state] || '—';
export const fieldLabel = (field) => FIELD_LABELS[field] || field;
export const changeValue = (field, value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'expires_on') return formatDay(value) || value;
  return ['dnssec', 'ssl_state', 'spf_status', 'dmarc_status', 'dkim_status'].includes(field) ? VALUE_LABELS[value] || value : value;
};
export const dnssecLabel = (value) => (value === true ? 'Ativo' : value === false ? 'Desativado' : '—');

// "Vence em 12 dias" / "Venceu há 3 dias"; the colour never carries the meaning alone.
export const expiryInfo = (snapshot) => {
  if (!snapshot?.expires_on) return { text: '—', note: snapshot ? 'sem data' : '', tone: 'muted' };
  const days = snapshot.days_left;
  const date = formatDay(snapshot.expires_on);
  if (days < 0) return { text: date, note: `venceu há ${-days} ${-days === 1 ? 'dia' : 'dias'}`, tone: 'danger' };
  if (days === 0) return { text: date, note: 'vence hoje', tone: 'danger' };
  return { text: date, note: `em ${days} ${days === 1 ? 'dia' : 'dias'}`, tone: days <= 30 ? 'warning' : 'ok' };
};
export const TONE_CLASSES = Object.freeze({
  danger: 'text-red-800', warning: 'text-amber-800', ok: 'text-slate-900', muted: 'text-slate-500'
});

// A pasted list: one domain per line, comma, semicolon or space; duplicates and blanks dropped, case folded.
export const parseDomainList = (text) => [...new Set(String(text || '').split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];

export const MAX_ALERT_EMAILS = 20;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (value) => typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
// What the list shows next to a domain: nothing when the alerts are off.
export const alertsLabel = (alerts) => {
  if (!alerts?.enabled) return '';
  const parts = [];
  if (alerts.emails > 0) parts.push(`${alerts.emails} ${alerts.emails === 1 ? 'e-mail' : 'e-mails'}`);
  if (alerts.notify_admins) parts.push('administradores');
  return `Alertas ativos${parts.length ? ` (${parts.join(' + ')})` : ''}`;
};
// The form is valid when the alerts are off, or when someone will receive them.
export const canSaveAlerts = ({ enabled, notify_admins: notifyAdmins, emails }) => !enabled || notifyAdmins || emails.length > 0;

export const MAX_DOMAINS_PER_USER = 100;
export const EMPTY_DM_ACCESS = Object.freeze({ loaded: false, had: false, enabled: false, domainIds: [], domains: [], dirty: false, error: '' });
// A grant needs 1 to 100 domains; with the access off there is nothing to validate.
export const canSaveDmAccess = (value) => !value.enabled || (value.domainIds.length >= 1 && value.domainIds.length <= MAX_DOMAINS_PER_USER);

// ---------- SPF, DKIM and DMARC ----------
export const mailStatusLabel = (status) => MAIL_STATUS_LABELS[status] || '—';
const MARKS = Object.freeze({ ok: '✓', warning: '⚠', fail: '✗', absent: '—', not_found: '?', inconclusive: '…' });
const MARK_TONES = Object.freeze({ ok: 'ok', warning: 'warning', fail: 'danger', absent: 'danger', not_found: 'muted', inconclusive: 'muted' });

// A verdict stored before "~all" became a warning still says "valid": show what the rule says now, without waiting for the next check.
export const mailSectionStatus = (kind, section) => (kind === 'spf' && section?.status === 'ok' && section?.all === '~all' ? 'warning' : section?.status);
// The compact marker of one check in the list: a glyph AND words, never only a colour.
export const mailMarker = (kind, mail) => {
  const section = mail?.[kind];
  const label = { spf: 'SPF', dkim: 'DKIM', dmarc: 'DMARC' }[kind];
  if (!mail || !section) return { label, mark: '·', status: 'Não verificado', text: 'não verificado', tone: 'muted', title: `${label}: ainda não verificado` };
  const status = mailSectionStatus(kind, section);
  let detail = '';
  if (kind === 'spf' && section.all) detail = section.all === '~all' ? '~all → -all' : section.all;
  if (kind === 'dmarc' && section.policy) detail = section.policy === 'none' ? 'p=none' : section.policy;
  if (kind === 'dkim' && status !== 'not_found') detail = section.found ? `${section.found} ${section.found === 1 ? 'seletor' : 'seletores'}` : '';
  const word = status === 'absent' ? 'ausente' : status === 'not_found' ? 'não encontrado' : status === 'inconclusive' ? 'sem resposta' : status === 'fail' ? 'falha' : '';
  const text = detail || word || (status === 'ok' ? 'válido' : status === 'warning' ? 'aviso' : '');
  return { label, mark: MARKS[status] || '·', status: MAIL_STATUS_LABELS[status] || 'Não verificado', text, tone: MARK_TONES[status] || 'muted', title: `${label}: ${MAIL_STATUS_LABELS[status] || '—'}${detail ? ` (${detail})` : ''}${kind === 'spf' && section.all === '~all' ? '. Sugestão: use -all' : ''}` };
};

const MAIL_CODES = Object.freeze({
  SPF_MULTIPLE: 'Há mais de um registro SPF, o que é inválido.',
  SPF_SYNTAX: 'O registro SPF tem erro de sintaxe.',
  SPF_TOO_MANY_LOOKUPS: 'Passa do limite de 10 consultas DNS: o SPF pode falhar.',
  SPF_LOOP: 'Os includes do SPF formam um círculo.',
  SPF_TOO_DEEP: 'Includes do SPF aninhados demais.',
  SPF_INCLUDE_NO_RECORD: 'Um include (ou redirect) aponta para um nome sem registro SPF.',
  SPF_ALL_PLUS: '+all autoriza qualquer servidor a enviar e-mail pelo domínio.',
  SPF_NEUTRAL_ALL: '?all é neutro e não protege o domínio.',
  SPF_NO_ALL: 'O registro não termina com "all".',
  SPF_PTR: 'O mecanismo ptr é desencorajado.',
  SPF_TEXT_AFTER_ALL: 'Há termos depois do "all"; eles são ignorados.',
  SPF_VOID_LOOKUPS: 'Mais de 2 consultas do SPF não retornaram resposta.',
  SPF_SOFTFAIL: 'O registro termina em ~all (soft fail): e-mail falso ainda pode ser entregue. Recomendado trocar por -all, que rejeita.',
  DMARC_MULTIPLE: 'Há mais de um registro DMARC, o que é inválido.',
  DMARC_NO_POLICY: 'O registro DMARC não tem a política (p=).',
  DMARC_BAD_POLICY: 'A política DMARC não é none, quarantine nem reject.',
  DMARC_NO_POLICY_TAG: 'Sem a tag p=: vale none enquanto houver rua=.',
  DMARC_POLICY_NONE: 'p=none só monitora: não bloqueia e-mail falso.',
  DMARC_NO_RUA: 'Sem rua=: nenhum relatório agregado é recebido.',
  DMARC_PCT_PARTIAL: 'pct abaixo de 100: a política vale só para parte das mensagens.',
  DMARC_SP_NONE: 'sp=none deixa os subdomínios sem proteção.',
  DKIM_ALL_REVOKED: 'Todas as chaves encontradas estão revogadas (p= vazio).',
  DKIM_WEAK_KEY: 'Só há chaves de 1024 bits; o recomendado é 2048.',
  DKIM_KEY_UNREADABLE: 'Não foi possível ler o tamanho da chave.',
  DKIM_WEAK_KEY_SOME: 'Há também uma chave de 1024 bits, além da de 2048.',
  DKIM_TESTING: 'Uma chave está em modo de teste (t=y).',
  DKIM_WILDCARD: 'O domínio responde a qualquer seletor (curinga): não dá para descobrir os seletores.'
});
export const mailCodeLabel = (code) => MAIL_CODES[code] || code;
export const mailMessages = (section) => [...(section?.errors || []), ...(section?.warnings || []), ...(section?.notes || [])].map(mailCodeLabel);

export const DKIM_SELECTOR_LIMIT = 60;
export const DOMAIN_SELECTOR_LIMIT = 20;
export const DKIM_PROBE_LIMIT = DKIM_SELECTOR_LIMIT + DOMAIN_SELECTOR_LIMIT;
// Same rule as the server: dot-separated labels of up to 63 characters, no empty label, at most 100 characters in all.
const SELECTOR_LABEL = '[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?';
const SELECTOR_PATTERN = new RegExp(`^${SELECTOR_LABEL}(?:\\.${SELECTOR_LABEL})*$`, 'i');
export const isValidSelector = (value) => { const text = String(value || ''); return text.length <= 100 && SELECTOR_PATTERN.test(text); };
// A pasted list: one selector per line, comma or space; lower-cased, de-duplicated, blanks dropped.
export const parseSelectorList = (text) => [...new Set(String(text || '').split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
export const selectorProblems = (list, limit) => {
  if (list.length > limit) return `Use no máximo ${limit} seletores.`;
  const bad = list.find((item) => !isValidSelector(item));
  return bad ? `Seletor inválido: "${bad.slice(0, 40)}". Use letras, números, ponto, hífen e sublinhado.` : '';
};
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
export const parseServerList = (text) => [...new Set(String(text || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
export const serverProblems = (list) => {
  if (list.length > 4) return 'Use no máximo 4 servidores DNS.';
  const bad = list.find((item) => !(IPV4.test(item) && item.split('.').every((part) => Number(part) <= 255)) && !(item.includes(':') && IPV6.test(item)));
  return bad ? `Endereço IP inválido: "${bad.slice(0, 45)}".` : '';
};

// The sentence shown after "Sincronizar domínios": what was found, and which server failed.
export const syncSummary = (result) => {
  if (result?.skipped === 'spfbl_off') return { type: 'error', text: 'O módulo SPFBL está desativado. Ative-o e cadastre um servidor WHM para sincronizar os domínios.' };
  if (!result?.servers?.length) return { type: 'error', text: 'Nenhum servidor WHM cadastrado no SPFBL. Cadastre um servidor para sincronizar os domínios.' };
  const imported = Number(result.imported) || 0;
  const news = imported === 0 ? 'nenhum domínio novo' : `${imported} ${imported === 1 ? 'domínio novo' : 'domínios novos'}`;
  const failed = result.servers.filter((server) => !server.ok).map((server) => `${server.name} (${server.code || 'erro'})`);
  const head = `Sincronização concluída: ${result.servers.length} ${result.servers.length === 1 ? 'servidor consultado' : 'servidores consultados'}, ${news} na lista.`;
  if (failed.length === 0) return { type: 'success', text: head };
  return { type: result.ok > 0 ? 'success' : 'error', text: `${head} Falha em: ${failed.join(', ')}.` };
};
