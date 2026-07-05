import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import api from '../services/api';

export default function GroupModal({ isOpen, onClose, groupToEdit, onSaveSuccess }) {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [users, setUsers] = useState([]);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    userIds: []
  });

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      if (groupToEdit) {
        setFormData({
          name: groupToEdit.name || '',
          description: groupToEdit.description || '',
          userIds: groupToEdit.users ? groupToEdit.users.map(u => u.id) : []
        });
      } else {
        setFormData({
          name: '',
          description: '',
          userIds: []
        });
      }
    }
  }, [isOpen, groupToEdit]);

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const response = await api.get('/users');
      // Filtrar apenas usuários ativos para seleção
      setUsers(response.data.filter(u => u.is_active));
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleCheckboxChange = (userId) => {
    setFormData(prev => {
      const newUserIds = prev.userIds.includes(userId)
        ? prev.userIds.filter(id => id !== userId)
        : [...prev.userIds, userId];
      return { ...prev, userIds: newUserIds };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (groupToEdit) {
        await api.put(`/groups/${groupToEdit.id}`, formData);
      } else {
        await api.post('/groups', formData);
      }
      onSaveSuccess();
    } catch (error) {
      console.error('Erro ao salvar grupo:', error);
      alert(error.response?.data?.error || 'Erro ao salvar grupo.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const isSystemGroup = groupToEdit?.name === 'Administradores';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={onClose}></div>
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                {groupToEdit ? 'Editar Grupo' : 'Novo Grupo'}
              </h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <form id="groupForm" onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Grupo</label>
                <input 
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Descrição (Opcional)</label>
                <input 
                  type="text" 
                  className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="Ex: Acesso básico aos clientes"
                />
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
          </div>
          <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button 
              type="submit" 
              form="groupForm"
              disabled={isSaving}
              className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
              ) : 'Salvar Grupo'}
            </button>
            <button 
              type="button" 
              onClick={onClose}
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
