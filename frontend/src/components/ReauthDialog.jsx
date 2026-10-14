import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import api from '../services/api';

export default function ReauthDialog() {
  const pending=useRef(null),form=useRef(null),busyRef=useRef(false);
  const [open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[showPassword,setShowPassword]=useState(false);
  const finish=useCallback(token=>{pending.current?.resolve(token);pending.current=null;setOpen(false);setShowPassword(false);},[]);
  useEffect(()=>{
    const receive=event=>{
      if(pending.current) {event.detail.resolve(null);return;}
      pending.current=event.detail;setError('');setOpen(true);
    };
    window.addEventListener('fullpassword:reauth',receive);
    return ()=>{window.removeEventListener('fullpassword:reauth',receive);pending.current?.resolve(null);pending.current=null;};
  },[]);
  useEffect(()=>{
    if(!open) return;
    const previous=document.activeElement,root=document.getElementById('root'),wasInert=root?.inert,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    if(root)root.inert=true;
    form.current?.querySelector('input')?.focus();
    const keydown=event=>{
      if(event.key==='Escape' && !busyRef.current) {event.preventDefault();finish(null);}
      if(event.key==='Tab') {
        const fields=[...form.current.querySelectorAll('input,button')].filter(field=>!field.disabled);
        const first=fields[0],last=fields.at(-1);
        if(event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',keydown);
    return ()=>{
      document.removeEventListener('keydown',keydown);
      if(root)root.inert=wasInert;
      document.body.style.overflow=overflow;
      if(previous?.isConnected) {
        if(previous.disabled)previous.closest('[data-focus-return]')?.focus();
        else previous.focus();
      }
    };
  },[open,finish]);
  if(!open) return null;
  const submit=async event=>{
    event.preventDefault();
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');
    const values=new FormData(event.currentTarget);event.currentTarget.reset();
    try {
      const {data}=await api.post('/auth/reauth',{purpose:pending.current.purpose,action:pending.current.action,current_password:values.get('password'),mfa_code:values.get('code')});
      finish(data.token);
    } catch {setError('Não foi possível confirmar. Confira sua senha de login e use um código MFA novo, se habilitado.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
    <form ref={form} onSubmit={submit} noValidate aria-busy={busy} className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded bg-white p-6 dark:bg-slate-900">
      <h2 id="reauth-title" className="font-semibold">Confirmar alteração sensível</h2>
      <p className="text-sm">Use a senha de login, nunca o segredo de desbloqueio dos cofres.</p>
      <label className="block">Senha de login<input name="password" type={showPassword?'text':'password'} autoComplete="current-password" className="w-full rounded border p-2" /></label>
      <button type="button" aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)} className="cursor-pointer rounded border px-2 py-1 focus-visible:outline focus-visible:outline-2">{showPassword?'Ocultar senha de login':'Mostrar senha de login'}</button>
      <label className="block">MFA, se habilitado<input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-full rounded border p-2" /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} type="button" onClick={()=>finish(null)} className="cursor-pointer rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed">Cancelar</button>
      <button disabled={busy} type="submit" className="ml-4 cursor-pointer rounded bg-indigo-600 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed">{busy?'Confirmando…':'Confirmar'}</button>
    </form>
  </div>,document.body);
}
