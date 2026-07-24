import { useEffect } from 'react';

export default function ScreenProtection({ children, enabled = true }) {

  useEffect(() => {
    if (!enabled) return undefined;

    let printScreenTimer;
    const protectScreen = () => document.documentElement.classList.add('screen-protected');
    const restoreScreen = () => {
      if (!document.hidden) document.documentElement.classList.remove('screen-protected');
    };
    const handleVisibilityChange = () => {
      document.documentElement.classList.toggle('screen-protected', document.hidden);
    };
    const handleProtectedShortcut = (event) => {
      const key = event.key?.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === 'p') {
        event.preventDefault();
        event.stopPropagation();
      }

      if (event.key === 'PrintScreen' || key === 'printscreen') {
        event.preventDefault();
        event.stopPropagation();
        protectScreen();

        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText('').catch(() => undefined);
        }

        window.clearTimeout(printScreenTimer);
        printScreenTimer = window.setTimeout(() => {
          if (!document.hidden && document.hasFocus()) {
            document.documentElement.classList.remove('screen-protected');
          }
        }, 1500);
      }
    };

    window.addEventListener('blur', protectScreen);
    window.addEventListener('focus', restoreScreen);
    window.addEventListener('keydown', handleProtectedShortcut, true);
    window.addEventListener('keyup', handleProtectedShortcut, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(printScreenTimer);
      window.removeEventListener('blur', protectScreen);
      window.removeEventListener('focus', restoreScreen);
      window.removeEventListener('keydown', handleProtectedShortcut, true);
      window.removeEventListener('keyup', handleProtectedShortcut, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.classList.remove('screen-protected');
    };
  }, [enabled]);

  if (!enabled) return children;

  return (
    <>
      <div className="protected-app-content">{children}</div>
      <div className="screen-protection-print-message" aria-hidden="true">
        Impressão bloqueada por política de segurança.
      </div>
    </>
  );
}
