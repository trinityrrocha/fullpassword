import { useState, useEffect } from 'react';
import { Users, Plus, Shield, Mail, X, Loader2 } from 'lucide-react';
import SecurePasswordInput from '../components/SecurePasswordInput';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function TeamList() {
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user'
  });
  const [editUser, setEditUser] = useState({
    id: '',
    name: '',
    role: 'user'
  });

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/users');
      setTeamMembers(response.data);
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
      alert('Não foi possível carregar a lista de usuários.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.post('/users', newUser);
      alert('Usuário criado com sucesso!');
      setIsModalOpen(false);
      setNewUser({ name: '', email: '', password: '', role: 'user' });
      loadUsers(); // Recarrega a lista
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      alert(error.response?.data?.error || 'Erro ao criar usuário. Verifique se o e-mail já existe.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.put(`/users/${editUser.id}`, {
        name: editUser.name,
        role: editUser.role
      });
      alert('Usuário atualizado com sucesso!');
      setIsEditModalOpen(false);
      loadUsers();
    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      alert(error.response?.data?.error || 'Erro ao atualizar usuário.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (userId, currentStatus) => {
    if (!window.confirm(`Deseja realmente ${currentStatus ? 'inativar' : 'ativar'} este usuário?`)) {
      return;
    }
    try {
      await api.put(`/users/${userId}`, {
        is_active: !currentStatus
      });
      loadUsers();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      alert(error.response?.data?.error || 'Erro ao alterar status do usuário.');
    }
  };

  const openEditModal = (member) => {
    setEditUser({
      id: member.id,
      name: member.name,
      role: member.role
    });
    setIsEditModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestão de Equipe</h1>
          <p className="text-sm text-slate-500">Gerencie os usuários e permissões de acesso ao sistema</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Membro
        </button>
      </div>

      {/* Tabela de Usuários */}
      <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Usuário
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Nível de Acesso
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan="4" className="px-6 py-4 text-center text-sm text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600" />
                    Carregando usuários...
                  </td>
                </tr>
              ) : teamMembers.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-6 py-4 text-center text-sm text-slate-500">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : teamMembers.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                        <Users className="h-5 w-5 text-indigo-600" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-slate-900">{member.name}</div>
                        <div className="text-sm text-slate-500 flex items-center">
                          <Mail className="w-3 h-3 mr-1" />
                          {member.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Shield className={`w-4 h-4 mr-1.5 ${member.role === 'admin' ? 'text-amber-500' : 'text-slate-400'}`} />
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        member.role === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'
                      }`}>
                        {member.role === 'admin' ? 'Administrador' : 'Usuário Padrão'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${member.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {member.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {member.email !== 'admin@admin.com.br' ? (
                      <div className="flex justify-end space-x-3">
                        <button 
                          onClick={() => openEditModal(member)}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          Editar
                        </button>
                        <button 
                          onClick={() => handleToggleStatus(member.id, member.is_active)}
                          className={`${member.is_active ? 'text-red-600 hover:text-red-900' : 'text-green-600 hover:text-green-900'}`}
                        >
                          {member.is_active ? 'Inativar' : 'Ativar'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs italic">Super Admin (Imutável)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Editar Usuário */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsEditModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                    Editar Usuário
                  </h3>
                  <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-500">
                    <X className="h-6 w-6" />
                  </button>
                </div>
                
                <form id="editUserForm" onSubmit={handleEditUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                    <input 
                      type="text" 
                      required
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={editUser.name}
                      onChange={e => setEditUser({...editUser, name: e.target.value})}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nível de Acesso</label>
                    <select 
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      value={editUser.role}
                      onChange={e => setEditUser({...editUser, role: e.target.value})}
                    >
                      <option value="user">Usuário Padrão</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </form>
              </div>
              <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button 
                  type="submit" 
                  form="editUserForm"
                  disabled={isSaving}
                  className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
                  ) : 'Salvar Alterações'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsEditModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Novo Usuário */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            
            {/* Background overlay */}
            <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsModalOpen(false)}></div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            {/* Modal panel */}
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                    Cadastrar Novo Membro
                  </h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-500">
                    <X className="h-6 w-6" />
                  </button>
                </div>
                
                <form id="newUserForm" onSubmit={handleCreateUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                    <input 
                      type="text" 
                      required
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={newUser.name}
                      onChange={e => setNewUser({...newUser, name: e.target.value})}
                      placeholder="Ex: João Silva"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                    <input 
                      type="email" 
                      required
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={newUser.email}
                      onChange={e => setNewUser({...newUser, email: e.target.value})}
                      placeholder="joao@empresa.com.br"
                    />
                  </div>

                  <div>
                    <SecurePasswordInput 
                      name="user_password" 
                      label="Senha de Acesso" 
                      value={newUser.password}
                      onChange={e => setNewUser({...newUser, password: e.target.value})}
                      required
                    />
                    <p className="mt-1 text-xs text-slate-500">Esta senha será usada para login e para derivar a chave de criptografia do usuário.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nível de Acesso</label>
                    <select 
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      value={newUser.role}
                      onChange={e => setNewUser({...newUser, role: e.target.value})}
                    >
                      <option value="user">Usuário Padrão</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </form>
              </div>
                  <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button 
                  type="submit" 
                  form="newUserForm"
                  disabled={isSaving}
                  className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
                  ) : 'Salvar Usuário'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
