import {useEffect,useRef,useState} from 'react';
import api from '../services/api';

export default function ReauthDialog() {
  const pending=useRef(null);
  const [open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const receive=event=>{
      if(pending.current) {event.detail.resolve(null);return;}
      pending.current=event.detail;setError('');setOpen(true);
    };
    window.addEventListener('fullpassword:reauth',receive);
    return ()=>{window.removeEventListener('fullpassword:reauth',receive);pending.current?.resolve(null);pending.current=null;};
  },[]);
  const finish=token=>{pending.current?.resolve(token);pending.current=null;setOpen(false);};
  if(!open) return null;
  const submit=async event=>{
    event.preventDefault();setBusy(true);setError('');
    const values=new FormData(event.currentTarget);event.currentTarget.reset();
    try {
      const {data}=await api.post('/auth/reauth',{purpose:pending.current.purpose,action:pending.current.action,current_password:values.get('password'),mfa_code:values.get('code')});
      finish(data.token);
    } catch {setError('Não foi possível confirmar. Confira sua senha de login e use um código MFA novo, se habilitado.');}
    finally{setBusy(false);}
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Confirmar identidade">
    <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded bg-white p-6 dark:bg-slate-900">
      <h2 className="font-semibold">Confirmar alteração sensível</h2>
      <p className="text-sm">Use a senha de login, nunca o segredo de desbloqueio dos cofres.</p>
      <label className="block">Senha de login<input autoFocus required name="password" type="password" autoComplete="current-password" className="w-full rounded border p-2" /></label>
      <label className="block">MFA, se habilitado<input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-full rounded border p-2" /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} type="button" onClick={()=>finish(null)}>Cancelar</button>
      <button disabled={busy} type="submit" className="ml-4 rounded bg-indigo-600 px-3 py-2 text-white">Confirmar</button>
    </form>
  </div>;
}
