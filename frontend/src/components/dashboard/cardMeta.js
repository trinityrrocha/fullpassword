import { Bug, CalendarClock, Database, Globe, KeyRound, LogIn, ShieldAlert, Unlock } from 'lucide-react';

export const CARD_ICONS = Object.freeze({ domains_health: Globe, domain_expirations: CalendarClock, security_alerts: ShieldAlert, unlock_requests: Unlock, spam_senders: Bug, login_activity: KeyRound, recent_logins: LogIn, last_backup: Database });
export const CARD_LINKS = Object.freeze({ domains_health: '/domains', domain_expirations: '/domains', security_alerts: '/settings?section=audit', unlock_requests: '/spfbl?tab=requests', spam_senders: '/spfbl', login_activity: '/settings?section=audit', recent_logins: '/settings?section=audit', last_backup: '/settings' });
const CARD_HINTS = Object.freeze({ spam_senders: 'Domínios de remetentes com mais mensagens bloqueadas pelo SPFBL nos últimos 30 dias, e há quanto tempo aparecem. O SPFBL não informa o país do remetente.' });
export const cardHint = (id) => CARD_HINTS[id] || '';
