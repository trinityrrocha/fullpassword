import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, Users, ShieldCheck } from 'lucide-react';
import api from '../services/api';

const emptyShare = () => ({
  group_id: '',
  can_view: true,
  can_edit: false,
  can_add: false,
  can_delete: false
});

const permissionLabels = [
  { key: 'can_view', label: 'Visualizar' },
  { key: 'can_edit', label: 'Editar' },
  { key: 'can_add', label: 'Adicionar' },
  { key: 'can_delete', label: 'Excluir' }
];

const normalizeShare = (share = {}) => ({
  group_id: share.group_id || share.groupId || '',
  group_name: share.group_name || share.groupName || '',
  can_view: Boolean(share.can_view ?? share.canView ?? true),
  can_edit: Boolean(share.can_edit ?? share.canEdit ?? false),
  can_add: Boolean(share.can_add ?? share.canAdd ?? false),
  can_delete: Boolean(share.can_delete ?? share.canDelete ?? false)
});

export default function VaultSharingManager({ clientId }) {
  const [groups, setGroups] = useState([]);
  const [shares, setShares] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const groupMap = useMemo(() => {
    const map = new Map();
    groups.forEach((group) => map.set(group.id, group));
    return map;
  }, [groups]);

  const loadSharingData = async () => {
    setIsLoading(true);
    setError('');

    try {
      const [groupsResponse, sharesResponse] = await Promise.all([
        api.get('/groups/options'),
        api.get(`/vault-items/${clientId}/shares`)
      ]);

      setGroups(groupsResponse.data || []);
      setShares((sharesResponse.data || []).map(normalizeShare));
    } catch (err) {
      console.error('Erro ao carregar compartilhamento do cofre:', err);
      setError(err.response?.data?.error || 'Você não tem permissão para gerenciar o compartilhamento deste cofre.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSharingData();
  }, [clientId]);

  const addShare = () => {
    setShares((current) => [emptyShare(), ...current]);
  };

  const updateShare = (index, field, value) => {
    setShares((current) => current.map((share, currentIndex) => {
      if (currentIndex !== index) return share;

      const nextShare = { ...share, [field]: value };

      if (['can_edit', 'can_add', 'can_delete'].includes(field) && value) {
        nextShare.can_view = true;
      }

      if (field === 'can_view' && value === false) {
        nextShare.can_edit = false;
        nextShare.can_add = false;
        nextShare.can_delete = false;
      }

      return nextShare;
    }));
  };

  const removeShare = (index) => {
    setShares((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const selectedGroupIds = shares.map((share) => share.group_id).filter(Boolean);

  const saveShares = async () => {
    const cleanedShares = shares
      .filter((share) => share.group_id && share.can_view)
      .map((share) => ({
        group_id: share.group_id,
        can_view: Boolean(share.can_view),
        can_edit: Boolean(share.can_edit),
        can_add: Boolean(share.can_add),
        can_delete: Boolean(share.can_delete)
      }));

    const uniqueGroupIds = new Set(cleanedShares.map((share) => share.group_id));
    if (uniqueGroupIds.size !== cleanedShares.length) {
      alert('Existe grupo duplicado no compartilhamento. Remova a duplicidade antes de salvar.');
      return;
    }

    setIsSaving(true);
    try {
      await api.put(`/vault-items/${clientId}/shares`, { shares: cleanedShares });
      alert('Compartilhamento do cofre atualizado com sucesso.');
      await loadSharingData();
    } catch (err) {
      console.error('Erro ao salvar compartilhamento:', err);
      alert(err.response?.data?.error || 'Erro ao salvar compartilhamento do cofre.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-slate-500">Carregando compartilhamento do cofre...</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h3 className="text-lg font-medium text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-500" /> Compartilhamento do Cofre
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Defina quais grupos podem visualizar, editar, adicionar ou excluir informações deste cofre.
          </p>
        </div>
        <button type="button" onClick={addShare} className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
          <Plus className="w-4 h-4 mr-2" /> Adicionar grupo
        </button>
      </div>

      <div className="space-y-3">
        {shares.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            Nenhum grupo compartilhado. Apenas o dono do cofre e administradores têm acesso.
          </div>
        ) : shares.map((share, index) => {
          const group = groupMap.get(share.group_id);

          return (
            <div key={`${share.group_id || 'new'}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_auto] gap-3 lg:items-end">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grupo</label>
                  <select
                    value={share.group_id}
                    onChange={(e) => updateShare(index, 'group_id', e.target.value)}
                    className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                  >
                    <option value="">Selecione um grupo...</option>
                    {groups.map((option) => {
                      const isSelectedElsewhere = selectedGroupIds.includes(option.id) && option.id !== share.group_id;
                      return (
                        <option key={option.id} value={option.id} disabled={isSelectedElsewhere}>
                          {option.name}{option.members_count !== undefined ? ` (${option.members_count} membro${option.members_count === 1 ? '' : 's'})` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {group?.description && <p className="text-xs text-slate-500 mt-1">{group.description}</p>}
                </div>

                <button type="button" onClick={() => removeShare(index)} className="inline-flex items-center justify-center px-3 py-2 border border-red-200 rounded-md text-sm text-red-600 bg-white hover:bg-red-50">
                  <Trash2 className="w-4 h-4 mr-2" /> Remover
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {permissionLabels.map((permission) => (
                  <label key={permission.key} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={Boolean(share[permission.key])}
                      onChange={(e) => updateShare(index, permission.key, e.target.checked)}
                    />
                    {permission.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <button type="button" onClick={saveShares} disabled={isSaving} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
          <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Salvar compartilhamento'}
        </button>
      </div>
    </div>
  );
}
