import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import IpCidrInput from './IpCidrInput';
import Ipv4Input from './Ipv4Input';
import { validateIpv4, validateIpv4Cidr } from '../utils/ipCidr';
import { getMacAddressError, normalizeMacAddress } from '../utils/macAddress';

export default function ServerConnectionFields({ connection, label, icon, vpnOptions, onChange, onRemove }) {
  const [macTouched, setMacTouched] = useState(false);
  const errorId = useId();
  const macError = macTouched ? getMacAddressError(connection.mac) : '';
  const ipv4 = validateIpv4Cidr(connection.ipv4);
  const gateway = validateIpv4(connection.gateway);
  const isVpn = connection.type === 'VPN';
  return <div data-server-connection={connection.type} className="w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_24px] items-center gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] lg:grid-cols-[minmax(0,1.3fr)_150px_minmax(0,1fr)_minmax(0,1fr)_24px]">
      <div className="col-start-1 flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/15 sm:col-span-2 lg:col-span-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        <span className="shrink-0">{icon}</span>
        {isVpn ? <select aria-label="Tipo de VPN" className="h-full w-[100px] min-w-0 shrink-0 border-0 bg-transparent p-0 text-[13px] outline-none focus:ring-0 dark:bg-slate-900 dark:text-slate-100" value={connection.vpn || 'OpenVPN'} onChange={(event) => onChange('vpn', event.target.value)}>
          {vpnOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select> : <span className="shrink-0">{label}</span>}
        <input type="text" aria-label="Nome da conexão" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-700 placeholder-slate-400 outline-none focus:ring-0 dark:text-slate-200 dark:placeholder-slate-500" value={connection.name || ''} onChange={(event) => onChange('name', event.target.value)} placeholder="Nome" />
      </div>
      <input type="text" aria-label="MAC da conexão" placeholder="00:00:00:00:00:00" autoComplete="off" spellCheck={false}
        className={`col-start-1 h-10 w-full min-w-0 rounded-md border bg-white px-2 text-[13px] shadow-sm outline-none focus:ring-2 focus:ring-indigo-500/15 lg:col-start-auto dark:bg-slate-900 dark:text-slate-100 ${macError ? 'border-red-600' : 'border-slate-300 focus:border-indigo-500 dark:border-slate-700'}`}
        value={connection.mac ?? ''} onChange={(event) => onChange('mac', event.target.value)}
        onBlur={() => { setMacTouched(true); onChange('mac', normalizeMacAddress(connection.mac)); }}
        aria-invalid={Boolean(macError)} aria-describedby={macError ? errorId : undefined} title={macError || 'MAC (opcional)'} />
      <IpCidrInput value={connection.ipv4} onChange={(value) => onChange('ipv4', value)} state={ipv4.state} error={ipv4.error}
        label="" ariaLabel={isVpn ? 'IPV4/CIDR da VPN' : 'IPV4/CIDR'} placeholder="192.168.1.10/24" prefix="IPV4/" required={false} showHelperText={false}
        containerClassName="col-start-1 w-full min-w-0 sm:col-start-2 lg:col-start-auto" inputWrapperClassName="h-10 w-full min-w-0" inputClassName="text-[13px] tracking-normal" />
      <Ipv4Input value={connection.gateway} onChange={(value) => onChange('gateway', value)} state={gateway.state} error={gateway.error}
        label="" ariaLabel="Gateway(IPV4)" placeholder="192.168.1.1" prefix="Gateway/" required={false} showHelperText={false}
        containerClassName="col-start-1 w-full min-w-0 lg:col-start-auto" inputWrapperClassName="h-10 w-full min-w-0" inputClassName="text-[13px] tracking-normal" />
      <button type="button" title="Excluir conexão" aria-label="Excluir conexão" onClick={onRemove} className="action-icon-button action-icon-delete col-start-2 row-start-1 justify-self-center sm:col-start-3 lg:col-start-5"><Trash2 className="h-4 w-4" /></button>
    </div>
    {macError && <p id={errorId} role="alert" className="px-2 pb-1 text-xs text-red-600 dark:text-red-400">{macError}</p>}
  </div>;
}
