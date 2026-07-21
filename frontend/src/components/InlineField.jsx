export default function InlineField({ label, children, className = '' }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center ${className}`}>
      <div className="w-full shrink-0 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 sm:w-32">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
