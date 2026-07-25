import { useEffect, useRef } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Info, ShieldAlert } from 'lucide-react';

const MAX_NOTIFICATIONS = 10;

const severityStyles = {
  error: {
    icon: AlertTriangle,
    iconClass: 'text-red-600',
    badgeClass: 'bg-red-50 text-red-700'
  },
  warning: {
    icon: ShieldAlert,
    iconClass: 'text-amber-600',
    badgeClass: 'bg-amber-50 text-amber-700'
  },
  success: {
    icon: CheckCircle2,
    iconClass: 'text-emerald-600',
    badgeClass: 'bg-emerald-50 text-emerald-700'
  },
  info: {
    icon: Info,
    iconClass: 'text-indigo-600',
    badgeClass: 'bg-indigo-50 text-indigo-700'
  }
};

const formatNotificationDate = (value) => {
  if (!value) return 'Data não informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

export default function SecurityNotificationsMenu({
  notifications,
  isOpen,
  onToggle,
  onClose,
  onNavigate
}) {
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const items = Array.isArray(notifications?.items)
    ? notifications.items.slice(0, MAX_NOTIFICATIONS)
    : [];

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      onClose();
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        aria-label="Notificações de segurança"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="security-notifications-popover"
      >
        <Bell className="h-5 w-5" />
        {notifications?.unread_count > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs text-white">
            {Math.min(99, notifications.unread_count)}
            {notifications.unread_count > 99 ? '+' : ''}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="security-notifications-popover"
          role="dialog"
          aria-label="Notificações recentes"
          className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-200 px-4 py-3 font-medium text-slate-900">
            Notificações recentes
          </div>

          <div className="max-h-96 overflow-y-auto" aria-live="polite">
            {items.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {items.map((item, index) => {
                  const severity = severityStyles[item.severity] || severityStyles.info;
                  const SeverityIcon = severity.icon;
                  return (
                    <li key={item.id || `${item.created_at || 'notification'}-${index}`}>
                      <button
                        type="button"
                        onClick={() => onNavigate(item.target_url || '/settings?section=audit')}
                        className="flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                      >
                        <SeverityIcon className={`mt-0.5 h-4 w-4 shrink-0 ${severity.iconClass}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {item.title || 'Evento registrado'}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                            {item.summary || 'Evento registrado no sistema.'}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <time dateTime={item.created_at || undefined}>{formatNotificationDate(item.created_at)}</time>
                            {item.status_label && (
                              <span className={`rounded-full px-2 py-0.5 font-medium ${severity.badgeClass}`}>
                                {item.status_label}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                Nenhuma notificação recente.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate('/settings?section=audit')}
            className="block w-full border-t border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm font-medium text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
          >
            Auditoria do sistema para mais informações
          </button>
        </div>
      )}
    </div>
  );
}
