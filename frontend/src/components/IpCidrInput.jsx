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
  placeholder = '192.168.1.1',
  className = ''
}) {
  const id = useId();
  const effectiveState = stateStyles[state] ? state : 'neutral';

  return (
    <div className={`w-[133px] ${className}`}>
      {label && <label htmlFor={id} className="mb-1 inline-block text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</label>}
      <div className={`flex h-[30px] w-[133px] items-center gap-1 rounded-md border bg-white px-2 shadow-sm ring-2 ring-transparent transition-all ${stateStyles[effectiveState]}`}>
        {stateIcons[effectiveState]}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(sanitizeIpv4CidrInput(event.target.value))}
          maxLength={18}
          aria-invalid={effectiveState === 'invalid'}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs tracking-tight text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>
      <div className="mt-1 min-h-[16px]">
        {effectiveState === 'invalid' && error && <p id={`${id}-error`} className="text-[11px] leading-tight text-red-700" role="alert">{error}</p>}
        {effectiveState === 'valid' && <p className="text-[11px] leading-tight text-emerald-700">Formato válido.</p>}
        {effectiveState === 'neutral' && <p className="text-[11px] leading-tight text-slate-500">IPv4 ou CIDR 0–32.</p>}
      </div>
    </div>
  );
}
