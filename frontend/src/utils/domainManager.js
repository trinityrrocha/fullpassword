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
const FIELD_LABELS = Object.freeze({ expires_on: 'Vencimento', nameservers: 'Servidores DNS', dnssec: 'DNSSEC', rdap_statuses: 'Status do registro', ssl_state: 'Certificado SSL', registrar: 'Registrador' });
const VALUE_LABELS = Object.freeze({ true: 'ativo', false: 'desativado', ...SSL_LABELS });

export const lookupLabel = (snapshot) => (snapshot ? LOOKUP_LABELS[snapshot.lookup_status] || 'Consultado' : 'Aguardando consulta');
export const errorLabel = (code) => ERROR_LABELS[code] || (code ? 'Falha na consulta.' : '');
export const sslLabel = (state) => SSL_LABELS[state] || '—';
export const fieldLabel = (field) => FIELD_LABELS[field] || field;
export const changeValue = (field, value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'expires_on') return formatDay(value) || value;
  return field === 'dnssec' || field === 'ssl_state' ? VALUE_LABELS[value] || value : value;
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
