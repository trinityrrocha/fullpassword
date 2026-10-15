import {useRef,useState} from 'react';
import api from '../services/api';
import usePasswordPolicy from '../hooks/usePasswordPolicy';
import {MIN_LENGTH_OPTIONS,ROTATION_OPTIONS,PASSWORD_POLICY_CHANGED} from '../services/passwordPolicy';

const selectClass='mt-1 h-[35px] w-full rounded-md border border-slate-300 bg-white px-[9px] py-[6px] text-sm focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950';
export default function PasswordPolicyCard({draft,setDraft}) {
  const {policy,error,reload,acceptPolicy}=usePasswordPolicy();
  const [saving,setSaving]=useState(false),[message,setMessage]=useState('');
  const pending=useRef(false);
  const save=async event=>{
    event.preventDefault();if(!policy||pending.current)return;
    pending.current=true;setSaving(true);setMessage('');
    try {
      const payload=Object.fromEntries(['login_min_length','login_rotation_months','vault_min_length','vault_rotation_months'].map(key=>[key,draft[key]??policy[key]]));
      const {data}=await api.put('/system/password-policy',payload);acceptPolicy(data);setDraft({});
      setMessage('Política de senhas atualizada.');
      window.dispatchEvent(new Event(PASSWORD_POLICY_CHANGED));
    } catch {setMessage('Não foi possível salvar a política. Confira a conexão e tente novamente.');}
    finally {pending.current=false;setSaving(false);}
  };
  return <section aria-labelledby="password-policy-title" className="space-y-4">
    <h4 id="password-policy-title" className="font-semibold text-slate-900 dark:text-slate-100">Política de Senhas</h4>
    {!policy?<div className="min-h-24" role={error?'alert':'status'}>{error||'Carregando política de senhas…'}{error&&<button type="button" onClick={reload} className="ml-2 text-indigo-600 underline focus-visible:outline">Tentar novamente</button>}</div>:
      <form noValidate onSubmit={save} className="space-y-4" aria-label="Política de Senhas">
        {[['login','Senha de login','Usada para acessar o FullPassword.'],['vault','Senha dos cofres','Usada para desbloquear a identidade criptográfica e acessar os cofres.']].map(([kind,title,description])=><fieldset key={kind} disabled={saving} className="space-y-2">
          <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</legend>
          <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[['min_length','Tamanho mínimo',MIN_LENGTH_OPTIONS,'caracteres'],['rotation_months','Solicitar troca a cada',ROTATION_OPTIONS,'meses']].map(([suffix,label,options,unit])=>{
              const key=kind+'_'+suffix;
              return <label key={key} className="min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300">{label}
                <select aria-label={title+' — '+label} value={draft[key]??policy[key]} onChange={event=>setDraft(current=>({...current,[key]:Number(event.target.value)}))} className={selectClass}>
                  {options.map(value=><option key={value} value={value}>{value} {unit}</option>)}
                </select>
              </label>;
            })}
          </div>
        </fieldset>)}
        <p className="text-xs text-slate-500 dark:text-slate-400">As novas regras de tamanho são aplicadas na próxima troca de senha.</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">A senha de login continua exigindo maiúscula, minúscula, número e caractere especial. Senhas comuns são bloqueadas.</p>
        <button type="submit" disabled={saving} aria-busy={saving} className="min-w-32 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60">{saving?'Salvando…':'Salvar política'}</button>
        <p role="status" className="min-h-5 text-sm text-slate-700 dark:text-slate-300">{message}</p>
      </form>}
  </section>;
}
