import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { safeLogError } from '../utils/safeLogger';
import {
  getVaultSharingGroupNames,
  normalizeVaultShare,
  toggleVaultGroupShare
} from '../utils/vaultSharingSelection';

const getSharingErrorMessage = (error) => {
  if (error?.code === 'VAULT_LOCKED') {
    return 'Desbloqueie o cofre antes de compartilhar.';
  }
  if (String(error?.message || '').startsWith('Não foi possível compartilhar com todos os usuários do grupo.')) {
    return error.message;
  }
  return 'Não foi possível salvar o compartilhamento do cofre. Atualize a página, desbloqueie o cofre e tente novamente.';
};

function VaultGroupSelector({ groups, selectedGroupIds, onToggle, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxId = useId();
  const selectedCount = selectedGroupIds.size;
  const selectionLabel = selectedCount === 0
    ? 'Selecione os grupos...'
    : selectedCount === 1
      ? '1 grupo selecionado'
      : `${selectedCount} grupos selecionados`;

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleOutsideClick = (event) => {
      if (!selectorRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div ref={selectorRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={selectedCount ? 'text-slate-700' : 'text-slate-500'}>{selectionLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Grupos para compartilhar"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-x-hidden overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          {groups.length === 0 ? (
            <p className="px-3 py-3 text-center text-sm text-slate-500">Nenhum grupo cadastrado.</p>
          ) : groups.map((group) => {
            const isSelected = selectedGroupIds.has(group.id);
            return (
              <label
                key={group.id}
                role="option"
                aria-selected={isSelected}
                className={`flex items-start gap-2 rounded px-3 py-2 hover:bg-slate-50 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={isSelected}
                  onChange={() => onToggle(group)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="min-w-0 break-words text-sm text-slate-700">{group.name || 'Grupo sem nome'}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function VaultSharingManager({ clientId, prepareKeyShares, compact = false }) {
  const [groups, setGroups] = useState([]);
  const [shares, setShares] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');

  const loadSharingData = async () => {
    setIsLoading(true);
    setError('');

    try {
      const [groupsResponse, sharesResponse] = await Promise.all([
        api.get('/groups/options'),
        api.get(`/vault-items/${clientId}/shares`)
      ]);

      setGroups(groupsResponse.data || []);
      setShares((sharesResponse.data || []).map(normalizeVaultShare));
    } catch (err) {
      safeLogError('Erro ao carregar compartilhamento do cofre.', err);
      setError(err.response?.data?.error || 'Você não tem permissão para gerenciar o compartilhamento deste cofre.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // O compartilhamento remoto precisa ser recarregado quando o cofre ativo muda.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSharingData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const selectableGroups = useMemo(() => {
    const merged = [...groups];
    shares.forEach((share) => {
      if (share.group_id && !merged.some((group) => group.id === share.group_id)) {
        merged.push({
          id: share.group_id,
          name: share.group_name || 'Grupo sem nome',
          description: share.group_description,
          can_view: share.can_view,
          can_edit: share.can_edit,
          can_add: share.can_add,
          can_delete: share.can_delete
        });
      }
    });
    return merged;
  }, [groups, shares]);
  const selectedGroupIds = useMemo(
    () => new Set(shares.map((share) => share.group_id).filter(Boolean)),
    [shares]
  );
  const selectedGroupNames = useMemo(
    () => getVaultSharingGroupNames(shares, selectableGroups),
    [selectableGroups, shares]
  );
  const toggleGroup = (group) => {
    setShares((current) => toggleVaultGroupShare(current, group));
  };

  const syncKeyShares = async (groupIds) => {
    if (typeof prepareKeyShares !== 'function') {
      const error = new Error('A chave do cofre ainda não foi carregada.');
      error.code = 'VAULT_LOCKED';
      throw error;
    }

    const usersResponse = await api.get('/users');
    const currentUsers = usersResponse.data || [];

    const selected = new Set(groupIds);
    const targetUsers = currentUsers.filter((item) => (
      item.is_active !== false &&
      Array.isArray(item.groups) &&
      item.groups.some((group) => selected.has(group.id))
    ));

    const pending = targetUsers.filter((item) => !item.public_key);

    if (pending.length > 0) {
      const names = pending
        .map((item) => item.name && item.email ? `${item.name} (${item.email})` : item.name || item.email)
        .map((name) => `- ${name}`)
        .join('\n');
      throw new Error(
        `Não foi possível compartilhar com todos os usuários do grupo.\n\n` +
        `Usuários sem chave pública:\n${names}\n\n` +
        `Esses usuários precisam entrar no sistema uma vez para concluir a configuração das chaves de segurança da conta. Depois disso, tente compartilhar novamente.`
      );
    }

    const encryptedKeys = targetUsers.length > 0
      ? await prepareKeyShares(targetUsers.map((item) => item.public_key))
      : [];
    if (!Array.isArray(encryptedKeys) || encryptedKeys.length !== targetUsers.length) {
      throw new Error('Não foi possível preparar todas as chaves do compartilhamento.');
    }

    const prepared = targetUsers.map((item, index) => ({
      user_id: item.id,
      encrypted_client_key: encryptedKeys[index]
    }));

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
    let stage = 'prepare_key_shares';
    try {
      await syncKeyShares([...uniqueGroupIds]);
      stage = 'persist_group_shares';
      await api.put(`/vault-items/${clientId}/shares`, { shares: cleanedShares });
      stage = 'reload_group_shares';
      await loadSharingData();
      alert('Compartilhamento do cofre atualizado com sucesso.');
    } catch (err) {
      safeLogError('Erro ao salvar compartilhamento.', err, {
        stage,
        includeMessage: true,
        includeApiError: true
      });
      alert(getSharingErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const resyncKeyShares = async () => {
    setIsSyncing(true);
    let stage = 'load_group_shares';
    try {
      const sharesResponse = await api.get(`/vault-items/${clientId}/shares`);
      const currentShares = (sharesResponse.data || []).map(normalizeVaultShare);
      const currentGroupIds = currentShares.map((share) => share.group_id).filter(Boolean);
      setShares(currentShares);
      stage = 'prepare_key_shares';
      await syncKeyShares(currentGroupIds);
      alert('Chaves do compartilhamento ressincronizadas com sucesso.');
    } catch (err) {
      safeLogError('Erro ao ressincronizar chaves do compartilhamento.', err, {
        stage,
        includeMessage: true,
        includeApiError: true
      });
      alert(getSharingErrorMessage(err));
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
        <VaultGroupSelector
          groups={selectableGroups}
          selectedGroupIds={selectedGroupIds}
          onToggle={toggleGroup}
          disabled={isSaving || isSyncing}
        />
        {selectedGroupNames.length > 0 ? (
          <p className="mt-2 w-full break-words text-xs leading-relaxed text-slate-500 [overflow-wrap:anywhere]">
            <span className="font-medium text-slate-600">Grupos compartilhados:</span>{' '}
            {selectedGroupNames.join(', ')}
          </p>
        ) : (
          <p className="mt-2 w-full text-xs leading-relaxed text-slate-500">
            Nenhum grupo selecionado para compartilhamento.
          </p>
        )}
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
