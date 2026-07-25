const CLIPBOARD_CLEAR_DELAY_MS = 45 * 1000;

const scheduleClipboardClear = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
  window.setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => undefined);
  }, CLIPBOARD_CLEAR_DELAY_MS);
};

export const copyToClipboardSilently = async (value) => {
  if (!value) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(value));
      scheduleClipboardClear();
      return true;
    }

    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = String(value);
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    let succeeded = false;
    try {
      textarea.select();
      succeeded = document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
    return succeeded;
  } catch {
    // A cópia é intencionalmente silenciosa, inclusive em caso de falha.
    return false;
  }
};
