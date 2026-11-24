const PAGE_SIZE_OPTIONS = Object.freeze([20, 40, 100]);

const linkButton = 'rounded px-2 py-1 text-sm font-medium text-blue-800 underline hover:bg-slate-100 disabled:opacity-60 disabled:no-underline';

// Shared footer of every long list: previous/next, "page X of Y" and the rows per page (20, 40 or 100).
// The page-size select stays visible even on a single page, so the choice is never hidden.
export default function PaginationBar({ label, page, pages, total = null, pageSize, onPage, onPageSize, sizes = PAGE_SIZE_OPTIONS }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={linkButton}>Anterior</button>
        <span className="text-sm text-slate-600">Página {page} de {pages}{total !== null ? ` · ${new Intl.NumberFormat('pt-BR').format(total)} no total` : ''}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className={linkButton}>Próxima</button>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Por página
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} aria-label={`${label}: resultados por página`} className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900">
          {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
    </nav>
  );
}
