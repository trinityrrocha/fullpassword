import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { copyToClipboardSilently } from '../utils/clipboard';

export default function CopyButton({ value, label = 'Copiar', className = 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50', iconClassName = 'h-3.5 w-3.5' }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const handleCopy = async () => {
    const succeeded = await copyToClipboardSilently(value);
    if (!succeeded) return;

    setCopied(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 1000);
  };

  return (
    <span className="relative inline-flex shrink-0">
      {copied && <span className="pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow">Copiado!</span>}
      <button type="button" title={label} aria-label={label} onClick={handleCopy} className={className}><Copy className={iconClassName} /></button>
    </span>
  );
}
