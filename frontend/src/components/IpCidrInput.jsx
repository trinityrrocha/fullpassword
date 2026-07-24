import { useId } from 'react';
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react';
import { sanitizeIpv4CidrInput } from '../utils/ipCidr';

const stateStyles = {
  neutral: 'border-slate-300 focus-within:border-indigo-500 focus-within:ring-indigo-500/15',
  valid: 'border-emerald-600 focus-within:border-emerald-600 focus-within:ring-emerald-600/15',
  invalid: 'border-red-600 focus-within:border-red-600 focus-within:ring-red-600/15'
};

const stateIcons = {
  neutral: <ScanLine className="h-3.5 w-3.5 shrink-0 text-slate-400" />,
  valid: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />,
  invalid: <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
};

export default function IpCidrInput({
  value,
  onChange,
  state = 'neutral',
  error = '',
  label = 'IP ou CIDR',
  ariaLabel = label || 'IP ou CIDR',
  placeholder = '192.168.1.1',
  className = '',
  containerClassName = 'w-[150px]',
  inputWrapperClassName = 'h-[34px] w-[150px]',
  inputClassName = '',
  maxLength = 18,
  neutralMessage = 'IPv4 ou CIDR 0–32.',
  prefix = '',
  required = true,
  showHelperText = true,
  sanitize = sanitizeIpv4CidrInput
}) {
  const id = useId();
  const effectiveState = stateStyles[state] ? state : 'neutral';

  return (
    <div className={`${containerClassName} ${className}`}>
      {label && <label htmlFor={id} className="mb-1 inline-block text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</label>}
      <div title={effectiveState === 'invalid' ? error : undefined} className={`flex items-center gap-1 rounded-md border bg-white px-2 shadow-sm ring-2 ring-transparent transition-all ${inputWrapperClassName} ${stateStyles[effectiveState]}`}>
        {stateIcons[effectiveState]}
        <div className="flex min-w-0 flex-1 items-center">
          {prefix && <span className="shrink-0 font-mono text-sm font-medium text-slate-500">{prefix}</span>}
          <input
            id={id}
            type="text"
            aria-label={ariaLabel}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            required={required}
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(sanitize(event.target.value))}
            maxLength={maxLength}
            aria-invalid={effectiveState === 'invalid'}
            aria-describedby={showHelperText && error ? `${id}-error` : undefined}
            className={`min-w-0 flex-1 bg-transparent font-mono text-xs tracking-tight text-slate-900 outline-none placeholder:text-slate-400 ${inputClassName}`}
          />
        </div>
      </div>
      {showHelperText && (
        <div className="mt-1 min-h-[16px]">
          {effectiveState === 'invalid' && error && <p id={`${id}-error`} className="text-[11px] leading-tight text-red-700" role="alert">{error}</p>}
          {effectiveState === 'valid' && <p className="text-[11px] leading-tight text-emerald-700">Formato válido.</p>}
          {effectiveState === 'neutral' && <p className="text-[11px] leading-tight text-slate-500">{neutralMessage}</p>}
        </div>
      )}
    </div>
  );
}
