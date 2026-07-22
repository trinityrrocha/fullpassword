import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { normalizeVaultAttachments } from '../utils/vaultAttachments';
import { downloadAttachment } from '../utils/attachments';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const getExtension = (fileName = '') => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
};

const readFileAsAttachment = (file, allowedExtensions) => new Promise((resolve, reject) => {
  const extension = getExtension(file?.name);
  if (!file || !allowedExtensions.includes(extension)) {
    reject(new Error(`Tipo de arquivo não permitido. Use: ${allowedExtensions.join(', ')}.`));
    return;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    reject(new Error('O arquivo deve ter no máximo 5 MB.'));
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    resolve({ id: makeId(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, uploadedAt: new Date().toISOString(), data: result.includes(',') ? result.split(',')[1] : result });
  };
  reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
  reader.readAsDataURL(file);
});

const formatSize = (size = 0) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const formatDate = (value) => {
  if (!value) return 'Data não disponível';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data não disponível' : date.toLocaleString('pt-BR');
};

export default function VaultAttachmentsField({ title, helpText, attachments, allowedExtensions, onChange, multiple = true }) {
  const inputRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const normalizedAttachments = normalizeVaultAttachments(attachments);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const currentSize = normalizedAttachments.reduce((total, attachment) => total + Number(attachment.size || 0), 0);
    const selectedSize = files.reduce((total, file) => total + Number(file.size || 0), 0);
    if (currentSize + selectedSize > MAX_ATTACHMENT_BYTES) {
      setMessage({ type: 'error', text: 'O total de arquivos deste registro deve ter no máximo 5 MB.' });
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const uploaded = await Promise.all(files.map((file) => readFileAsAttachment(file, allowedExtensions)));
      onChange([...normalizedAttachments, ...uploaded]);
      setMessage({ type: 'success', text: 'Arquivo adicionado. Clique em Salvar para concluir.' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Não foi possível adicionar o arquivo.' });
    } finally {
      setIsLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-slate-200 pt-4 sm:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h4 className="text-sm font-semibold text-slate-900">{title}</h4><p className="text-xs text-slate-500">{helpText} Máximo de 5 MB por arquivo.</p></div>
        <button type="button" disabled={isLoading} onClick={() => inputRef.current?.click()} className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Upload className="mr-2 h-4 w-4" /> {isLoading ? 'Adicionando...' : 'Enviar arquivo'}</button>
        <input ref={inputRef} type="file" multiple={multiple} className="sr-only" accept={allowedExtensions.join(',')} onChange={(event) => handleFiles(event.target.files)} />
      </div>
      {message && <p className={`mt-2 text-xs ${message.type === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message.text}</p>}
      <div className="mt-3 space-y-2">
        {normalizedAttachments.length === 0 ? <p className="text-xs text-slate-500">Nenhum arquivo enviado.</p> : normalizedAttachments.map((attachment, index) => (
          <div key={attachment.id || `${attachment.name}-${index}`} className="flex flex-col justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center">
            <div className="min-w-0"><p className="truncate text-sm text-slate-700">{attachment.name}</p><p className="text-xs text-slate-500">{formatSize(attachment.size)} · {formatDate(attachment.uploadedAt)}</p></div>
            <button type="button" onClick={() => downloadAttachment(attachment)} className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><Download className="mr-2 h-4 w-4" /> Download</button>
          </div>
        ))}
      </div>
    </div>
  );
}
