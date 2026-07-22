import { Trash2 } from 'lucide-react';

export default function DeleteConfirmationControl({ value, onChange, onDelete, disabled = false }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        title="Excluir"
        aria-label="Excluir"
        disabled={disabled}
        onClick={onDelete}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <input
        type="text"
        value={value}
        onChange={onChange}
        aria-label="Digite EXCLUIR para confirmar a exclusão"
        title="Digite EXCLUIR para confirmar a exclusão"
        placeholder="EXCLUIR"
        autoComplete="off"
        className="h-9 w-28 rounded-md border border-red-300 px-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
      />
    </div>
  );
}
