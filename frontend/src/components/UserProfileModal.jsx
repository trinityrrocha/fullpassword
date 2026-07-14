import { useState, useEffect } from 'react';
import { User, Lock, Loader2 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { deriveMasterKey, unwrapMasterKey, wrapMasterKey } from '../services/cryptoService';
import SecurePasswordInput from './SecurePasswordInput';

export default function UserProfileModal({ isOpen, onClose }) {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
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

      // Se o usuário quer alterar a senha, precisamos fazer o re-envelope criptográfico
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

        // 1. Obter o wrapped_key e salt atuais do localStorage (ou do context)
        const currentWrappedKey = localStorage.getItem('user_wrapped_key');
        const currentSalt = localStorage.getItem('user_salt');

        if (!currentWrappedKey || !currentSalt) {
          throw new Error('Chaves criptográficas não encontradas. Faça login novamente.');
        }

        // 2. Derivar a KEK atual usando a senha atual
        const currentKek = await deriveMasterKey(formData.currentPassword, currentSalt);

        // 3. Desenvelopar a Master Key
        let masterKey;
        try {
          masterKey = await unwrapMasterKey(currentWrappedKey, currentKek);
        } catch (err) {
          throw new Error('Senha atual incorreta. Não foi possível acessar a chave mestra.', { cause: err });
        }

        // 4. Derivar a NOVA KEK usando a NOVA senha e o mesmo salt
        // (Opcionalmente, poderíamos gerar um novo salt aqui e mandar pro backend,
        // mas para simplificar vamos reutilizar o salt atual).
        const newKek = await deriveMasterKey(formData.newPassword, currentSalt);

        // 5. Re-envelopar a Master Key com a NOVA KEK
        const newWrappedKey = await wrapMasterKey(masterKey, newKek);

        // 6. Adicionar ao payload
        payload.new_password = formData.newPassword;
        payload.wrapped_key = newWrappedKey;
      }

      // Enviar para o backend
      await api.put('/users/profile', payload);

      // Se a senha foi alterada, precisamos atualizar o localStorage
      if (payload.wrapped_key) {
        localStorage.setItem('user_wrapped_key', payload.wrapped_key);
        // Opcional: forçar um re-login silencioso ou pedir pro usuário logar de novo
        // Aqui vamos apenas atualizar o context e avisar
      }

      setSuccess('Perfil atualizado com sucesso!');
      
      // Limpar campos de senha
      setFormData(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      }));

      // Atualiza os dados no context (opcional, dependendo de como o AuthContext foi implementado)
      // O ideal seria um fetch /me, mas podemos recarregar a página após 2s
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (err) {
      console.error('Erro ao atualizar perfil:', err);
      setError(err.message || err.response?.data?.error || 'Erro ao atualizar perfil.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-slate-900 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={onClose}></div>

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 sm:mx-0 sm:h-10 sm:w-10">
                <User className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                  Meu Perfil
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-slate-500 mb-4">
                    Atualize suas informações pessoais e senha de acesso.
                  </p>

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
                        Alterar Senha (Opcional)
                      </h4>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700">Senha Atual</label>
                          <SecurePasswordInput
                            name="currentPassword"
                            value={formData.currentPassword}
                            onChange={handleChange}
                            placeholder="Necessária apenas se for alterar a senha"
                            enableGenerator={false}
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-slate-700">Nova Senha</label>
                          <SecurePasswordInput
                            name="newPassword"
                            value={formData.newPassword}
                            onChange={handleChange}
                            placeholder="Mínimo de 12 caracteres"
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
                          />
                        </div>
                      </div>
                    </div>
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
            <button 
              type="button" 
              onClick={onClose}
              disabled={isSaving}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
