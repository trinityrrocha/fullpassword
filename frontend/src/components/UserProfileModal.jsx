import { useState, useEffect } from 'react';
import { User, Lock, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { deriveMasterKey, unwrapMasterKey, wrapMasterKey } from '../services/cryptoService';
import SecurePasswordInput from './SecurePasswordInput';

export default function UserProfileModal({ isOpen, onClose, forcePasswordChange = false }) {
  const { user, logout } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mfaStatus, setMfaStatus] = useState(null);
  const [mfaSetup, setMfaSetup] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: ''
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
      api.get('/users/profile/mfa')
        .then(({ data }) => setMfaStatus(data))
        .catch(() => setMfaStatus(null));
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
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

        if (!currentWrappedKey || !currentSalt) {
          throw new Error('Chaves criptográficas não encontradas. Faça login novamente.');
        }

        const currentKek = await deriveMasterKey(formData.currentPassword, currentSalt);

        let masterKey;
        try {
          masterKey = await unwrapMasterKey(currentWrappedKey, currentKek);
        } catch (err) {
          throw new Error('Senha atual incorreta. Não foi possível acessar a chave mestra.', { cause: err });
        }

        const newKek = await deriveMasterKey(formData.newPassword, currentSalt);
        const newWrappedKey = await wrapMasterKey(masterKey, newKek);

        payload.new_password = formData.newPassword;
        payload.wrapped_key = newWrappedKey;
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
      console.error('Falha ao atualizar o perfil.');
      setError(err.message || err.response?.data?.error || 'Erro ao atualizar perfil.');
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
      setMfaCode('');
      setMfaStatus((status) => ({ ...status, recovery_codes_remaining: data.recovery_codes?.length || 0 }));
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível regenerar os códigos.');
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
            if (!forcePasswordChange) onClose();
          }}
        ></div>

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 sm:mx-0 sm:h-10 sm:w-10">
                <User className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                  {forcePasswordChange ? 'Troca obrigatória de senha' : 'Meu Perfil'}
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-slate-500 mb-4">
                    {forcePasswordChange
                      ? 'Você está usando uma senha temporária gerada na instalação. Defina uma nova senha antes de continuar.'
                      : 'Atualize suas informações pessoais e senha de acesso.'}
                  </p>

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
                        className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700">E-mail</label>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </div>

                    <div className="pt-4 border-t border-slate-200">
                      <h4 className="text-sm font-medium text-slate-900 mb-4 flex items-center">
                        <Lock className="w-4 h-4 mr-1" />
                        {forcePasswordChange ? 'Alterar Senha (Obrigatório)' : 'Alterar Senha (Opcional)'}
                      </h4>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700">Senha Atual</label>
                          <SecurePasswordInput
                            name="currentPassword"
                            value={formData.currentPassword}
                            onChange={handleChange}
                            placeholder={forcePasswordChange ? 'Senha temporária da instalação' : 'Necessária apenas se for alterar a senha'}
                            enableGenerator={false}
                            required={forcePasswordChange}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-slate-700">Nova Senha</label>
                          <SecurePasswordInput
                            name="newPassword"
                            value={formData.newPassword}
                            onChange={handleChange}
                            placeholder="Mínimo de 12 caracteres"
                            required={forcePasswordChange}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-slate-700">Confirmar Nova Senha</label>
                          <SecurePasswordInput
                            name="confirmNewPassword"
                            value={formData.confirmNewPassword}
                            onChange={handleChange}
                            placeholder="Repita a nova senha"
                            enableGenerator={false}
                            required={forcePasswordChange}
                          />
                        </div>
                      </div>
                    </div>

                    {!forcePasswordChange && (
                      <div className="pt-4 border-t border-slate-200 space-y-3">
                        <h4 className="text-sm font-medium text-slate-900 flex items-center"><ShieldCheck className="w-4 h-4 mr-1" />Autenticação em dois fatores</h4>
                        <p className="text-sm text-slate-600">
                          Status: <span className="font-medium">{mfaStatus?.mfa_enabled ? 'Habilitada' : 'Não configurada'}</span>
                          {mfaStatus?.mfa_required ? ' — obrigatória pela política' : ''}
                        </p>
                        {!mfaStatus?.mfa_enabled && !mfaSetup && (
                          <button type="button" onClick={startMfaSetup} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Configurar aplicativo autenticador</button>
                        )}
                        {mfaSetup && (
                          <div className="space-y-3 rounded-md bg-slate-50 p-3">
                            <img src={mfaSetup.qr_code_data_url} alt="QR Code MFA" className="mx-auto h-44 w-44" />
                            <input type="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="Código de 6 dígitos" className="block w-full border border-slate-300 rounded-md py-2 px-3 text-sm" />
                            <button type="button" onClick={confirmMfaSetup} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Confirmar e habilitar MFA</button>
                          </div>
                        )}
                        {mfaStatus?.mfa_enabled && (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-500">Códigos de recuperação disponíveis: {mfaStatus.recovery_codes_remaining ?? 0}</p>
                            <input type="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="Código atual do autenticador" className="block w-full border border-slate-300 rounded-md py-2 px-3 text-sm" />
                            <button type="button" onClick={regenerateRecoveryCodes} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Regenerar códigos de recuperação</button>
                          </div>
                        )}
                        {recoveryCodes.length > 0 && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-medium text-amber-900">Guarde agora; estes códigos não serão exibidos novamente.</p>
                            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">{recoveryCodes.map((code) => <span key={code}>{code}</span>)}</div>
                          </div>
                        )}
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
              className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
              ) : 'Salvar Alterações'}
            </button>
            {!forcePasswordChange && (
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
