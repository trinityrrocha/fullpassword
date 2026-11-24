import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { safeLogError } from '../utils/safeLogger';
import {
  canPickUser,
  getVaultSharingGroupNames,
  normalizeUserShare,
  normalizeVaultShare,
  setUserSharePermission,
  sharingSummary,
  toUserSharesPayload,
  toggleUserShare,
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
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm shadow-sm focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
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

const permissionFields = [['can_edit', 'Editar'], ['can_add', 'Adicionar'], ['can_delete', 'Excluir']];

// Users chosen one by one, in addition to groups. The directory only answers a search of 2+ characters and shows a masked address.
function VaultUserShares({ clientId, userShares, onChange, disabled }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const timer = useRef(null);
  const ticket = useRef(0);

  const search = (value) => {
    setQuery(value);
    clearTimeout(timer.current);
    const wanted = value.trim();
    ticket.current += 1;
    if (wanted.length < 2) { setResults([]); setSearchError(''); setSearching(false); return; }
    const mine = ticket.current;
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const response = await api.get(`/crypto/vaults/${clientId}/user-directory`, { params: { q: wanted } });
        if (mine !== ticket.current) return;
        setResults(response.data?.users || []); setSearchError('');
      } catch (err) {
        if (mine !== ticket.current) return;
        setResults([]); setSearchError(err.response?.data?.error === 'SEARCH_TOO_SHORT' ? 'Digite ao menos 2 caracteres.' : 'Não foi possível buscar usuários agora.');
      } finally { if (mine === ticket.current) setSearching(false); }
    }, 300);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const chosen = new Set(userShares.map((share) => share.user_id));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label htmlFor={`${id}-search`} className="block text-sm font-medium text-slate-700 mb-2">Usuários para compartilhar</label>
      <input id={`${id}-search`} type="search" value={query} onChange={(event) => search(event.target.value)} disabled={disabled} maxLength={100} autoComplete="off"
        placeholder="Buscar por nome ou e-mail (2+ caracteres)" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-60" />
      <div aria-live="polite" className="mt-2">
        {searching && <p className="text-xs text-slate-500">Buscando...</p>}
        {searchError && <p role="alert" className="text-xs text-red-700">{searchError}</p>}
        {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && <p className="text-xs text-slate-500">Nenhum usuário encontrado.</p>}
      </div>
      {results.length > 0 && (
        <ul aria-label="Resultado da busca de usuários" className="mt-1 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {results.map((user) => {
            const selected = chosen.has(user.id);
            const pickable = canPickUser(user);
            return (
              <li key={user.id}>
                <label className={`flex items-start gap-2 px-3 py-2 ${pickable || selected ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'}`}>
                  <input type="checkbox" checked={selected} disabled={disabled || (!pickable && !selected)} onChange={() => onChange(toggleUserShare(userShares, user))}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className="min-w-0 text-sm text-slate-700">
                    <span className="block break-words font-medium">{user.name}</span>
                    <span className="block break-all text-xs text-slate-500">{user.email_hint}</span>
                    {!user.has_identity && <span className="block text-xs text-amber-800">Ainda não ativou a chave de acesso: não pode receber o cofre.</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {userShares.length > 0 ? (
        <ul aria-label="Usuários com acesso direto" className="mt-3 space-y-2">
          {userShares.map((share) => (
            <li key={share.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
              <span className="min-w-0 text-sm text-slate-700"><span className="font-medium">{share.name || 'Usuário'}</span> <span className="text-xs text-slate-500">{share.email_hint}</span></span>
              <span className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
                <span className="text-slate-500">Visualizar</span>
                {permissionFields.map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={Boolean(share[key])} disabled={disabled} onChange={(event) => onChange(setUserSharePermission(userShares, share.user_id, key, event.target.checked))}
                      aria-label={`${label} (${share.name || 'usuário'})`} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                    {label}
                  </label>
                ))}
                <button type="button" disabled={disabled} onClick={() => onChange(userShares.filter((item) => item.user_id !== share.user_id))} aria-label={`Remover ${share.name || 'usuário'}`} className="text-red-700 underline">Remover</button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 w-full text-xs leading-relaxed text-slate-500">Nenhum usuário selecionado individualmente.</p>
      )}
    </div>
  );
}

export default function VaultSharingManager({ clientId, saveCryptoShares, compact = false }) {
  const [groups, setGroups] = useState([]);
  const [shares, setShares] = useState([]);
  const [userShares, setUserShares] = useState([]);
  const [userSharesLoaded, setUserSharesLoaded] = useState(false);
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
      // If the direct shares cannot be read, they are NOT sent back on save (the server then keeps them): never overwrite what was not seen.
      try {
        const direct = await api.get(`/crypto/vaults/${clientId}/user-shares`);
        setUserShares((direct.data?.users || []).map((user) => normalizeUserShare({ ...user, user_id: user.id })));
        setUserSharesLoaded(true);
      } catch { setUserShares([]); setUserSharesLoaded(false); }
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
      await saveCryptoShares(cleanedShares, userSharesLoaded ? toUserSharesPayload(userShares) : undefined);
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
      setShares(currentShares);
      let currentUsers;
      try { currentUsers = ((await api.get(`/crypto/vaults/${clientId}/user-shares`)).data?.users || []).map((user) => normalizeUserShare({ ...user, user_id: user.id })); setUserShares(currentUsers); } catch { currentUsers = undefined; }
      stage = 'prepare_key_shares';
      await saveCryptoShares(currentShares, currentUsers ? toUserSharesPayload(currentUsers) : undefined);
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
              Escolha grupos e, se precisar, usuários individuais. As permissões do grupo vêm do cadastro do grupo; as do usuário são escolhidas aqui.
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

      {userSharesLoaded && <VaultUserShares clientId={clientId} userShares={userShares} onChange={setUserShares} disabled={isSaving || isSyncing} />}
      <p className="text-xs text-slate-600" role="status">Compartilhando com: {sharingSummary(shares.length, userShares.length)}. Quem sair da lista perde o acesso na hora; a chave do cofre é renovada ao salvar.</p>

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
