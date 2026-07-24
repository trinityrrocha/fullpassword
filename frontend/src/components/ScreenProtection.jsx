import { useEffect, useState } from 'react';

const formatWatermarkDate = (value) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}).format(value);

export default function ScreenProtection({ children, userEmail, enabled = true }) {
  const [watermarkDate, setWatermarkDate] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return undefined;

    const updateWatermark = window.setInterval(() => setWatermarkDate(new Date()), 60_000);
    const protectScreen = () => document.documentElement.classList.add('screen-protected');
    const restoreScreen = () => {
      if (!document.hidden) document.documentElement.classList.remove('screen-protected');
    };
    const handleVisibilityChange = () => {
      document.documentElement.classList.toggle('screen-protected', document.hidden);
    };
    const blockPrintShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'p') {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('blur', protectScreen);
    window.addEventListener('focus', restoreScreen);
    window.addEventListener('keydown', blockPrintShortcut, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(updateWatermark);
      window.removeEventListener('blur', protectScreen);
      window.removeEventListener('focus', restoreScreen);
      window.removeEventListener('keydown', blockPrintShortcut, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.classList.remove('screen-protected');
    };
  }, [enabled]);

  if (!enabled) return children;

  return (
    <>
      <div className="protected-app-content">{children}</div>
      <div className="screen-protection-watermark" aria-hidden="true">
        <span>{userEmail || 'Usuário autenticado'}</span>
        <span>FullPassword</span>
        <span>{formatWatermarkDate(watermarkDate)}</span>
      </div>
      <div className="screen-protection-print-message" aria-hidden="true">
        Impressão bloqueada por política de segurança.
      </div>
    </>
  );
}
