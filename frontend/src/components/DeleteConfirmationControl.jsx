import { Trash2 } from 'lucide-react';

export default function DeleteConfirmationControl({ value, onChange, onDelete, disabled = false }) {
  return (
    <div className="flex min-w-0 flex-1 items-end gap-2">
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
      <div className="min-w-0 flex-1">
        <label className="mb-1 block text-xs font-medium text-red-600">Para excluir, digite EXCLUIR</label>
        <input
          type="text"
          value={value}
          onChange={onChange}
          placeholder="EXCLUIR"
          className="h-9 w-full rounded-md border border-red-300 px-3 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </div>
    </div>
  );
}
