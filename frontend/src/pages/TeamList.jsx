import { useState, useEffect } from 'react';
import { Users, Plus, Shield, Mail, X, Loader2, FolderKey } from 'lucide-react';
import SecurePasswordInput from '../components/SecurePasswordInput';
import GroupModal from '../components/GroupModal';
import api from '../services/api';

const defaultNewUser = {
  name: '',
  email: '',
  password: '',
  role: 'user',
  groupIds: []
};

const defaultEditUser = {
  id: '',
  name: '',
  email: '',
  role: 'user',
  is_active: true,
  password: '',
  groupIds: []
};

const permissionLabels = [
  { key: 'can_view', label: 'Visualizar' },
  { key: 'can_edit', label: 'Editar' },
  { key: 'can_add', label: 'Adicionar' },
  { key: 'can_delete', label: 'Excluir' }
];

const getPermissionSummary = (group = {}) => {
  const permissions = permissionLabels
    .filter((permission) => Boolean(group[permission.key]))
    .map((permission) => permission.label);

  return permissions.length ? permissions.join(', ') : 'Sem permissão';
};

function GroupMembershipSelector({ groups, selectedIds, onChange, disabled = false }) {
  const toggleGroup = (groupId) => {
    if (disabled) return;

    const nextIds = selectedIds.includes(groupId)
      ? selectedIds.filter((id) => id !== groupId)
      : [...selectedIds, groupId];

    onChange(nextIds);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">Grupos do usuário</label>
      <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-md p-3 bg-slate-50">
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-2">Nenhum grupo cadastrado.</p>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <label key={group.id} className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  className="h-4 w-4 mt-0.5 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                  checked={selectedIds.includes(group.id)}
                  onChange={() => toggleGroup(group.id)}
                />
                <span className="text-sm text-slate-700">
                  <span className="font-medium">{group.name}</span>
                  <span className="block text-xs text-slate-500">{getPermissionSummary(group)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeamList() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [newUser, setNewUser] = useState(defaultNewUser);
  const [editUser, setEditUser] = useState(defaultEditUser);
  const [activeTab, setActiveTab] = useState('users');
  const [groups, setGroups] = useState([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupToEdit, setGroupToEdit] = useState(null);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/users');
      setTeamMembers(response.data || []);
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
      alert('Não foi possível carregar a lista de usuários.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadGroups = async () => {
    setIsLoadingGroups(true);
    try {
      const response = await api.get('/groups');
      setGroups(response.data || []);
    } catch (error) {
      console.error('Erro ao carregar grupos:', error);
      alert('Não foi possível carregar a lista de grupos.');
    } finally {
      setIsLoadingGroups(false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadGroups();
  }, []);

  const openCreateUserModal = () => {
    setNewUser(defaultNewUser);
    setIsModalOpen(true);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.post('/users', newUser);
      alert('Usuário criado com sucesso!');
      setIsModalOpen(false);
      setNewUser(defaultNewUser);
      await loadUsers();
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
      const payload = {
        name: editUser.name,
        email: editUser.email,
        role: editUser.role,
        is_active: editUser.is_active,
        groupIds: editUser.groupIds
      };

      if (editUser.password && editUser.password.trim() !== '') {
        payload.password = editUser.password;
      }

      await api.put(`/users/${editUser.id}`, payload);
      alert('Usuário atualizado com sucesso!' + (payload.password ? ' A nova senha foi aplicada e as chaves criptográficas foram redefinidas.' : ''));
      setIsEditModalOpen(false);
      setEditUser(defaultEditUser);
      await loadUsers();
    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      alert(error.response?.data?.error || 'Erro ao atualizar usuário.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (userId, currentStatus) => {
    if (!window.confirm(`Deseja realmente ${currentStatus ? 'inativar' : 'ativar'} este usuário?`)) return;

    try {
      await api.put(`/users/${userId}`, { is_active: !currentStatus });
      await loadUsers();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      alert(error.response?.data?.error || 'Erro ao alterar status do usuário.');
    }
  };

  const openEditModal = (member) => {
    setEditUser({
      id: member.id,
      name: member.name,
      email: member.email || '',
      role: member.role,
      is_active: member.is_active !== undefined ? member.is_active : true,
      password: '',
      groupIds: Array.isArray(member.groups) ? member.groups.map((group) => group.id) : []
    });
    setIsEditModalOpen(true);
  };

  const openGroupModal = (group = null) => {
    setGroupToEdit(group);
    setIsGroupModalOpen(true);
  };

  const handleGroupSaveSuccess = async () => {
    setIsGroupModalOpen(false);
    await loadGroups();
    await loadUsers();
  };

  const handleDeleteGroup = async (groupId, groupName) => {
    if (!window.confirm(`Deseja realmente excluir o grupo "${groupName}"?`)) return;

    try {
      await api.delete(`/groups/${groupId}`);
      await loadGroups();
      await loadUsers();
    } catch (error) {
      console.error('Erro ao excluir grupo:', error);
      alert(error.response?.data?.error || 'Erro ao excluir grupo.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestão de Equipe</h1>
          <p className="text-sm text-slate-500">Gerencie usuários, grupos e permissões herdadas nos cofres compartilhados</p>
        </div>
        <button
          onClick={() => activeTab === 'users' ? openCreateUserModal() : openGroupModal()}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          {activeTab === 'users' ? 'Novo Membro' : 'Novo Grupo'}
        </button>
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('users')}
            className={`${activeTab === 'users' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Users className="w-4 h-4 mr-2" /> Usuários
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`${activeTab === 'groups' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <FolderKey className="w-4 h-4 mr-2" /> Grupos
          </button>
        </nav>
      </div>

      {activeTab === 'users' && (
        <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Usuário</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Nível</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Grupos</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="relative px-6 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {isLoading ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-center text-sm text-slate-500">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600" /> Carregando usuários...
                    </td>
                  </tr>
                ) : teamMembers.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-center text-sm text-slate-500">Nenhum usuário encontrado.</td>
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
                          <div className="text-sm text-slate-500 flex items-center"><Mail className="w-3 h-3 mr-1" />{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Shield className={`w-4 h-4 mr-1.5 ${member.role === 'admin' ? 'text-amber-500' : 'text-slate-400'}`} />
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${member.role === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'}`}>
                          {member.is_super_admin ? 'Super Admin' : member.role === 'admin' ? 'Administrador' : 'Usuário Padrão'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {member.groups?.length ? member.groups.map((group) => (
                          <span key={group.id} className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">{group.name}</span>
                        )) : <span className="text-xs text-slate-400">Sem grupo</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${member.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {member.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {!member.is_super_admin ? (
                        <div className="flex justify-end space-x-3">
                          <button onClick={() => openEditModal(member)} className="text-indigo-600 hover:text-indigo-900">Editar</button>
                          <button onClick={() => handleToggleStatus(member.id, member.is_active)} className={`${member.is_active ? 'text-red-600 hover:text-red-900' : 'text-green-600 hover:text-green-900'}`}>
                            {member.is_active ? 'Inativar' : 'Ativar'}
                          </button>
                        </div>
                      ) : <span className="text-slate-400 text-xs italic">Super Admin</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'groups' && (
        <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Nome do Grupo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Descrição</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Permissões</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Membros</th>
                  <th className="relative px-6 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {isLoadingGroups ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-center text-sm text-slate-500">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600" /> Carregando grupos...
                    </td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr><td colSpan="5" className="px-6 py-4 text-center text-sm text-slate-500">Nenhum grupo encontrado.</td></tr>
                ) : groups.map((group) => (
                  <tr key={group.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                          <FolderKey className="h-5 w-5 text-indigo-600" />
                        </div>
                        <div className="ml-4"><div className="text-sm font-medium text-slate-900">{group.name}</div></div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><div className="text-sm text-slate-500">{group.description || '-'}</div></td>
                    <td className="px-6 py-4"><div className="text-sm text-slate-500">{getPermissionSummary(group)}</div></td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">{group.users?.length || 0} membros</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-3">
                        <button onClick={() => openGroupModal(group)} className="text-indigo-600 hover:text-indigo-900">Editar</button>
                        {group.name !== 'Administradores' && (
                          <button onClick={() => handleDeleteGroup(group.id, group.name)} className="text-red-600 hover:text-red-900">Excluir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <GroupModal isOpen={isGroupModalOpen} onClose={() => setIsGroupModalOpen(false)} groupToEdit={groupToEdit} onSaveSuccess={handleGroupSaveSuccess} />

      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsEditModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-lg leading-6 font-medium text-slate-900">Editar Usuário</h3>
                  <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-500"><X className="h-6 w-6" /></button>
                </div>
                <form id="editUserForm" onSubmit={handleEditUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                    <input type="text" required className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editUser.name} onChange={e => setEditUser({...editUser, name: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                    <input type="email" required className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editUser.email} onChange={e => setEditUser({...editUser, email: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nova Senha <span className="text-slate-400 font-normal">(deixe em branco para não alterar)</span></label>
                    <SecurePasswordInput value={editUser.password} onChange={e => setEditUser({...editUser, password: e.target.value})} placeholder="Nova senha (opcional)" />
                    {editUser.password && editUser.password.trim() !== '' && <p className="mt-1 text-xs text-amber-600">Ao alterar a senha, as chaves criptográficas do usuário serão redefinidas.</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nível de Acesso</label>
                    <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={editUser.role} onChange={e => setEditUser({...editUser, role: e.target.value})}>
                      <option value="user">Usuário Padrão</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  <GroupMembershipSelector groups={groups} selectedIds={editUser.groupIds} onChange={(groupIds) => setEditUser({ ...editUser, groupIds })} />
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-md">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Status da Conta</p>
                      <p className="text-xs text-slate-500">{editUser.is_active ? 'Conta ativa — usuário pode fazer login' : 'Conta inativa — login bloqueado'}</p>
                    </div>
                    <button type="button" onClick={() => setEditUser({...editUser, is_active: !editUser.is_active})} className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent ${editUser.is_active ? 'bg-green-500' : 'bg-slate-300'}`}>
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ${editUser.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </form>
              </div>
              <ModalFooter isSaving={isSaving} formId="editUserForm" submitLabel="Salvar Alterações" onCancel={() => setIsEditModalOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-lg leading-6 font-medium text-slate-900">Cadastrar Novo Membro</h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-500"><X className="h-6 w-6" /></button>
                </div>
                <form id="newUserForm" onSubmit={handleCreateUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                    <input type="text" required className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} placeholder="Ex: João Silva" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                    <input type="email" required className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} placeholder="joao@empresa.com.br" />
                  </div>
                  <div>
                    <SecurePasswordInput name="user_password" label="Senha de Acesso" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
                    <p className="mt-1 text-xs text-slate-500">Esta senha será usada para login e para derivar a chave de criptografia do usuário.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nível de Acesso</label>
                    <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
                      <option value="user">Usuário Padrão</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  <GroupMembershipSelector groups={groups} selectedIds={newUser.groupIds} onChange={(groupIds) => setNewUser({ ...newUser, groupIds })} />
                </form>
              </div>
              <ModalFooter isSaving={isSaving} formId="newUserForm" submitLabel="Salvar Usuário" onCancel={() => setIsModalOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalFooter({ isSaving, formId, submitLabel, onCancel }) {
  return (
    <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
      <button type="submit" form={formId} disabled={isSaving} className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 sm:ml-3 sm:w-auto sm:text-sm ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}>
        {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : submitLabel}
      </button>
      <button type="button" onClick={onCancel} className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
        Cancelar
      </button>
    </div>
  );
}
