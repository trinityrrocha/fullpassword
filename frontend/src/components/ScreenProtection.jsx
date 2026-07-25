import { useEffect } from 'react';

export default function ScreenProtection({ children, enabled = true }) {

  useEffect(() => {
    if (!enabled) {
      document.documentElement.classList.remove('screen-protected', 'screen-protection-enabled');
      return undefined;
    }

    let protectionTimer;
    document.documentElement.classList.add('screen-protection-enabled');
    const protectScreen = () => document.documentElement.classList.add('screen-protected');
    const protectTemporarily = () => {
      protectScreen();
      window.clearTimeout(protectionTimer);
      protectionTimer = window.setTimeout(() => {
        if (!document.hidden && document.hasFocus()) {
          document.documentElement.classList.remove('screen-protected');
        }
      }, 2000);
    };
    const restoreScreen = () => {
      if (!document.hidden) document.documentElement.classList.remove('screen-protected');
    };
    const handleVisibilityChange = () => {
      document.documentElement.classList.toggle('screen-protected', document.hidden);
    };
    const handleProtectedShortcut = (event) => {
      const key = String(event.key || '').toLowerCase();
      const code = String(event.code || '').toLowerCase();
      const isPrintScreen = key === 'printscreen' || code === 'printscreen' || event.keyCode === 44;

      if ((event.ctrlKey || event.metaKey) && key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        protectTemporarily();
      }

      if (isPrintScreen) {
        event.preventDefault();
        event.stopPropagation();
        protectTemporarily();

        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText('').catch(() => undefined);
        }
      }
    };

    window.addEventListener('blur', protectScreen);
    window.addEventListener('focus', restoreScreen);
    window.addEventListener('keydown', handleProtectedShortcut, true);
    window.addEventListener('keyup', handleProtectedShortcut, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(protectionTimer);
      window.removeEventListener('blur', protectScreen);
      window.removeEventListener('focus', restoreScreen);
      window.removeEventListener('keydown', handleProtectedShortcut, true);
      window.removeEventListener('keyup', handleProtectedShortcut, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.classList.remove('screen-protected', 'screen-protection-enabled');
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
