import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import FormDialog from './FormDialog';
import SecurePasswordInput from './SecurePasswordInput';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { profilePasswordPayload } from '../services/profilePasswordService';
import { changeIdentityUnlockSecret } from '../services/identityUnlockService';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';

const field='block h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-950';
const button='min-h-9 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-700';
const titles={email:'Alterar e-mail',password:'Alterar senha do perfil',vault:'Alterar senha dos cofres'};
export default function ProfileSecurityDialog({kind,onClose,onSessionEnd,forced=false,mfaEnabled:activeMfa}) {
  const {user,logout,completeIdentityUnlockChange}=useAuth();
  const mfaEnabled=activeMfa ?? user?.mfa_enabled===true;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pendingEmail,setPendingEmail]=useState(false),[requestedEmail,setRequestedEmail]=useState(''),[identity,setIdentity]=useState(null);
  const [completed,setCompleted]=useState(false);
  const form=useRef(null),pending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useClearOnVaultLock(()=>{form.current?.reset();if(!forced)onClose();});
  useEffect(()=>{
    if(kind!=='vault')return;
    const abort=new AbortController();
    api.get('/crypto/identity',{signal:abort.signal}).then(({data})=>{if(!abort.signal.aborted){setIdentity(data.identity);if(data.identity?.version!==2)setError('Configure sua identidade independente antes de alterar a senha dos cofres.');}}).catch(()=>{if(!abort.signal.aborted)setError('Não foi possível carregar sua identidade. Feche e tente novamente.');});
    return()=>abort.abort();
  },[kind]);
  const passwordInput=(name,label,autoComplete='new-password')=><SecurePasswordInput name={name} label={label} autoComplete={autoComplete} maxLength={1024} enableGenerator={false} showCopyButton={false} className="[&_input]:h-9 [&_input]:py-1" />;
  const finishSession=async()=>{
    // Commit close/guard cleanup before the existing logout/401 navigation.
    flushSync(()=>{setCompleted(true);onSessionEnd?.();});
    await logout();window.location.assign('/login');
  };
  const submit=async event=>{
    event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');
    const values=new FormData(event.currentTarget);
    if(kind!=='email')event.currentTarget.reset();
    else if(pendingEmail)event.currentTarget.elements.code.value='';
    try {
      if(kind==='email') {
        if(pendingEmail) {
          if(!values.get('code'))throw new Error('Informe o código de confirmação.');
          await api.post('/auth/confirm-email',{token:String(values.get('code'))});
          await finishSession();
        } else {
          const email=String(values.get('email')||'').trim().toLowerCase();
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email===user.email)throw new Error('Informe um novo e-mail válido.');
          const {data}=await api.put('/users/profile',{name:user.name,email});
          if(!data.email_change_pending)throw new Error('A alteração não foi confirmada. Solicite um novo código.');
          if(alive.current){setRequestedEmail(email);setPendingEmail(true);}
        }
      } else if(kind==='password') {
        const payload=await profilePasswordPayload(user,String(values.get('current_password')||''),String(values.get('new_password')||''),String(values.get('confirmation')||''));
        const {data:grant}=await api.post('/auth/reauth',{purpose:'profile_change',action:payload,current_password:payload.current_password,mfa_code:mfaEnabled?String(values.get('mfa_code')||''):undefined});
        await api.put('/users/profile',{...payload,_reauth_token:grant.token});await finishSession();
      } else {
        if(identity?.version!==2)throw new Error('Configure sua identidade independente antes de alterar a senha dos cofres.');
        const changed=await changeIdentityUnlockSecret({api,identity,currentSecret:String(values.get('current_unlock')||''),newSecret:String(values.get('new_unlock')||''),confirmation:String(values.get('confirmation')||''),loginPassword:String(values.get('login_password')||''),mfaCode:mfaEnabled?String(values.get('mfa_code')||''):undefined});
        completeIdentityUnlockChange(changed);onClose();
      }
    } catch(e) {
      if(alive.current)setError(e.response?.data?.error || (e.name==='OperationError'?'Senha atual dos cofres incorreta.':e.message) || 'Não foi possível concluir a alteração.');
    } finally {pending.current=false;if(alive.current)setBusy(false);}
  };
  const description=kind==='email'?'O endereço só será alterado após confirmar o código enviado ao novo e-mail.':kind==='vault'?'Esta senha protege sua identidade criptográfica e é usada para desbloquear seus cofres. Ela é independente da senha do perfil.':forced?'Defina uma nova senha para continuar. A troca da senha temporária é obrigatória.':'Usada para entrar no FullPassword. Após alterar, entre novamente.';
  return <FormDialog title={titles[kind]} description={description} onClose={onClose} busy={busy} saved={completed} forced={forced} child={!forced} footer={<div className="flex flex-wrap justify-end gap-2">
    {!forced&&<button type="button" data-dialog-cancel disabled={busy} onClick={onClose} className={button}>Cancelar</button>}
    <button type="submit" form="profile-security-form" disabled={busy||(kind==='vault'&&!identity)} className={button+' border-transparent bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-700'}>{busy?'Confirmando…':kind==='email'?(pendingEmail?'Confirmar alteração':'Enviar código'):'Alterar senha'}</button>
  </div>}>
    <form ref={form} id="profile-security-form" onSubmit={submit} noValidate className="space-y-3">
      {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {kind==='email'?<>
        <label className="block text-sm">E-mail atual<input readOnly value={user.email} className={field}/></label>
        <label className="block text-sm">Novo e-mail{pendingEmail?<input key="pending" readOnly value={requestedEmail} className={field}/>:<input key="new" name="email" type="email" autoComplete="email" className={field}/>}</label>
        {pendingEmail&&<p role="status" className="text-sm text-green-700 dark:text-green-300">Enviamos um código de confirmação para o novo endereço.</p>}
        <label className="block text-sm">Código de confirmação<input name="code" autoComplete="one-time-code" disabled={!pendingEmail} className={field}/></label>
      </>:kind==='password'?<>
        {passwordInput('current_password','Senha atual','current-password')}
        <p className="text-xs text-slate-500 dark:text-slate-400">A nova senha deve ter pelo menos 12 caracteres e seguir a política de senha atual.</p>
        {passwordInput('new_password','Nova senha')}{passwordInput('confirmation','Confirmar nova senha')}
        {mfaEnabled&&<label className="block text-sm">Código MFA atual<input name="mfa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={field}/></label>}
      </>:<>
        {passwordInput('current_unlock','Senha atual dos cofres','current-password')}
        <p className="text-xs text-slate-500 dark:text-slate-400">Use de 16 a 1024 caracteres, diferentes da senha atual dos cofres e da senha do perfil.</p>
        {passwordInput('new_unlock','Nova senha dos cofres')}{passwordInput('confirmation','Confirmar nova senha')}
        <fieldset className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700"><legend className="text-sm font-medium">Confirmar identidade</legend>
          {passwordInput('login_password','Senha atual do perfil','current-password')}
          {mfaEnabled&&<label className="block text-sm">Código MFA atual<input name="mfa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={field}/></label>}
        </fieldset>
      </>}
    </form>
  </FormDialog>;
}
