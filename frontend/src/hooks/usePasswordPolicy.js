import {useEffect,useState} from 'react';
import api from '../services/api';
import {passwordMinimum,ROTATION_OPTIONS,PASSWORD_POLICY_CHANGED} from '../services/passwordPolicy';
export default function usePasswordPolicy() {
  const [policy,setPolicy]=useState(null),[error,setError]=useState(''),[generation,setGeneration]=useState(0);
  useEffect(()=>{
    const abort=new AbortController();
    api.get('/auth/password-policy',{signal:abort.signal}).then(({data})=>{
      passwordMinimum(data,'login');passwordMinimum(data,'vault');
      if(!ROTATION_OPTIONS.includes(data.login_rotation_months)||!ROTATION_OPTIONS.includes(data.vault_rotation_months))throw new Error('INVALID_POLICY');
      if(!abort.signal.aborted){setPolicy(data);setError('');}
    }).catch(()=>{if(!abort.signal.aborted){setPolicy(null);setError('Não foi possível carregar a política de senhas. Tente novamente.');}});
    const refresh=()=>setGeneration(value=>value+1);
    window.addEventListener(PASSWORD_POLICY_CHANGED,refresh);
    return()=>{abort.abort();window.removeEventListener(PASSWORD_POLICY_CHANGED,refresh);};
  },[generation]);
  const acceptPolicy=data=>{passwordMinimum(data,'login');passwordMinimum(data,'vault');setPolicy(data);};
  return {policy,error,acceptPolicy,reload:()=>setGeneration(value=>value+1)};
}
