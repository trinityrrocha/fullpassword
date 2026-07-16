import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, Trash2, Users, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { encryptVaultKeyForPublicKey } from '../services/clientVaultKeyService';

const permissionLabels = [
  { key: 'can_view', label: 'Visualizar' },
  { key: 'can_edit', label: 'Editar' },
  { key: 'can_add', label: 'Adicionar' },
  { key: 'can_delete', label: 'Excluir' }
];

const normalizeShare = (share = {}) => ({
  group_id: share.group_id || share.groupId || '',
  group_name: share.group_name || share.groupName || '',
  group_description: share.group_description || share.groupDescription || '',
  can_view: Boolean(share.can_view ?? share.canView ?? true),
  can_edit: Boolean(share.can_edit ?? share.canEdit ?? false),
  can_add: Boolean(share.can_add ?? share.canAdd ?? false),
  can_delete: Boolean(share.can_delete ?? share.canDelete ?? false)
});

const getPermissionSummary = (group = {}) => {
  const permissions = permissionLabels
    .filter((permission) => Boolean(group[permission.key]))
    .map((permission) => permission.label);

  return permissions.length ? permissions.join(', ') : 'Sem permissão definida';
};

export default function VaultSharingManager({ clientId, clientVaultKey, compact = false }) {
  const [groups, setGroups] = useState([]);
  const [shares, setShares] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
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

  const selectedGroupIds = shares.map((share) => share.group_id).filter(Boolean);
  const availableGroups = groups.filter((group) => !selectedGroupIds.includes(group.id));

  const addSelectedGroup = () => {
    if (!selectedGroupId) {
      alert('Selecione um grupo para adicionar ao compartilhamento.');
      return;
    }

    const group = groupMap.get(selectedGroupId);
    if (!group) return;

    setShares((current) => [
      normalizeShare({
        group_id: group.id,
        group_name: group.name,
        group_description: group.description,
        can_view: group.can_view,
        can_edit: group.can_edit,
        can_add: group.can_add,
        can_delete: group.can_delete
      }),
      ...current
    ]);
    setSelectedGroupId('');
  };

  const removeShare = (groupId) => {
    setShares((current) => current.filter((share) => share.group_id !== groupId));
  };

  const syncKeyShares = async (groupIds) => {
    if (!clientVaultKey) {
      throw new Error('A chave do cofre ainda não foi carregada. Desbloqueie o cofre novamente antes de compartilhar.');
    }

    const usersResponse = await api.get('/users');
    const currentUsers = usersResponse.data || [];

    const selected = new Set(groupIds);
    const targetUsers = currentUsers.filter((item) => (
      item.is_active !== false &&
      Array.isArray(item.groups) &&
      item.groups.some((group) => selected.has(group.id))
    ));

    const prepared = [];
    const pending = [];

    for (const item of targetUsers) {
      if (!item.public_key) {
        pending.push(item);
        continue;
      }

      prepared.push({
        user_id: item.id,
        encrypted_client_key: await encryptVaultKeyForPublicKey(clientVaultKey, item.public_key)
      });
    }

    if (pending.length > 0) {
      const names = pending
        .map((item) => item.name && item.email ? `${item.name} (${item.email})` : item.name || item.email)
        .join(', ');
      throw new Error(`Nenhuma chave foi alterada. Usuários sem chave pública: ${names}. Eles precisam entrar e desbloquear o cofre uma vez.`);
    }

    await api.put(`/vault-items/${clientId}/key-shares`, { shares: prepared });
  };

  const saveShares = async () => {
    const cleanedShares = shares
      .filter((share) => share.group_id)
      .map((share) => ({
        group_id: share.group_id,
        can_view: share.can_view,
        can_edit: share.can_edit,
        can_add: share.can_add,
        can_delete: share.can_delete
      }));

    const uniqueGroupIds = new Set(cleanedShares.map((share) => share.group_id));
    if (uniqueGroupIds.size !== cleanedShares.length) {
      alert('Existe grupo duplicado no compartilhamento. Remova a duplicidade antes de salvar.');
      return;
    }

    setIsSaving(true);
    try {
      await syncKeyShares([...uniqueGroupIds]);
      await api.put(`/vault-items/${clientId}/shares`, { shares: cleanedShares });
      alert('Compartilhamento do cofre atualizado com sucesso.');

      await loadSharingData();
    } catch (err) {
      console.error('Erro ao salvar compartilhamento:', err);
      alert(err.message || err.response?.data?.error || 'Erro ao salvar compartilhamento do cofre.');
    } finally {
      setIsSaving(false);
    }
  };

  const resyncKeyShares = async () => {
    setIsSyncing(true);
    try {
      const sharesResponse = await api.get(`/vault-items/${clientId}/shares`);
      const currentShares = (sharesResponse.data || []).map(normalizeShare);
      const currentGroupIds = currentShares.map((share) => share.group_id).filter(Boolean);
      setShares(currentShares);
      await syncKeyShares(currentGroupIds);
      alert('Chaves do compartilhamento ressincronizadas com sucesso.');
    } catch (err) {
      console.error('Erro ao ressincronizar chaves do compartilhamento:', err);
      alert(err.message || err.response?.data?.error || 'Erro ao ressincronizar chaves do compartilhamento.');
    } finally {
      setIsSyncing(false);
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
    <div className="space-y-5 animate-fadeIn">
      {!compact && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-lg font-medium text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-500" /> Compartilhamento do Cofre
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Adicione quais grupos terão acesso a este cofre. As permissões são definidas no cadastro do grupo.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">Grupo para compartilhar</label>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
          >
            <option value="">Selecione um grupo existente...</option>
            {availableGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
          <button type="button" onClick={addSelectedGroup} className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
            <Plus className="w-4 h-4 mr-2" /> Adicionar
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {shares.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            Nenhum grupo compartilhado. Apenas o dono do cofre e administradores têm acesso.
          </div>
        ) : shares.map((share) => {
          const group = groupMap.get(share.group_id) || share;

          return (
            <div key={share.group_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
              <div>
                <p className="font-medium text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-slate-500" /> {group.name || share.group_name || 'Grupo sem nome'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Permissões herdadas do grupo: {getPermissionSummary(group)}</p>
              </div>
              <button type="button" onClick={() => removeShare(share.group_id)} className="inline-flex items-center justify-center px-3 py-2 border border-red-200 rounded-md text-sm text-red-600 bg-white hover:bg-red-50">
                <Trash2 className="w-4 h-4 mr-2" /> Remover
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
        <button type="button" onClick={resyncKeyShares} disabled={isSaving || isSyncing} className="inline-flex items-center justify-center px-4 py-2 border border-indigo-200 rounded-md shadow-sm text-sm font-medium text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} /> {isSyncing ? 'Ressincronizando...' : 'Ressincronizar chaves do compartilhamento'}
        </button>
        <button type="button" onClick={saveShares} disabled={isSaving} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
          <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Salvar compartilhamento'}
        </button>
      </div>
    </div>
  );
}
