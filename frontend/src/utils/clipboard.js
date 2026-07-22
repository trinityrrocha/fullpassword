export const copyToClipboardSilently = async (value) => {
  if (!value) return;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(value));
      return;
    }

    if (typeof document === 'undefined') return;
    const textarea = document.createElement('textarea');
    textarea.value = String(value);
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.select();
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  } catch {
    // A cópia é intencionalmente silenciosa, inclusive em caso de falha.
  }
};
