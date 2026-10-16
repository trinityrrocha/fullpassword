import { useState, useEffect, useRef, useId } from 'react';
import { Users, Plus, Shield, Star, UserRound, Loader2, FolderKey, Trash2, ChevronDown } from 'lucide-react';
import SecurePasswordInput from '../components/SecurePasswordInput';
import FormDialog from '../components/FormDialog';
import GroupModal from '../components/GroupModal';
import api from '../services/api';
import { safeLogError } from '../utils/safeLogger';
import { useAuth } from '../context/AuthContext';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import usePasswordPolicy from '../hooks/usePasswordPolicy';

const defaultNewUser = {
  name: '',
  email: '',
  password: '',
  role: 'user',
  groupIds: [],
  mfa_required: false
};

const defaultEditUser = {
  id: '',
  name: '',
  email: '',
  role: 'user',
  is_active: true,
  groupIds: [],
  mfa_required: false,
  mfa_enabled: false,
  is_super_admin: false
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
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef(null);
  const groupId = useId();
  const safeSelectedIds = Array.isArray(selectedIds) ? selectedIds : [];
  const selectedGroups = groups.filter((group) => safeSelectedIds.includes(group.id));
  const selectionLabel = selectedGroups.length === 0
    ? 'Selecione os grupos'
    : selectedGroups.length <= 2
      ? selectedGroups.map((group) => group.name).join(', ')
      : `${selectedGroups.length} grupos selecionados`;

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleOutsideClick = (event) => {
      if (!selectorRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {event.preventDefault();event.stopImmediatePropagation();setIsOpen(false);selectorRef.current?.querySelector('button')?.focus();}
    };

    // Collapse after the click, never between pointer-down and pointer-up:
    // shrinking the dialog before click would move its persistent actions.
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleEscape, true);

    return () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [isOpen]);

  const toggleGroup = (groupId) => {
    if (disabled) return;

    const nextIds = safeSelectedIds.includes(groupId)
      ? safeSelectedIds.filter((id) => id !== groupId)
      : [...safeSelectedIds, groupId];

    onChange(nextIds);
  };

  return (
    <div ref={selectorRef} className="relative">
      <span id={groupId+'-label'} className="mb-1 block text-sm font-medium text-slate-700">Grupos do usuário</span>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-controls={groupId}
        aria-label="Selecionar grupos do usuário"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2 text-left text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`truncate ${selectedGroups.length ? 'text-slate-700' : 'text-slate-500'}`}>{selectionLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {isOpen && (
        <div id={groupId} role="group" aria-labelledby={groupId+'-label'} className="relative mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {groups.length === 0 ? (
            <p className="px-2 py-2 text-center text-sm text-slate-500">Nenhum grupo cadastrado.</p>
          ) : groups.map((group) => (
            <label key={group.id} className={`flex items-start gap-2 rounded px-2 py-1.5 hover:bg-slate-50 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                disabled={disabled}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={safeSelectedIds.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
              />
              <span className="min-w-0 text-sm text-slate-700">
                <span className="block truncate font-medium">{group.name}</span>
                <span className="block truncate text-xs text-slate-500">{getPermissionSummary(group)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TeamList() {
  const {policy:passwordPolicy}=usePasswordPolicy();
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [formError,setFormError] = useState('');
  const [notice,setNotice] = useState('');
  const [confirmation,setConfirmation] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [newUser, setNewUser] = useState(defaultNewUser);
  const [editUser, setEditUser] = useState(defaultEditUser);
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [activeTab, setActiveTab] = useState('users');
  const [groups, setGroups] = useState([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupToEdit, setGroupToEdit] = useState(null);

  useClearOnVaultLock(() => {
    setConfirmation(null);
    setIsModalOpen(false);
    setIsEditModalOpen(false);
    setNewUser(defaultNewUser);
    setEditUser(defaultEditUser);
    setDeleteUserConfirmation('');
    setIsGroupModalOpen(false);
    setGroupToEdit(null);
    setIsSaving(false);
  });

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/users');
      setTeamMembers(response.data || []);
    } catch (error) {
      safeLogError('Erro ao carregar usuários.', error);
      setFormError('Não foi possível carregar a lista de usuários.');
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
      safeLogError('Erro ao carregar grupos.', error);
      setFormError('Não foi possível carregar a lista de grupos.');
    } finally {
      setIsLoadingGroups(false);
    }
  };

  useEffect(() => {
    // A hidratação inicial depende de duas consultas externas após o mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
    loadGroups();
  }, []);

  const openCreateUserModal = () => {
    setFormError('');setNotice('');setNewUser(defaultNewUser);
    setIsModalOpen(true);
  };

  const closeCreateUserModal = () => {
    setIsModalOpen(false);
    setNewUser(defaultNewUser);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if(savingRef.current || isSaving)return;
    setFormError('');
    if(!passwordPolicy||newUser.password.length<passwordPolicy.login_min_length){setFormError(passwordPolicy?`A senha deve ter ao menos ${passwordPolicy.login_min_length} caracteres.`:'Aguarde o carregamento da política de senhas.');return;}
    if(!e.currentTarget.checkValidity()){setFormError('Preencha nome e e-mail válidos e os campos obrigatórios.');e.currentTarget.querySelector(':invalid')?.focus();return;}
    savingRef.current=true;setIsSaving(true);
    try {
      const payload = user?.is_super_admin ? newUser : { ...newUser, mfa_required: undefined };
      await api.post('/users', payload);
      setNotice('Usuário criado com sucesso!');
      setIsModalOpen(false);
      setNewUser(defaultNewUser);
      await loadUsers();
    } catch (error) {
      safeLogError('Erro ao criar usuário.', error);
      setFormError(error.response?.data?.error || 'Erro ao criar usuário. Verifique se o e-mail já existe.');
    } finally {
      savingRef.current=false;
      setIsSaving(false);
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    if(savingRef.current || isSaving)return;
    setFormError('');
    if(!e.currentTarget.checkValidity()){setFormError('Preencha nome e e-mail válidos e os campos obrigatórios.');e.currentTarget.querySelector(':invalid')?.focus();return;}
    savingRef.current=true;setIsSaving(true);
    try {
      const payload = {
        name: editUser.name,
        email: editUser.email,
        role: editUser.role,
        is_active: editUser.is_active,
        groupIds: editUser.groupIds
      };

      if (user?.is_super_admin) payload.mfa_required = editUser.mfa_required;

      await api.put(`/users/${editUser.id}`, payload);
      setNotice('Usuário atualizado com sucesso!');
      setIsEditModalOpen(false);
      setEditUser(defaultEditUser);
      setDeleteUserConfirmation('');
      await loadUsers();
    } catch (error) {
      safeLogError('Erro ao atualizar usuário.', error);
      setFormError(error.response?.data?.error || 'Erro ao atualizar usuário.');
    } finally {
      savingRef.current=false;
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (userId, currentStatus, confirmed = false) => {
    if (confirmed !== true) {setConfirmation({text:`Deseja realmente ${currentStatus ? 'inativar' : 'ativar'} este usuário?`,run:()=>handleToggleStatus(userId,currentStatus,true)});return;}
    setConfirmation(null);

    try {
      await api.put(`/users/${userId}`, { is_active: !currentStatus });
      await loadUsers();
    } catch (error) {
      safeLogError('Erro ao alterar status.', error);
      setFormError(error.response?.data?.error || 'Erro ao alterar status do usuário.');
    }
  };

  const handleDeleteUser = async () => {
    if (!editUser.id || deleteUserConfirmation.trim() !== 'EXCLUIR') return;

    setIsSaving(true);
    try {
      await api.delete(`/users/${editUser.id}`, {
        data: { confirmation: deleteUserConfirmation.trim() }
      });
      setIsEditModalOpen(false);
      setEditUser(defaultEditUser);
      setDeleteUserConfirmation('');
      await loadUsers();
    } catch (error) {
      setFormError(error.response?.data?.error || 'Erro ao excluir usuário.');
    } finally {
      setIsSaving(false);
    }
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditUser(defaultEditUser);
    setDeleteUserConfirmation('');
  };

  const handleResetMfa = async (confirmed = false) => {
    if (confirmed !== true) {setConfirmation({text:'Resetar o MFA deste usuário e revogar todas as sessões atuais?',run:()=>handleResetMfa(true)});return;}
    setConfirmation(null);
    setIsSaving(true);
    try {
      await api.post(`/users/${editUser.id}/mfa-reset`);
      setNotice('MFA resetado. O usuário deverá configurá-lo novamente se a política continuar obrigatória.');
      setEditUser((current) => ({ ...current, mfa_enabled: false }));
      await loadUsers();
    } catch (error) {
      setFormError(error.response?.data?.error || 'Erro ao resetar MFA.');
    } finally {
      setIsSaving(false);
    }
  };

  const openEditModal = (member) => {
    setFormError('');setNotice('');
    setEditUser({
      id: member.id,
      name: member.name,
      email: member.email || '',
      role: member.role,
      is_active: member.is_active !== undefined ? member.is_active : true,
      groupIds: Array.isArray(member.groups) ? member.groups.map((group) => group.id) : [],
      mfa_required: member.mfa_required === true,
      mfa_enabled: member.mfa_enabled === true,
      is_super_admin: member.is_super_admin === true
    });
    setDeleteUserConfirmation('');
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

  const handleDeleteGroup = async (groupId, groupName, confirmed = false) => {
    if (confirmed !== true) {setConfirmation({text:`Deseja realmente excluir o grupo "${groupName}"?`,run:()=>handleDeleteGroup(groupId,groupName,true)});return;}
    setConfirmation(null);

    try {
      await api.delete(`/groups/${groupId}`);
      await loadGroups();
      await loadUsers();
    } catch (error) {
      safeLogError('Erro ao excluir grupo.', error);
      setFormError(error.response?.data?.error || 'Erro ao excluir grupo.');
    }
  };

  return (
    <div className="space-y-6">
      {formError && !isModalOpen && !isEditModalOpen && <p role="alert" className="text-sm text-red-600">{formError}</p>}
      {notice && <p role="status" className="text-sm text-green-700 dark:text-green-300">{notice}</p>}
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
                  <th className="h-10 px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Usuário</th>
                  <th className="h-10 w-16 px-3 py-1 text-center text-xs font-medium uppercase tracking-wider text-slate-500">Nível</th>
                  <th className="h-10 px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Grupos</th>
                  <th className="h-10 px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                  <th className="relative h-10 px-3 py-1"><span className="sr-only">Ações</span></th>
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
                  <tr key={member.id} className="h-10 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100">
                          <Users className="h-4 w-4 text-indigo-600" />
                        </div>
                        <div className="min-w-0 leading-tight">
                          <div className="truncate text-sm font-medium leading-tight text-slate-900">{member.name}</div>
                          <div className="truncate text-xs leading-tight text-slate-500">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="w-16 whitespace-nowrap px-3 py-1 text-center">
                      <div className="flex justify-center">
                        {member.is_super_admin ? (
                          <span title="Super Admin" aria-label="Super Admin" role="img"><Star className="h-4 w-4 text-red-600" /></span>
                        ) : member.role === 'admin' ? (
                          <span title="Admin" aria-label="Admin" role="img"><Shield className="h-4 w-4 text-amber-500" /></span>
                        ) : (
                          <span title="Usuário Padrão" aria-label="Usuário Padrão" role="img"><UserRound className="h-4 w-4 text-indigo-500" /></span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1">
                      <div className="flex flex-wrap gap-1">
                        {member.groups?.length ? member.groups.map((group) => (
                          <span key={group.id} className="truncate rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs font-medium leading-none text-indigo-700">{group.name}</span>
                        )) : <span className="text-xs text-slate-400">Sem grupo</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold leading-none ${member.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {member.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1 text-right text-xs font-medium">
                      {!member.is_super_admin ? (
                        <div className="flex justify-end gap-2">
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
                  <th className="h-10 px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Nome do Grupo</th>
                  <th className="h-10 px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Descrição</th>
                  <th className="h-10 px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Permissões</th>
                  <th className="h-10 px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Membros</th>
                  <th className="relative h-10 px-3 py-1"><span className="sr-only">Ações</span></th>
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
                  <tr key={group.id} className="h-10 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                          <FolderKey className="h-4 w-4 text-indigo-600" />
                        </div>
                        <div className="min-w-0"><div className="truncate text-sm font-medium leading-tight text-slate-900">{group.name}</div></div>
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-1"><div className="truncate text-xs leading-tight text-slate-500" title={group.description || '-'}>{group.description || '-'}</div></td>
                    <td className="max-w-xs px-3 py-1"><div className="truncate text-xs leading-tight text-slate-500" title={getPermissionSummary(group)}>{getPermissionSummary(group)}</div></td>
                    <td className="whitespace-nowrap px-3 py-1">
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium leading-none text-slate-800">{group.users?.length || 0} membros</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1 text-right text-xs font-medium">
                      <div className="flex justify-end gap-2">
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

      {confirmation && <FormDialog title="Confirmar ação" description={confirmation.text} child guardChanges={false} onClose={()=>setConfirmation(null)} footer={<div className="flex justify-end gap-2"><button type="button" data-initial-focus data-dialog-cancel className="rounded border px-3 py-2 text-sm">Cancelar</button><button type="button" onClick={confirmation.run} className="rounded bg-red-600 px-3 py-2 text-sm text-white">Confirmar ação</button></div>}/>}
      {isEditModalOpen && (
        <FormDialog title="Editar Usuário" onClose={closeEditModal} busy={isSaving} footer={<ModalFooter
                isSaving={isSaving}
                formId="editUserForm"
                submitLabel="Salvar Alterações"
                onCancel={closeEditModal}
                showDelete={Boolean(user?.is_super_admin && !editUser.is_super_admin && editUser.id !== user.id)}
                deleteConfirmation={deleteUserConfirmation}
                onDeleteConfirmationChange={(event) => setDeleteUserConfirmation(event.target.value)}
                onDelete={handleDeleteUser}
              />}>
  <form id="editUserForm" onSubmit={handleEditUser} noValidate className="space-y-4">
          {formError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
    <div>
      <label htmlFor="editUserForm-1" className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
      <input id="editUserForm-1" type="text" required className="h-8 w-full rounded-md border border-slate-300 px-2 py-1 text-sm shadow-sm" value={editUser.name} onChange={e => setEditUser({...editUser, name: e.target.value})} />
    </div>
    <div>
      <label htmlFor="editUserForm-2" className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
      <input id="editUserForm-2" type="email" required className="h-8 w-full rounded-md border border-slate-300 px-2 py-1 text-sm shadow-sm" value={editUser.email} onChange={e => setEditUser({...editUser, email: e.target.value.toLowerCase()})} />
    </div>
    <p className="rounded-md border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-800">
      Para redefinir o acesso com segurança, o usuário deve usar “Esqueceu a senha?” na tela de login.
    </p>
    <div>
      <label htmlFor="editUserForm-3" className="block text-sm font-medium text-slate-700 mb-1">Nível de Acesso</label>
      <select id="editUserForm-3" className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm" value={editUser.role} onChange={e => setEditUser({...editUser, role: e.target.value})}>
        <option value="user">Usuário Padrão</option>
        <option value="admin">Administrador</option>
      </select>
    </div>
    <GroupMembershipSelector groups={groups} selectedIds={editUser.groupIds} onChange={(groupIds) => setEditUser({ ...editUser, groupIds })} />
    {user?.is_super_admin && (
      <div className="p-3 bg-indigo-50 rounded-md space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1 h-4 w-4 text-indigo-600 rounded border-slate-300" checked={editUser.mfa_required} onChange={(e) => setEditUser({ ...editUser, mfa_required: e.target.checked })} />
          <span><span className="block text-sm font-medium text-slate-700">Exigir MFA/2FA no próximo login</span><span className="block text-xs text-slate-500">Recomendado para administradores.</span></span>
        </label>
        {editUser.mfa_enabled && <button type="button" onClick={handleResetMfa} className="text-sm font-medium text-red-600 hover:text-red-800">Resetar MFA e revogar sessões</button>}
      </div>
    )}
    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-md">
      <div>
        <p className="text-sm font-medium text-slate-700">Status da Conta</p>
        <p className="text-xs text-slate-500">{editUser.is_active ? 'Conta ativa — usuário pode fazer login' : 'Conta inativa — login bloqueado'}</p>
      </div>
      <button type="button" role="switch" aria-label="Status da Conta" aria-checked={editUser.is_active} onClick={() => setEditUser({...editUser, is_active: !editUser.is_active})} className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent ${editUser.is_active ? 'bg-green-500' : 'bg-slate-300'}`}>
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ${editUser.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  </form>
        </FormDialog>
      )}

      {isModalOpen && (
        <FormDialog title="Cadastrar Novo Membro" onClose={closeCreateUserModal} busy={isSaving} footer={<ModalFooter isSaving={isSaving} formId="newUserForm" submitLabel="Salvar Usuário" onCancel={closeCreateUserModal} />}>
  <form id="newUserForm" onSubmit={handleCreateUser} noValidate className="space-y-4">
          {formError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
    <div>
      <label htmlFor="newUserForm-1" className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
      <input id="newUserForm-1" type="text" required className="h-8 w-full rounded-md border border-slate-300 px-2 py-1 text-sm shadow-sm" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} placeholder="Ex: João Silva" />
    </div>
    <div>
      <label htmlFor="newUserForm-2" className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
      <input id="newUserForm-2" type="email" required className="h-8 w-full rounded-md border border-slate-300 px-2 py-1 text-sm shadow-sm" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value.toLowerCase()})} placeholder="joao@empresa.com.br" />
    </div>
    <div>
      <SecurePasswordInput className="[&_input]:h-8 [&_input]:py-1 [&_input]:pl-2" name="user_password" label="Senha de Acesso" minLength={passwordPolicy?.login_min_length} placeholder={passwordPolicy?`Mínimo de ${passwordPolicy.login_min_length} caracteres`:'Carregando política…'} value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
      <p className="mt-1 text-xs text-slate-500">Senha inicial para acesso ao FullPassword. A senha dos cofres será criada separadamente pelo próprio usuário.</p>
    </div>
    <div>
      <label htmlFor="newUserForm-3" className="block text-sm font-medium text-slate-700 mb-1">Nível de Acesso</label>
      <select id="newUserForm-3" className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
        <option value="user">Usuário Padrão</option>
        <option value="admin">Administrador</option>
      </select>
    </div>
    <GroupMembershipSelector groups={groups} selectedIds={newUser.groupIds} onChange={(groupIds) => setNewUser({ ...newUser, groupIds })} />
    {user?.is_super_admin && (
      <label className="flex items-start gap-3 p-3 bg-indigo-50 rounded-md cursor-pointer">
        <input type="checkbox" className="mt-1 h-4 w-4 text-indigo-600 rounded border-slate-300" checked={newUser.mfa_required} onChange={(e) => setNewUser({ ...newUser, mfa_required: e.target.checked })} />
        <span><span className="block text-sm font-medium text-slate-700">Exigir MFA/2FA no próximo login</span><span className="block text-xs text-slate-500">Recomendado para administradores.</span></span>
      </label>
    )}
  </form>
        </FormDialog>
      )}
    </div>
  );
}

function ModalFooter({ isSaving, formId, submitLabel, onCancel, showDelete = false, deleteConfirmation = '', onDeleteConfirmationChange, onDelete }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showDelete && (
        <>
          <button type="button" title="Excluir usuário" aria-label="Excluir usuário" disabled={deleteConfirmation.trim() !== 'EXCLUIR' || isSaving} onClick={onDelete} className="action-icon-button action-icon-delete">
            <Trash2 className="h-4 w-4" />
          </button>
          <label htmlFor="deleteSystemUserConfirmation" className="sr-only">Digite EXCLUIR para confirmar a exclusão do usuário</label>
          <input id="deleteSystemUserConfirmation" value={deleteConfirmation} onChange={onDeleteConfirmationChange} placeholder="EXCLUIR" title="Digite EXCLUIR para confirmar a exclusão do usuário" autoComplete="off" className="h-9 w-28 rounded-md border border-red-300 bg-white px-2 text-sm" />
        </>
      )}
      <button type="button" data-dialog-cancel disabled={isSaving} onClick={onCancel} className="inline-flex justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
        Cancelar
      </button>
      <button type="submit" form={formId} disabled={isSaving} className={`inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 ${isSaving ? 'cursor-not-allowed opacity-70' : ''}`}>
        {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : submitLabel}
      </button>
    </div>
  );
}
