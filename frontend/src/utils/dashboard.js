// Pure helpers of the dashboard page: the card catalogue, layout edits, and the short phrases the cards show.
export const CARD_IDS = Object.freeze(['domains_health', 'domain_expirations', 'security_alerts', 'unlock_requests', 'spam_senders', 'login_activity', 'recent_logins', 'last_backup']);
export const CARD_TITLES = Object.freeze({
  domains_health: 'Saúde dos domínios',
  domain_expirations: 'Próximos vencimentos',
  security_alerts: 'Alertas de segurança',
  unlock_requests: 'Desbloqueios pendentes',
  spam_senders: 'Remetentes mais bloqueados',
  login_activity: 'Logins e bloqueios',
  recent_logins: 'Últimos logins',
  last_backup: 'Último backup'
});
export const CARD_NEEDS = Object.freeze({ domains_health: 'Domain Manager', domain_expirations: 'Domain Manager', unlock_requests: 'SPFBL', spam_senders: 'SPFBL' });
export const DEFAULT_LAYOUT = Object.freeze({ order: CARD_IDS, hidden: [] });

// Same rule as the server: unknown ids are dropped, repeats count once, and a card the layout does not mention yet is appended.
export const normalizeLayout = (input) => {
  const order = [];
  for (const id of Array.isArray(input?.order) ? input.order : []) if (CARD_IDS.includes(id) && !order.includes(id)) order.push(id);
  for (const id of CARD_IDS) if (!order.includes(id)) order.push(id);
  return { order, hidden: [...new Set((Array.isArray(input?.hidden) ? input.hidden : []).filter((id) => CARD_IDS.includes(id)))] };
};
export const visibleOrder = (layout) => layout.order.filter((id) => !layout.hidden.includes(id));

// Puts `id` where `targetId` is (drag and drop). Moving a card onto itself, or an unknown card, changes nothing.
export const moveBefore = (order, id, targetId) => {
  if (id === targetId || !order.includes(id) || !order.includes(targetId)) return order;
  const rest = order.filter((item) => item !== id);
  rest.splice(rest.indexOf(targetId), 0, id);
  return rest;
};
// One step among the VISIBLE cards (keyboard), leaving hidden cards where they are.
export const moveStep = (layout, id, delta) => {
  const shown = visibleOrder(layout);
  const from = shown.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= shown.length) return layout;
  const rest = layout.order.filter((item) => item !== id);
  const at = rest.indexOf(shown[to]);
  rest.splice(delta < 0 ? at : at + 1, 0, id);
  return { ...layout, order: rest };
};
export const sameLayout = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// "há 5 min", "há 3 h", "há 2 dias": the card shows how long ago, the title attribute keeps the exact date.
export const ago = (value, now = Date.now()) => {
  const time = new Date(value).getTime();
  if (!value || Number.isNaN(time)) return '';
  const diff = Math.max(0, now - time);
  if (diff < MINUTE) return 'agora há pouco';
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
};
// For how long a sender has been seen: first to last arrival, in whole days (at least 1).
export const seenFor = (first, last) => {
  const span = new Date(last).getTime() - new Date(first).getTime();
  if (Number.isNaN(span)) return '';
  const days = Math.max(1, Math.round(span / DAY));
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
};
export const formatBytes = (bytes) => {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return '';
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1).replace('.', ',')} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(value / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
};
export const BACKUP_PROVIDERS = Object.freeze({ google_drive: 'Google Drive', backblaze_b2: 'Backblaze B2', mega_s3: 'MEGA S3', ftp: 'FTP' });
export const providerLabel = (provider) => BACKUP_PROVIDERS[provider] || 'Backup';
// A backup older than two days is flagged: the default schedules are daily.
export const backupTone = (backup, now = Date.now()) => {
  if (!backup?.last_success) return 'danger';
  const age = now - new Date(backup.last_success.at).getTime();
  if (backup.last_run?.status === 'failed' && new Date(backup.last_run.at) > new Date(backup.last_success.at)) return 'warning';
  return age > 2 * DAY ? 'warning' : 'ok';
};
export const healthPercent = (health) => (health?.total > 0 ? Math.round((health.healthy / health.total) * 100) : 0);
// How many domains are fine / need attention / are bad / are unknown, for one mail check, as segments of a bar.
export const mailSegments = (counts = {}, total = 0) => {
  const get = (...keys) => keys.reduce((sum, key) => sum + (counts[key] || 0), 0);
  const ok = get('ok');
  const warning = get('warning', 'not_found');
  const bad = get('fail', 'absent');
  const unknown = Math.max(0, total - ok - warning - bad);
  return { ok, warning, bad, unknown };
};

// Colour of the days left to an expiry: red below 15 days (expired included), orange up to 30, green beyond.
export const expiryTone = (days) => (days < 15 ? 'danger' : days <= 30 ? 'warning' : 'ok');
