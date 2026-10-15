import { useState, useEffect, useRef } from 'react';
import { Lock, KeyRound, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import SecurePasswordInput from './SecurePasswordInput';
import RecoveryCodesPanel from './RecoveryCodesPanel';
import ActiveSessionsCard from './ActiveSessionsCard';
import NavigationPreferences from './NavigationPreferences';
import { normalizeNavigationPreferences } from '../utils/navigationPreferences';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import FormDialog from './FormDialog';
import ProfileSecurityDialog from './ProfileSecurityDialog';

export default function UserProfileModal(props) {
  const { user } = useAuth();
  return props.isOpen ? <ProfileContent key={user?.id} {...props} /> : null;
}

function ProfileContent({ onClose, forcePasswordChange = false }) {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [child, setChild] = useState(null);
  const [profileSaved,setProfileSaved] = useState(false);
  const [formData,setFormData] = useState({...normalizeNavigationPreferences(user),name:user?.name || ''});
  const reloadTimer=useRef(null);
  const profileSaving=useRef(false);
  const [mfaStatus, setMfaStatus] = useState(null);
  const [mfaSetup, setMfaSetup] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [recoveryCodesAcknowledged, setRecoveryCodesAcknowledged] = useState(true);
  const [mfaRecoveryOpen, setMfaRecoveryOpen] = useState(false);
  const [mfaRecoveryError, setMfaRecoveryError] = useState('');
  const [mfaRecoveryForm, setMfaRecoveryForm] = useState({
    currentPassword: '',
    recoveryCode: ''
  });
  

  useEffect(() => {
    if(forcePasswordChange)return;
    const abort=new AbortController();
    api.get('/users/profile/mfa',{signal:abort.signal}).then(({data})=>{if(!abort.signal.aborted)setMfaStatus(data);}).catch(()=>{});
    return()=>abort.abort();
  },[forcePasswordChange]);
  useEffect(()=>()=>clearTimeout(reloadTimer.current),[]);
  useClearOnVaultLock(()=>{
    setChild(null);setMfaSetup(null);setMfaCode('');setRecoveryCodes([]);setRecoveryCodesAcknowledged(true);
    setMfaRecoveryOpen(false);setMfaRecoveryForm({currentPassword:'',recoveryCode:''});
    setError('');setSuccess('');
  });
  const handleClose=()=>{
    if(isSaving)return;
    if(recoveryCodes.length > 0 && !recoveryCodesAcknowledged){setError('Baixe, copie ou confirme que guardou os códigos de recuperação antes de fechar esta janela.');return;}
    onClose();
  };
  const saveProfile=async event=>{
    event.preventDefault();if(profileSaving.current || isSaving || profileSaved)return;setError('');setSuccess('');
    if(!formData.name.trim()){setError('Informe seu nome.');return;}
    profileSaving.current=true;setIsSaving(true);
    try {
      await api.put('/users/profile',{name:formData.name,email:user.email,current_password:'',...normalizeNavigationPreferences(formData)});
      setProfileSaved(true);setSuccess('Perfil atualizado com sucesso!');reloadTimer.current=setTimeout(()=>window.location.reload(),1800);
    } catch(e){setError(e.response?.data?.error||'Não foi possível salvar seu perfil.');}
    finally{profileSaving.current=false;setIsSaving(false);}
  };
  const startMfaSetup = async () => {
    setError('');
    setIsSaving(true);
    try {
      const { data } = await api.post('/users/profile/mfa/setup/start');
      setMfaSetup(data);
      setRecoveryCodes([]);
      setRecoveryCodesAcknowledged(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível iniciar a configuração MFA.');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmMfaSetup = async () => {
    setError('');
    setIsSaving(true);
    try {
      const { data } = await api.post('/users/profile/mfa/setup/confirm', { code: mfaCode });
      setRecoveryCodes(data.recovery_codes || []);
      setRecoveryCodesAcknowledged(false);
      setMfaStatus((status) => ({ ...status, mfa_enabled: true, recovery_codes_remaining: data.recovery_codes?.length || 0 }));
      setMfaSetup(null);
      setMfaCode('');
    } catch (err) {
      setError(err.response?.data?.error || 'Código MFA inválido.');
    } finally {
      setIsSaving(false);
    }
  };

  const regenerateRecoveryCodes = async () => {
    setError('');
    if (!mfaCode) return setError('Informe o código atual do autenticador.');
    setIsSaving(true);
    try {
      const { data } = await api.post('/users/profile/mfa/recovery-codes/regenerate', { code: mfaCode });
      setRecoveryCodes(data.recovery_codes || []);
      setRecoveryCodesAcknowledged(false);
      setMfaCode('');
      setMfaStatus((status) => ({ ...status, recovery_codes_remaining: data.recovery_codes?.length || 0 }));
      setSuccess('Novos códigos gerados. Salve o novo PDF; os códigos anteriores foram invalidados.');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível regenerar os códigos.');
    } finally {
      setIsSaving(false);
    }
  };

  const openMfaRecovery = () => {
    setError('');
    setSuccess('');
    setMfaRecoveryError('');
    setMfaRecoveryForm({ currentPassword: '', recoveryCode: '' });
    setMfaRecoveryOpen(true);
  };

  const closeMfaRecovery = () => {
    if (isSaving) return;
    setMfaRecoveryOpen(false);
    setMfaRecoveryError('');
    setMfaRecoveryForm({ currentPassword: '', recoveryCode: '' });
  };

  const disableMfaWithRecoveryCode = async () => {
    setMfaRecoveryError('');
    if (!mfaRecoveryForm.currentPassword) {
      setMfaRecoveryError('Informe sua senha atual.');
      return;
    }
    if (!mfaRecoveryForm.recoveryCode.trim()) {
      setMfaRecoveryError('Informe um código de recuperação ainda não usado.');
      return;
    }

    setIsSaving(true);
    try {
      const { data } = await api.post('/users/profile/mfa/disable', {
        current_password: mfaRecoveryForm.currentPassword,
        mfa_method: 'recovery_code',
        recovery_code: mfaRecoveryForm.recoveryCode.trim()
      });
      setMfaStatus((status) => ({
        ...status,
        mfa_enabled: false,
        recovery_codes_remaining: 0
      }));
      setMfaSetup(null);
      setMfaCode('');
      setRecoveryCodes([]);
      setRecoveryCodesAcknowledged(true);
      setMfaRecoveryOpen(false);
      setMfaRecoveryForm({ currentPassword: '', recoveryCode: '' });
      setSuccess(
        data?.message
        || 'MFA desativado com sucesso. Agora você pode ativar novamente o MFA e gerar novos códigos de recuperação.'
      );
    } catch (err) {
      setMfaRecoveryError(err.response?.data?.error || 'Não foi possível desativar o MFA.');
    } finally {
      setIsSaving(false);
    }
  };


  if(forcePasswordChange)return <ProfileSecurityDialog kind="password" forced onClose={()=>{}} onSessionEnd={onClose} />;
  const actionClass='flex items-start gap-3 rounded-md border border-slate-200 p-3 text-left hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:hover:bg-slate-800';
  return <>
    <FormDialog title="Meu Perfil" onClose={handleClose} busy={isSaving || profileSaved} saved={profileSaved} panelAttribute={{'data-profile-panel':true}} footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" data-dialog-cancel onClick={handleClose} disabled={isSaving || profileSaved} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 dark:border-slate-600 dark:hover:bg-slate-700">Cancelar</button>
      <button type="submit" form="profileForm" disabled={isSaving || profileSaved} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 disabled:opacity-60">{isSaving?'Salvando…':'Salvar Alterações'}</button>
    </div>}>
      <form id="profileForm" onSubmit={saveProfile} noValidate className="space-y-4">
        <fieldset disabled={isSaving || profileSaved} className="contents">
        <label htmlFor="profile-name" className="block text-sm font-medium">Nome<input id="profile-name" name="name" value={formData.name} onChange={event=>setFormData(current=>({...current,name:event.target.value}))} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600" /></label>
        <div><label htmlFor="profile-email" className="block text-sm font-medium">E-mail</label><div className="mt-1 flex items-center gap-2">
          <input id="profile-email" name="email" type="email" readOnly value={user.email} className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 text-sm dark:border-slate-600 dark:bg-slate-800"/>
          <button type="button" onClick={()=>setChild('email')} className="h-9 rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 dark:border-slate-600 dark:hover:bg-slate-700">Alterar</button>
        </div></div>
        <section className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <h3 className="text-sm font-medium">Senhas</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" className={actionClass} onClick={()=>setChild('password')}><Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500"/><span><span className="block text-sm font-medium">Senha do perfil</span><span className="block text-xs text-slate-500 dark:text-slate-400">Usada para entrar no FullPassword.</span></span></button>
            <button type="button" className={actionClass} onClick={()=>setChild('vault')}><KeyRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500"/><span><span className="block text-sm font-medium">Senha dos cofres</span><span className="block text-xs text-slate-500 dark:text-slate-400">Usada para desbloquear seus cofres.</span></span></button>
          </div>
        </section>
        {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success&&<p role="status" className="text-sm text-green-700 dark:text-green-300">{success}</p>}
                      <div className="pt-4 border-t border-slate-200 space-y-3">
                        <h4 className="text-sm font-medium text-slate-900 flex items-center"><ShieldCheck className="w-4 h-4 mr-1" />Autenticação em dois fatores</h4>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-slate-600">
                            Status: <span className="font-medium">{mfaStatus?.mfa_enabled ? 'Habilitada' : 'Não configurada'}</span>
                            {mfaStatus?.mfa_required ? ' — obrigatória pela política' : ''}
                          </p>
                          {!mfaStatus?.mfa_enabled && !mfaSetup && (
                            <button type="button" onClick={startMfaSetup} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Configurar aplicativo autenticador</button>
                          )}
                        </div>
                        {mfaSetup && (
                          <div className="space-y-3 rounded-md bg-slate-50 p-3">
                            <img src={mfaSetup.qr_code_data_url} alt="QR Code MFA" className="mx-auto h-44 w-44" />
                            <input type="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="Código de 6 dígitos" className="block w-full border border-slate-300 rounded-md py-2 px-3 text-sm" />
                            <button type="button" onClick={confirmMfaSetup} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Confirmar e habilitar MFA</button>
                          </div>
                        )}
                        {mfaStatus?.mfa_enabled && (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-500">Códigos de recuperação restantes: {mfaStatus.recovery_codes_remaining ?? 0}</p>
                            {(mfaStatus.recovery_codes_remaining ?? 0) <= 3 && (
                              <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                                Você tem poucos códigos de recuperação restantes. Gere novos códigos usando a opção de regeneração abaixo.
                              </p>
                            )}
                            <p className="text-xs text-slate-500">
                              Eles substituem o TOTP quando você perde acesso ao aplicativo autenticador, mas não substituem sua senha nem descriptografam cofres.
                            </p>
                            <input type="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="Código atual do autenticador" className="block w-full border border-slate-300 rounded-md py-2 px-3 text-sm" />
                            <button type="button" onClick={regenerateRecoveryCodes} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Regenerar códigos de recuperação</button>
                            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                              <p className="text-sm font-medium text-amber-900">Perdeu acesso ao aplicativo autenticador?</p>
                              <p className="mt-1 text-xs text-amber-800">
                                Use um código de recuperação para desativar o MFA e configurar um novo aplicativo.
                              </p>
                              <button type="button" onClick={openMfaRecovery} className="mt-2 text-sm font-medium text-indigo-700 hover:text-indigo-900">
                                Perdi acesso ao aplicativo autenticador
                              </button>
                            </div>
                          </div>
                        )}
                        <RecoveryCodesPanel
                          codes={recoveryCodes}
                          userEmail={user?.email}
                          onSaved={() => setRecoveryCodesAcknowledged(true)}
                          onAcknowledged={() => setRecoveryCodesAcknowledged(true)}
                        />
                      </div>

        <NavigationPreferences value={normalizeNavigationPreferences(formData)} onChange={(field,value)=>setFormData(current=>({...current,[field]:value}))}/>
        <section className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700"><h3 className="text-sm font-medium">Sessões ativas</h3><ActiveSessionsCard compactProfile/></section>
        </fieldset>
      </form>
    </FormDialog>
    {child&&<ProfileSecurityDialog kind={child} onClose={()=>setChild(null)} onSessionEnd={onClose} mfaEnabled={mfaStatus?.mfa_enabled ?? user?.mfa_enabled===true}/>}
    {mfaRecoveryOpen&&<FormDialog title="Reconfigurar MFA" child onClose={closeMfaRecovery} busy={isSaving} footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" data-dialog-cancel onClick={closeMfaRecovery} disabled={isSaving} className="rounded-md border px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700">Cancelar</button>
      <button type="button" onClick={disableMfaWithRecoveryCode} disabled={isSaving} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">{isSaving?'Desativando…':'Desativar MFA usando código de recuperação'}</button>
    </div>}>
      <div className="space-y-3 text-sm"><p>Informe sua senha atual e um código de recuperação ainda não usado. O MFA atual será desativado para permitir uma nova configuração.</p>
        {mfaRecoveryError&&<p role="alert" className="text-red-600">{mfaRecoveryError}</p>}
        <SecurePasswordInput name="mfa-recovery-password" label="Senha atual" autoComplete="current-password" value={mfaRecoveryForm.currentPassword} onChange={event=>setMfaRecoveryForm(current=>({...current,currentPassword:event.target.value}))} enableGenerator={false} showCopyButton={false}/>
        <label className="block">Código de recuperação<input type="text" autoComplete="one-time-code" maxLength={19} value={mfaRecoveryForm.recoveryCode} onChange={event=>setMfaRecoveryForm(current=>({...current,recoveryCode:event.target.value.toUpperCase()}))} placeholder="XXXX-XXXX-XXXX-XXXX" className="mt-1 h-9 w-full rounded-md border px-3 font-mono"/></label>
        <p className="text-xs text-slate-500">O código será consumido após a desativação do MFA.</p>
      </div>
    </FormDialog>}
  </>;
}
