import { Download, X } from 'lucide-react';
import { downloadAttachment } from '../utils/attachments';

export default function ReadOnlyDetailsModal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" title="Fechar" aria-label="Fechar" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-6">{children}</div>
        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Fechar</button>
        </div>
      </div>
    </div>
  );
}

export function ReadOnlyField({ label, value, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{children ?? value ?? '-'}</div>
    </div>
  );
}

export function ReadOnlySection({ title, children }) {
  return <section><h4 className="mb-2 text-sm font-semibold text-slate-900">{title}</h4>{children}</section>;
}

export function ReadOnlyAttachments({ files = [] }) {
  const attachments = files.filter(Boolean);
  return (
    <ReadOnlySection title="Anexos">
      {attachments.length === 0 ? <p className="text-sm text-slate-500">Nenhum anexo cadastrado.</p> : (
        <div className="space-y-2">
          {attachments.map((file, index) => (
            <div key={file.id || `${file.name || file.fileName || 'anexo'}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
              <span className="min-w-0 truncate text-sm text-slate-700">{file.name || file.fileName || file.filename || 'Anexo'}</span>
              <button type="button" title="Baixar anexo" aria-label="Baixar anexo" onClick={() => downloadAttachment(file)} disabled={!file.data} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
    </ReadOnlySection>
  );
}
