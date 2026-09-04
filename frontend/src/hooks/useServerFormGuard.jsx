import { useState } from 'react';
import ReadOnlyDetailsModal from '../components/ReadOnlyDetailsModal';

export default function useServerFormGuard(value, onCancel, onSave, isSaving, extraDirty = false) {
  const [initial] = useState(() => JSON.stringify(value));
  const [showDialog, setShowDialog] = useState(false);
  const dirty = extraDirty || JSON.stringify(value) !== initial;
  const requestClose = () => {
    if (isSaving) return;
    if (dirty) setShowDialog(true);
    else onCancel();
  };
  const dialog = showDialog ? (
    <ReadOnlyDetailsModal title="Alterações não salvas" onClose={() => { if (!isSaving) setShowDialog(false); }}>
      <p className="text-sm text-slate-700 dark:text-slate-200">Existem alterações não salvas. Deseja salvar antes de fechar?</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={isSaving} onClick={() => setShowDialog(false)} className="rounded border px-3 py-2 text-sm dark:text-slate-200">Continuar editando</button>
        <button type="button" disabled={isSaving} onClick={onCancel} className="rounded border px-3 py-2 text-sm text-red-600">Descartar</button>
        <button type="button" disabled={isSaving} onClick={async () => { setShowDialog(false); await onSave(); }} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white">Salvar e fechar</button>
      </div>
    </ReadOnlyDetailsModal>
  ) : null;
  return { requestClose, dialog };
}
