// Presentation helpers of the "Enviados" tab: dates, result tones and the readable list of a log's fields.
const TIMEZONE = 'America/Sao_Paulo';
const DATE = new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: '2-digit' });
const TIME = new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

// "Data" and "Hora" are separate columns: dd/mm/aa and HH:mm:ss, in the Brasília time zone.
export const splitDateTime = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? { date: '—', time: '' } : { date: DATE.format(date), time: TIME.format(date) };
};

export const PERIOD_OPTIONS = Object.freeze([['24h', 'Últimas 24 horas', 1], ['3d', 'Últimos 3 dias', 3], ['7d', 'Últimos 7 dias', 7], ['30d', 'Últimos 30 dias', 30], ['60d', 'Últimos 60 dias', 60], ['90d', 'Últimos 90 dias', 90]]);
// Only the periods the stored history covers (the retention chosen in the settings), plus the one already selected.
export const periodOptions = (retentionDays, selected) => PERIOD_OPTIONS.filter(([value, , days]) => days <= (Number(retentionDays) || 30) || value === selected);
export const RESULT_OPTIONS = Object.freeze([['all', 'Todos'], ['sent', 'Enviados'], ['deferred', 'Adiados'], ['failed', 'Falhas'], ['progress', 'Em andamento']]);
export const SEARCH_BY_OPTIONS = Object.freeze([['any', 'Remetente ou destinatário'], ['sender', 'Remetente'], ['recipient', 'Destinatário']]);
export const DEFAULT_SENT_FILTERS = Object.freeze({ period: '24h', status: 'all', by: 'any', q: '' });

// (kept for any caller that still colors a badge)
export const RESULT_TONE_CLASSES = Object.freeze({
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200'
});

const TYPE_LABELS = Object.freeze({ success: 'Entregue', defer: 'Adiado (nova tentativa)', failure: 'Falha', inprogress: 'Em andamento' });
const formatSize = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return String(value);
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1).replace('.', ',')} KB` : `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
};
const unixToText = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? `${splitDateTime(new Date(n * 1000).toISOString()).date} ${splitDateTime(new Date(n * 1000).toISOString()).time}` : String(value); };

// Groups of fields for the details dialog, in reading order. Empty fields are left out.
const GROUPS = Object.freeze([
  ['Mensagem', [['msgid', 'Identificador'], ['type', 'Situação', (v) => TYPE_LABELS[v] || v], ['message', 'Resposta do servidor'], ['size', 'Tamanho', formatSize], ['spamscore', 'Nota de spam']]],
  ['Remetente', [['email', 'Endereço do remetente'], ['sender', 'Usuário remetente'], ['domain', 'Domínio'], ['user', 'Conta cPanel'], ['senderauth', 'Autenticação'], ['senderhost', 'Computador de origem'], ['senderip', 'IP de origem']]],
  ['Destinatário', [['recipient', 'Destinatário'], ['deliveredto', 'Entregue em'], ['deliverydomain', 'Domínio local do destino'], ['deliveryuser', 'Usuário local do destino'], ['host', 'Servidor que recebeu'], ['ip', 'IP do servidor que recebeu']]],
  ['Entrega', [['sendunixtime', 'Enviado em', unixToText], ['actionunixtime', 'Tentativa em', unixToText], ['router', 'Roteador'], ['transport', 'Transporte'], ['transport_is_remote', 'Entrega remota', (v) => (String(v) === '1' ? 'Sim' : 'Não')]]]
]);
// The event (delivery, postponed attempt, failure...) is the first line of the first group: the list no longer has a column for it.
export const detailGroups = (detail = {}, event = '') => GROUPS
  .map(([title, fields], index) => [title, [...(index === 0 && event ? [['Evento', event]] : []), ...fields.filter(([key]) => detail[key] !== undefined && detail[key] !== '').map(([key, label, format]) => [label, format ? format(detail[key]) : String(detail[key])])]])
  .filter(([, rows]) => rows.length > 0);
