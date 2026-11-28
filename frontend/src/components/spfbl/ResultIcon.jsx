import { Bug, CheckCheck, Clock, MailQuestionMark, ServerOff, UserRoundPen } from 'lucide-react';

// Two icons the locked version of lucide-react does not have yet (package-question-mark and mail-exclamation-point). Same drawing as the
// library's (ISC license), as plain SVG, so they look like the rest.
const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' };
const PackageQuestionMark = (props) => (
  <svg {...base} {...props}>
    <path d="M12 22V12l8.71-5" />
    <path d="M21 10.342V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2.33-1.332" />
    <path d="M3.29 7 12 12" /><path d="m7.5 4.27 9 5.15" />
    <path d="M19 18.5c.5-1 2-1 2-2.5a2 2 0 00-2-2 2.5 2.5 0 00-2 1" /><path d="M19 22h.01" />
  </svg>
);
const MailExclamationPoint = (props) => (
  <svg {...base} {...props}>
    <path d="M22 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12.5" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /><path d="M20 14v4" /><path d="M20 22v.01" />
  </svg>
);

// The icon of each kind of result. Anything not listed (domain not found, rate limit, TLS, size, unknown) gets the generic mail alert.
const RESULT_ICONS = Object.freeze({
  sent: CheckCheck, progress: Clock, mailbox_not_found: MailQuestionMark, blocked_spam: Bug, typo: UserRoundPen,
  deferred: ServerOff, unreachable: ServerOff, mailbox_full: PackageQuestionMark
});
const TONE_COLOR = Object.freeze({ ok: 'text-emerald-600', warning: 'text-amber-600', danger: 'text-red-600', info: 'text-sky-600' });

// An icon followed by the short text. The success case is the icon alone (green double check), with its meaning for screen readers and as a tooltip.
export default function ResultBadge({ result, title }) {
  const Icon = RESULT_ICONS[result.key] || MailExclamationPoint;
  const color = TONE_COLOR[result.tone] || TONE_COLOR.info;
  if (result.key === 'sent') {
    return <span className={`inline-flex items-center ${color}`} title={title || result.label}><Icon width={18} height={18} /><span className="sr-only">{result.label}</span></span>;
  }
  return <span className={`inline-flex max-w-full items-center gap-1.5 ${color}`} title={title || result.label}><Icon className="shrink-0" /><span className="truncate text-slate-800">{result.label}</span></span>;
}
