import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import FormDialog from './FormDialog';
import api from '../services/api';
import { safeLogError } from '../utils/safeLogger';

const permissionFields = [
  { key: 'can_view', label: 'Visualizar' },
  { key: 'can_edit', label: 'Editar' },
  { key: 'can_add', label: 'Adicionar' },
  { key: 'can_delete', label: 'Excluir' }
];

const defaultPermissions = {
  can_view: true,
  can_edit: false,
  can_add: false,
  can_delete: false
};

export default function GroupModal({ isOpen, onClose, groupToEdit, onSaveSuccess }) {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [users, setUsers] = useState([]);
  const [formError, setFormError] = useState('');
  const savingRef = useRef(false);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    userIds: [],
    ...defaultPermissions
  });

  useEffect(() => {
    if (!isOpen) return;
    let current = true;
    const controller = new AbortController();
    const initialise = async () => {
      // Initialise after the effect subscribes; stale/closed loads never commit.
      await Promise.resolve();
      if (!current) return;
      setFormError('');
      if (groupToEdit) {
        setFormData({
          name: groupToEdit.name || '',
          description: groupToEdit.description || '',
          userIds: groupToEdit.users ? groupToEdit.users.map(u => u.id) : [],
          can_view: Boolean(groupToEdit.can_view ?? true),
          can_edit: Boolean(groupToEdit.can_edit ?? false),
          can_add: Boolean(groupToEdit.can_add ?? false),
          can_delete: Boolean(groupToEdit.can_delete ?? false)
        });
      } else {
        setFormData({
          name: '',
          description: '',
          userIds: [],
          ...defaultPermissions
        });
      }
      setIsLoadingUsers(true);
      try {
        const response = await api.get('/users', { signal: controller.signal });
        if (current) setUsers(response.data.filter(u => u.is_active));
      } catch (error) {
        if (current) safeLogError('Erro ao carregar usuários.', error);
      } finally {
        if (current) setIsLoadingUsers(false);
      }
    };
    void initialise();
    return () => { current = false; controller.abort(); };
  }, [isOpen, groupToEdit]);

  const handleCheckboxChange = (userId) => {
    setFormData(prev => {
      const newUserIds = prev.userIds.includes(userId)
        ? prev.userIds.filter(id => id !== userId)
        : [...prev.userIds, userId];
      return { ...prev, userIds: newUserIds };
    });
  };

  const handlePermissionChange = (field, checked) => {
    setFormData((current) => {
      const next = { ...current, [field]: checked };

      if (['can_edit', 'can_add', 'can_delete'].includes(field) && checked) {
        next.can_view = true;
      }

      if (field === 'can_view' && !checked) {
        next.can_edit = false;
        next.can_add = false;
        next.can_delete = false;
      }

      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    setFormError('');
    if (!e.currentTarget.checkValidity()) {
      setFormError('Preencha o nome do grupo.');
      e.currentTarget.querySelector(':invalid')?.focus();
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    try {
      if (groupToEdit) {
        await api.put(`/groups/${groupToEdit.id}`, formData);
      } else {
        await api.post('/groups', formData);
      }
      onSaveSuccess();
    } catch (error) {
      safeLogError('Erro ao salvar grupo.', error);
      setFormError(error.response?.data?.error || 'Não foi possível salvar o grupo. Tente novamente.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const isSystemGroup = groupToEdit?.name === 'Administradores';

  return (
    <FormDialog title={groupToEdit ? 'Editar Grupo' : 'Novo Grupo'} onClose={onClose} busy={isSaving} footer={
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" data-dialog-cancel disabled={isSaving} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed">Cancelar</button>
        <button type="submit" form="groupForm" disabled={isSaving} className="inline-flex min-w-32 items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-70">
          {isSaving ? <><Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : 'Salvar Grupo'}
        </button>
      </div>
    }>
            <form id="groupForm" noValidate onSubmit={handleSubmit} className="space-y-4">
              {formError && <p id="group-form-error" role="alert" className="text-sm text-red-600 dark:text-red-300">{formError}</p>}
              <div>
                <label htmlFor="group-name" className="block text-sm font-medium text-slate-700 mb-1">Nome do Grupo</label>
                <input 
                  id="group-name"
                  aria-invalid={formError && !formData.name ? true : undefined}
                  aria-describedby={formError ? 'group-form-error' : undefined}
                  type="text" 
                  required
                  disabled={isSystemGroup}
                  className={`w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 ${isSystemGroup ? 'bg-slate-100 cursor-not-allowed' : ''}`}
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="Ex: Nível 1"
                />
                {isSystemGroup && (
                  <p className="mt-1 text-xs text-slate-500">O nome deste grupo do sistema não pode ser alterado.</p>
                )}
              </div>
              
              <div>
                <label htmlFor="group-description" className="block text-sm font-medium text-slate-700 mb-1">Descrição (Opcional)</label>
                <input 
                  id="group-description"
                  type="text" 
                  className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Ex: Acesso básico aos clientes"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Permissões do Grupo nos cofres compartilhados</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  {permissionFields.map((permission) => (
                    <label key={permission.key} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                        checked={Boolean(formData[permission.key])}
                        disabled={isSystemGroup}
                        onChange={(e) => handlePermissionChange(permission.key, e.target.checked)}
                      />
                      {permission.label}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">Essas permissões serão herdadas por todos os cofres compartilhados com este grupo.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Membros do Grupo</label>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md p-3 bg-slate-50">
                  {isLoadingUsers ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                    </div>
                  ) : users.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-2">Nenhum usuário ativo encontrado.</p>
                  ) : (
                    <div className="space-y-2">
                      {users.map(user => (
                        <label key={user.id} className="flex items-center space-x-3 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                            checked={formData.userIds.includes(user.id)}
                            onChange={() => handleCheckboxChange(user.id)}
                          />
                          <span className="text-sm text-slate-700">{user.name} <span className="text-slate-400 text-xs">({user.email})</span></span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </form>
    </FormDialog>
  );
}
