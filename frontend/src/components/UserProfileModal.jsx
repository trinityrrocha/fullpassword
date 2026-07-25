import { useState, useEffect } from 'react';
import { User, Lock, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  CRYPTO_KDF_PARAMS_INVALID_ERROR,
  CRYPTO_SALT_REQUIRED_ERROR,
  KDF_PARAMS,
  deriveMasterKey,
  isValidCryptoSalt,
  resolveKdfParams,
  unwrapMasterKeyForTransientUse,
  wrapMasterKey
} from '../services/cryptoService';
import { safeLogError } from '../utils/safeLogger';
import SecurePasswordInput from './SecurePasswordInput';
import RecoveryCodesPanel from './RecoveryCodesPanel';
import ActiveSessionsCard from './ActiveSessionsCard';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';

export default function UserProfileModal({ isOpen, onClose, forcePasswordChange = false }) {
  const { user, logout } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: ''
  });

  useClearOnVaultLock(() => {
    setFormData({
      name: '',
      email: '',
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: ''
    });
    setMfaStatus(null);
    setMfaSetup(null);
    setMfaCode('');
    setRecoveryCodes([]);
    setRecoveryCodesAcknowledged(true);
    setMfaRecoveryOpen(false);
    setMfaRecoveryError('');
    setMfaRecoveryForm({ currentPassword: '', recoveryCode: '' });
    setError('');
    setSuccess('');
    setIsSaving(false);
  });

  useEffect(() => {
    if (isOpen && user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      });
      setError('');
      setSuccess('');
      setMfaSetup(null);
      setMfaCode('');
      setRecoveryCodes([]);
      setRecoveryCodesAcknowledged(true);
      setMfaRecoveryOpen(false);
      setMfaRecoveryError('');
      setMfaRecoveryForm({ currentPassword: '', recoveryCode: '' });
      api.get('/users/profile/mfa')
        .then(({ data }) => setMfaStatus(data))
        .catch(() => setMfaStatus(null));
    }
  }, [isOpen, user]);

  const handleClose = () => {
    if (recoveryCodes.length > 0 && !recoveryCodesAcknowledged) {
      setError('Baixe, copie ou confirme que guardou os códigos de recuperação antes de fechar esta janela.');
      return;
    }
    setFormData((current) => ({
      ...current,
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: ''
    }));
    setMfaCode('');
    setMfaSetup(null);
    setRecoveryCodes([]);
    setRecoveryCodesAcknowledged(true);
    setMfaRecoveryOpen(false);
    setMfaRecoveryError('');
    setMfaRecoveryForm({ currentPassword: '', recoveryCode: '' });
    setError('');
    setSuccess('');
    onClose();
  };

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (recoveryCodes.length > 0 && !recoveryCodesAcknowledged) {
      setError('Baixe, copie ou confirme que guardou os códigos de recuperação antes de continuar.');
      return;
    }
    setIsSaving(true);

    try {
      let payload = {
        name: formData.name,
        email: formData.email,
        current_password: formData.currentPassword
      };

      if (forcePasswordChange && !formData.newPassword) {
        throw new Error('A troca da senha temporária é obrigatória no primeiro acesso.');
      }

      if (formData.newPassword) {
        if (!formData.currentPassword) {
          throw new Error('A senha atual é obrigatória para alterar a senha.');
        }
        if (formData.newPassword !== formData.confirmNewPassword) {
          throw new Error('As novas senhas não coincidem.');
        }
        if (formData.newPassword.length < 12) {
          throw new Error('A nova senha deve ter pelo menos 12 caracteres.');
        }

        const currentWrappedKey = user?.wrapped_key;
        const currentSalt = user?.crypto_salt;

        if (!currentWrappedKey || !isValidCryptoSalt(currentSalt)) {
          const cryptoError = new Error('Não foi possível inicializar a chave criptográfica do usuário.');
          cryptoError.code = CRYPTO_SALT_REQUIRED_ERROR;
          throw cryptoError;
        }

        const currentKek = await deriveMasterKey(
          formData.currentPassword,
          currentSalt,
          resolveKdfParams(user)
        );

        let transientMasterKey = null;
        try {
          /*
           * A chave exportável existe somente durante o rewrap da troca de
           * senha. Ela nunca é armazenada em state/context/ref.
           */
          transientMasterKey = await unwrapMasterKeyForTransientUse(
            currentWrappedKey,
            currentKek,
            'rewrap'
          );
        } catch (err) {
          throw new Error('Senha atual incorreta. Não foi possível acessar a chave mestra.', { cause: err });
        }

        try {
          const newKek = await deriveMasterKey(formData.newPassword, currentSalt, KDF_PARAMS);
          payload.new_password = formData.newPassword;
          payload.wrapped_key = await wrapMasterKey(transientMasterKey, newKek);
          payload.kdf_version = KDF_PARAMS.version;
          payload.kdf_name = KDF_PARAMS.name;
          payload.kdf_hash = KDF_PARAMS.hash;
          payload.kdf_iterations = KDF_PARAMS.iterations;
        } finally {
          transientMasterKey = null;
        }
      }

      const response = await api.put('/users/profile', payload);

      setSuccess(
        response.data?.session_invalidated
          ? 'Perfil atualizado. Faça login novamente com a nova senha.'
          : 'Perfil atualizado com sucesso!'
      );
      
      setFormData(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      }));

      setTimeout(async () => {
        if (response.data?.session_invalidated) {
          await logout();
          window.location.href = '/login';
          return;
        }
        window.location.reload();
      }, 1800);

    } catch (err) {
      safeLogError('Falha ao atualizar o perfil.', err);
      setError(
        [CRYPTO_SALT_REQUIRED_ERROR, CRYPTO_KDF_PARAMS_INVALID_ERROR].includes(err?.code)
          ? 'Não foi possível inicializar a chave criptográfica do usuário. Entre em contato com o administrador.'
          : err.message || err.response?.data?.error || 'Erro ao atualizar perfil.'
      );
    } finally {
      setIsSaving(false);
    }
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 bg-slate-900 bg-opacity-75 transition-opacity"
          aria-hidden="true"
          onClick={() => {
            if (!forcePasswordChange) handleClose();
          }}
        ></div>

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="w-full">
              <div className="mx-auto flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100">
                <User className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="mt-2 w-full text-center">
                <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                  {forcePasswordChange ? 'Troca obrigatória de senha' : 'Meu Perfil'}
                </h3>
                <div className="mt-2 text-left">
                  {forcePasswordChange && <p className="mb-4 text-center text-sm text-slate-500">Você está usando uma senha temporária gerada na instalação. Defina uma nova senha antes de continuar.</p>}

                  {forcePasswordChange && (
                    <div className="mb-4 bg-amber-50 border-l-4 border-amber-400 p-4">
                      <div className="flex">
                        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
                        <p className="ml-3 text-sm text-amber-700">
                          Acesso ao sistema bloqueado até a troca da senha temporária.
                        </p>
                      </div>
                    </div>
                  )}

                  {user?.password_change_recommended && !forcePasswordChange && (
                    <div className="mb-4 bg-amber-50 border-l-4 border-amber-400 p-4">
                      <p className="text-sm text-amber-800">Sua senha está antiga. Recomendamos atualizá-la; o acesso não será bloqueado.</p>
                    </div>
                  )}

                  {error && (
                    <div className="mb-4 bg-red-50 border-l-4 border-red-400 p-4">
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  )}

                  {success && (
                    <div className="mb-4 bg-emerald-50 border-l-4 border-emerald-400 p-4">
                      <p className="text-sm text-emerald-700">{success}</p>
                    </div>
                  )}

                  <form id="profileForm" onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Nome</label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                        className="mt-1 block h-8 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700">E-mail</label>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={(event) => setFormData((previous) => ({ ...previous, email: event.target.value.toLowerCase() }))}
                        required
                        className="mt-1 block h-8 w-full rounded-md border border-slate-300 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
                      />
                    </div>

                    <div className="pt-4 border-t border-slate-200">
                      <h4 className="text-sm font-medium text-slate-900 mb-4 flex items-center">
                        <Lock className="w-4 h-4 mr-1" />
                        {forcePasswordChange ? 'Alterar Senha (Obrigatório)' : 'Alterar Senha (Opcional)'}
                      </h4>
                      
                      <div className="space-y-4">
                        <SecurePasswordInput
                          name="currentPassword"
                          label="Senha Atual"
                          value={formData.currentPassword}
                          onChange={handleChange}
                          placeholder={forcePasswordChange ? 'Senha temporária da instalação' : 'Necessária apenas se for alterar a senha'}
                          enableGenerator={false}
                          required={forcePasswordChange}
                          className="[&_input]:h-8 [&_input]:py-1"
                        />

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <SecurePasswordInput
                            name="newPassword"
                            label="Nova Senha"
                            value={formData.newPassword}
                            onChange={handleChange}
                            placeholder="Mínimo de 12 caracteres"
                            required={forcePasswordChange}
                            className="[&_input]:h-8 [&_input]:py-1"
                          />
                          <SecurePasswordInput
                            name="confirmNewPassword"
                            label="Confirmar"
                            value={formData.confirmNewPassword}
                            onChange={handleChange}
                            placeholder="Repita a nova senha"
                            enableGenerator={false}
                            required={forcePasswordChange}
                            className="[&_input]:h-8 [&_input]:py-1"
                          />
                        </div>
                      </div>
                    </div>

                    {!forcePasswordChange && (
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
                    )}
                    {!forcePasswordChange && (
                      <div className="space-y-2 border-t border-slate-200 pt-3">
                        <h4 className="text-sm font-medium text-slate-900">Sessões Ativas</h4>
                        <ActiveSessionsCard compactProfile />
                      </div>
                    )}
                  </form>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="submit"
              form="profileForm"
              disabled={isSaving}
              className={`inline-flex h-8 w-full items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:ml-3 sm:w-auto ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
              ) : 'Salvar Alterações'}
            </button>
            {!forcePasswordChange && (
              <button
                type="button"
                onClick={handleClose}
                disabled={isSaving}
                className="mt-3 inline-flex h-8 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:ml-3 sm:mt-0 sm:w-auto"
              >
                Cancelar
              </button>
            )}
          </div>
          {mfaRecoveryOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="mfa-recovery-title">
              <div className="w-full max-w-md rounded-lg bg-white p-5 text-left shadow-2xl">
                <h4 id="mfa-recovery-title" className="text-lg font-semibold text-slate-900">Reconfigurar MFA</h4>
                <p className="mt-2 text-sm text-slate-600">
                  Use esta opção se você perdeu acesso ao aplicativo autenticador. Você poderá validar sua identidade usando um código de recuperação do PDF.
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Depois disso, o MFA atual será desativado e você poderá configurar um novo aplicativo autenticador.
                </p>
                {mfaRecoveryError && (
                  <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mfaRecoveryError}</p>
                )}
                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="mfa-recovery-password" className="block text-sm font-medium text-slate-700">Senha atual</label>
                    <input
                      id="mfa-recovery-password"
                      type="password"
                      autoComplete="current-password"
                      maxLength={1024}
                      value={mfaRecoveryForm.currentPassword}
                      onChange={(event) => setMfaRecoveryForm((current) => ({ ...current, currentPassword: event.target.value }))}
                      className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="mfa-recovery-code" className="block text-sm font-medium text-slate-700">Código de recuperação</label>
                    <input
                      id="mfa-recovery-code"
                      type="text"
                      autoComplete="one-time-code"
                      maxLength={19}
                      value={mfaRecoveryForm.recoveryCode}
                      onChange={(event) => setMfaRecoveryForm((current) => ({ ...current, recoveryCode: event.target.value.toUpperCase() }))}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                  <p className="text-xs text-slate-600">
                    Informe sua senha atual e um código de recuperação ainda não usado. O código será consumido após a desativação do MFA.
                  </p>
                </div>
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={closeMfaRecovery} disabled={isSaving} className="h-9 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 disabled:opacity-50">
                    Cancelar
                  </button>
                  <button type="button" onClick={disableMfaWithRecoveryCode} disabled={isSaving} className="h-9 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {isSaving ? 'Desativando...' : 'Desativar MFA usando código de recuperação'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
