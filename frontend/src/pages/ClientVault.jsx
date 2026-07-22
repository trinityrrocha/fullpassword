import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Server, Globe, Shield, HardDrive, Plus, Save, Share, KeyRound, Edit2, X } from 'lucide-react';
import SecurePasswordInput from '../components/SecurePasswordInput';
import DeleteConfirmationControl from '../components/DeleteConfirmationControl';
import VaultSharingManager from '../components/VaultSharingManager';
import VaultReadOnlyGuard from '../components/VaultReadOnlyGuard';
import { useAuth } from '../context/AuthContext';
import { encryptData, encryptFile, decryptData, base64ToBlob, downloadBlob } from '../services/cryptoService';
import { decryptVaultKeyShare } from '../services/clientVaultKeyService';
import api from '../services/api';

const normalizeVaultPermissions = (permissions) => {
  const isOwner = Boolean(permissions?.is_owner ?? permissions?.isOwner ?? false);
  const isAdmin = Boolean(permissions?.is_admin ?? permissions?.isAdmin ?? false);

  return {
    is_owner: isOwner,
    is_admin: isAdmin,
    can_view: Boolean(permissions?.can_view ?? permissions?.canView ?? false),
    can_edit: Boolean(permissions?.can_edit ?? permissions?.canEdit ?? false),
    can_add: Boolean(permissions?.can_add ?? permissions?.canAdd ?? false),
    can_delete: Boolean(permissions?.can_delete ?? permissions?.canDelete ?? false)
  };
};

const COMPANY_MODULES = [
  { id: 'cpanelWeb', name: 'cPanel / Web', icon: Globe },
  { id: 'vpn', name: 'VPN', icon: Shield },
  { id: 'windowsServer', name: 'Servidor Windows', icon: Server },
  { id: 'linuxServer', name: 'Servidor Linux', icon: HardDrive }
];

const COMPANY_MODULE_IDS = COMPANY_MODULES.map((module) => module.id);
const normalizeEnabledModules = (modules) => Array.isArray(modules)
  ? COMPANY_MODULE_IDS.filter((moduleId) => modules.includes(moduleId))
  : null;

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const emptyServer = () => ({
  id: makeId(),
  name: '',
  ip: '',
  internalPort: '',
  externalPort: '',
  notes: ''
});

const emptyTsUser = (serverId = '') => ({
  id: makeId(),
  serverId,
  name: '',
  username: '',
  password: '',
  permission: 'user',
  department: ''
});

const normalizeTsForm = (data = {}) => {
  if (Array.isArray(data.servers) || Array.isArray(data.users)) {
    return {
      servers: Array.isArray(data.servers)
        ? data.servers.map((server) => ({
            id: server.id || makeId(),
            name: server.name || '',
            ip: server.ip || '',
            internalPort: server.internalPort || server.port || '',
            externalPort: server.externalPort || '',
            notes: server.notes || server.observations || ''
          }))
        : [],
      users: Array.isArray(data.users)
        ? data.users.map((user) => ({
            id: user.id || makeId(),
            serverId: user.serverId || '',
            name: user.name || '',
            username: user.username || user.login || '',
            password: user.password || '',
            permission: user.permission || 'user',
            department: user.department || ''
          }))
        : []
    };
  }

  const legacyServerId = `legacy-${String(data.ip || 'principal').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const legacyServer = data.ip || data.port || data.domain
    ? [{
        id: legacyServerId,
        name: data.domain || 'Servidor principal',
        ip: data.ip || '',
        internalPort: data.port || '',
        externalPort: data.externalPort || '',
        notes: data.notes || data.observations || ''
      }]
    : [];

  return {
    servers: legacyServer,
    users: Array.isArray(data.users)
      ? data.users.map((user) => ({
          id: user.id || makeId(),
          serverId: user.serverId || legacyServerId,
          name: user.name || '',
          username: user.username || user.login || '',
          password: user.password || '',
          permission: user.permission || 'user',
          department: user.department || ''
        }))
      : []
  };
};

export default function ClientVault() {
  const { id } = useParams();
  const [activeModuleId, setActiveModuleId] = useState(null);
  const [enabledModules, setEnabledModules] = useState([]);
  const [modulesLoaded, setModulesLoaded] = useState(false);
  const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);
  const [isSavingModules, setIsSavingModules] = useState(false);

  // Mock do cliente atual
  const client = { id, name: 'Acme Corp', address: 'Av. Paulista, 1000 - SP' };

  const tabs = COMPANY_MODULES.filter((module) => enabledModules.includes(module.id));
  const availableModules = COMPANY_MODULES.filter((module) => !enabledModules.includes(module.id));

  const [cpanelForm, setCpanelForm] = useState({
    url: '',
    username: '',
    password: '',
    email: '',
    emailPassword: '',
    isSystem: true
  });

  const [vpnForm, setVpnForm] = useState({
    type: 'OpenVPN',
    username: '',
    password: '',
    port: '',
    vlan: '',
    personName: ''
  });

  const [tsForm, setTsForm] = useState({ servers: [], users: [] });
  const [serverDraft, setServerDraft] = useState(emptyServer());
  const [userDraft, setUserDraft] = useState(emptyTsUser());
  const [editingServer, setEditingServer] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');
  const [userSearch, setUserSearch] = useState('');

  const [serverForm, setServerForm] = useState({
    port: '',
    passwords: '',
    attachment: null
  });

  const { user, masterKey, isVaultUnlocked, unlockVault } = useAuth();
  const [unlockPassword, setUnlockPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [savedItems, setSavedItems] = useState([]);
  const [vaultDataKey, setVaultDataKey] = useState(null);
  const [vaultPermissions, setVaultPermissions] = useState(null);
  const [vaultKeyError, setVaultKeyError] = useState('');
  const [isSharingModalOpen, setIsSharingModalOpen] = useState(false);
  const effectiveVaultPermissions = vaultPermissions
    ? normalizeVaultPermissions(vaultPermissions)
    : null;
  const canManageModules = Boolean(effectiveVaultPermissions && (effectiveVaultPermissions.is_owner || effectiveVaultPermissions.is_admin || effectiveVaultPermissions.can_edit));
  const hasEnabledModules = enabledModules.length > 0;
  const failedVaultItems = savedItems.filter((item) => item.decryptError);
  const allVaultItemsFailed = savedItems.length > 0 && failedVaultItems.length === savedItems.length;

  const getServerLabel = (serverId) => {
    const server = tsForm.servers.find((item) => item.id === serverId);
    if (!server) return 'Servidor não informado';
    return server.name ? `${server.name} - ${server.ip || 'sem IP'}` : server.ip || 'Servidor sem nome';
  };

  const loadVaultItems = async () => {
    if (!vaultDataKey) return;

    setIsLoading(true);
    setModulesLoaded(false);
    try {
      const [itemsResponse, modulesResponse] = await Promise.all([
        api.get(`/vault-items/${id}`),
        api.get(`/clients/${id}/modules`)
      ]);
      const items = itemsResponse.data || [];
      const decryptedItems = [];
      const loadedCategories = new Set();
      const decryptionFailures = [];

      for (const item of items) {
        try {
          const decryptedData = await decryptData(item.encrypted_data, vaultDataKey);
          decryptedItems.push({ ...item, decrypted: decryptedData });

          // O backend retorna por created_at DESC. Só o primeiro item de cada categoria deve popular o formulário.
          // Isso evita que registros antigos sobrescrevam a versão mais recente ao recarregar a página.
          if (loadedCategories.has(item.category)) continue;
          loadedCategories.add(item.category);

          if (item.category === 'cPanel') setCpanelForm(decryptedData);
          if (item.category === 'VPN') setVpnForm(decryptedData);
          if (item.category === 'Servidor TS') setTsForm(normalizeTsForm(decryptedData));
          if (item.category === 'Servidores Diversos') {
            setServerForm({ ...decryptedData, attachment: null });
          }
        } catch (err) {
          decryptionFailures.push({
            id: item.id,
            category: item.category,
            hasEncryptedData: typeof item.encrypted_data === 'string' && item.encrypted_data.length > 0,
            encryptedDataLength: typeof item.encrypted_data === 'string' ? item.encrypted_data.length : 0,
            algorithm: 'AES-GCM',
            errorName: err?.name || 'Error'
          });
          decryptedItems.push({ ...item, decryptError: true });
        }
      }

      if (decryptionFailures.length > 0) {
        console.warn('Alguns itens do cofre não puderam ser descriptografados.', {
          failedItems: decryptionFailures,
          total: items.length
        });
      }

      const configuredModules = normalizeEnabledModules(modulesResponse.data?.enabledModules);
      const resolvedModules = configuredModules ?? COMPANY_MODULE_IDS;
      setSavedItems(decryptedItems);
      setEnabledModules(resolvedModules);
      setActiveModuleId(COMPANY_MODULES.find((module) => resolvedModules.includes(module.id))?.id || null);
    } catch (error) {
      console.error('Erro ao carregar itens do cofre:', error);
    } finally {
      setIsLoading(false);
      setModulesLoaded(true);
    }
  };

  useEffect(() => {
    if (!isVaultUnlocked || !masterKey || !user) return;

    let cancelled = false;
    const loadVaultAccess = async () => {
      setVaultDataKey(null);
      setVaultKeyError('');
      try {
        const permissionsResponse = await api.get(`/vault-items/${id}/permissions`);
        const permissions = permissionsResponse.data;
        if (!permissions || typeof permissions !== 'object') {
          throw new Error('O servidor retornou permissões inválidas para este cofre.');
        }

        const normalizedPermissions = normalizeVaultPermissions(permissions);
        if (!normalizedPermissions.can_view && !normalizedPermissions.is_owner && !normalizedPermissions.is_admin) {
          throw new Error('Você não possui permissão para visualizar este cofre.');
        }

        if (cancelled) return;
        setVaultPermissions(normalizedPermissions);

        const keyResponse = await api.get(`/vault-items/${id}/key-share`);
        if (keyResponse.data?.encrypted_client_key) {
          if (!user.encrypted_private_key) {
            throw new Error('Sua chave privada ainda não está disponível. Desbloqueie o cofre novamente.');
          }

          const sharedKey = await decryptVaultKeyShare(
            keyResponse.data.encrypted_client_key,
            user.encrypted_private_key,
            masterKey
          );
          if (!cancelled) setVaultDataKey(sharedKey);
          return;
        }

        if (normalizedPermissions.is_owner) {
          if (!cancelled) setVaultDataKey(masterKey);
          return;
        }

        throw new Error('A chave criptográfica deste cofre ainda não foi entregue. Peça ao proprietário para salvar o compartilhamento novamente.');
      } catch (error) {
        console.error('Erro ao carregar acesso criptográfico do cofre:', error);
        if (!cancelled) {
          setVaultKeyError(error.response?.data?.error || error.message || 'Não foi possível carregar a chave deste cofre.');
        }
      }
    };

    loadVaultAccess();
    return () => { cancelled = true; };
  }, [id, isVaultUnlocked, masterKey, user]);

  useEffect(() => {
    if (vaultDataKey) loadVaultItems();
  }, [id, vaultDataKey]);

  const handleSaveData = async (category, data, options = {}) => {
    const { showSuccess = true, successMessage } = options;

    if (!vaultDataKey) {
      alert('Cofre bloqueado. Por favor, insira sua senha mestre para continuar.');
      return false;
    }

    if (failedVaultItems.length > 0) {
      alert('O salvamento foi bloqueado porque existem itens que não puderam ser descriptografados. Recarregue o cofre ou corrija o acesso criptográfico antes de salvar.');
      return false;
    }

    setIsSaving(true);
    try {
      const normalizedData = category === 'Servidor TS' ? normalizeTsForm(data) : data;
      const metadata = {
        category,
        description: category === 'Servidor TS'
          ? `${normalizedData.servers.length} servidor(es), ${normalizedData.users.length} usuário(s)`
          : normalizedData.type || normalizedData.url || normalizedData.port || 'Registro do cofre',
        timestamp: new Date().toISOString()
      };

      let encryptedAttachment = null;
      let dataToEncrypt = { ...normalizedData };

      if (category === 'Servidores Diversos' && normalizedData.attachment) {
        encryptedAttachment = await encryptFile(normalizedData.attachment, vaultDataKey);
        delete dataToEncrypt.attachment;
        dataToEncrypt.hasAttachment = true;
        dataToEncrypt.attachmentName = normalizedData.attachment.name;
      }

      const encryptedData = await encryptData(dataToEncrypt, vaultDataKey);
      const payload = {
        category,
        encrypted_data: encryptedData,
        encrypted_attachment: encryptedAttachment,
        metadata
      };

      await api.post(`/vault-items/${id}`, payload);

      if (showSuccess) {
        alert(successMessage || `Dados de ${category} salvos com sucesso e criptografados localmente!`);
      }

      return true;
    } catch (error) {
      console.error('Erro ao salvar no cofre:', error);
      alert('Erro ao salvar os dados. Verifique o console.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const persistEnabledModules = async (nextModules) => {
    if (!canManageModules || isSavingModules) return false;
    const normalizedModules = normalizeEnabledModules(nextModules) || [];
    setIsSavingModules(true);
    try {
      await api.put(`/clients/${id}/modules`, { enabledModules: normalizedModules });
      setEnabledModules(normalizedModules);
      const activeModuleIsVisible = normalizedModules.includes(activeModuleId);
      if (!activeModuleIsVisible) {
        setActiveModuleId(COMPANY_MODULES.find((module) => normalizedModules.includes(module.id))?.id || null);
      }
      if (normalizedModules.length === 0) setIsSharingModalOpen(false);
      setIsAddModuleOpen(false);
      return true;
    } catch (error) {
      console.error('Erro ao salvar módulos da empresa:', error);
      alert(error.response?.data?.error || 'Não foi possível atualizar as abas da empresa.');
      return false;
    } finally {
      setIsSavingModules(false);
    }
  };

  const addModule = (moduleId) => persistEnabledModules([...enabledModules, moduleId]);

  // Referenciado pelos transforms dos gerenciadores no build do Vite.
  // eslint-disable-next-line no-unused-vars
  const hideActiveModule = async () => {
    const activeModule = COMPANY_MODULES.find((module) => module.id === activeModuleId);
    if (!activeModule || !canManageModules) return;
    const confirmed = window.confirm('Deseja ocultar esta aba da empresa? Os dados cadastrados serão mantidos e poderão ser exibidos novamente ao adicionar a aba.');
    if (!confirmed) return;
    await persistEnabledModules(enabledModules.filter((moduleId) => moduleId !== activeModule.id));
  };

  const persistTsForm = async (nextForm, successMessage) => {
    return handleSaveData('Servidor TS', nextForm, { successMessage });
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    const userWrappedKey = user?.wrapped_key;
    const userSalt = user?.crypto_salt;

    if (!userWrappedKey || !userSalt) {
      alert('Erro crítico: Chave envelopada do usuário não encontrada. Faça login novamente ou recadastre o usuário.');
      return;
    }

    const result = await unlockVault(unlockPassword, userWrappedKey, userSalt);
    if (!result.success) {
      alert(result.error);
    } else {
      setUnlockPassword('');
    }
  };

  const handleDownloadAttachment = async (item) => {
    if (!item.encrypted_attachment) return;

    try {
      const decryptedFile = await decryptData(item.encrypted_attachment, vaultDataKey);
      const blob = base64ToBlob(decryptedFile.data);
      downloadBlob(blob, decryptedFile.name);
    } catch (error) {
      console.error('Erro ao descriptografar anexo:', error);
      alert('Erro ao descriptografar o anexo. A chave pode estar incorreta.');
    }
  };

  const addTsServer = async () => {
    if (!serverDraft.name.trim() || !serverDraft.ip.trim()) {
      alert('Informe pelo menos o nome do servidor e o IP.');
      return;
    }

    const newServer = { ...serverDraft, id: makeId() };
    const nextForm = { ...tsForm, servers: [newServer, ...tsForm.servers] };

    const saved = await persistTsForm(
      nextForm,
      'Servidor cadastrado e salvo automaticamente no cofre.'
    );

    if (saved) {
      setTsForm(nextForm);
      setServerDraft(emptyServer());
      setUserDraft((current) => ({
        ...current,
        serverId: current.serverId || newServer.id
      }));
    }
  };

  const updateServerDraft = (field, value) => {
    setServerDraft((current) => ({ ...current, [field]: value }));
  };

  const openEditServerModal = (server) => {
    setEditingServer({ ...server });
    setDeleteConfirmation('');
  };

  const saveEditedServer = async () => {
    if (!editingServer.name.trim() || !editingServer.ip.trim()) {
      alert('Informe pelo menos o nome do servidor e o IP.');
      return;
    }

    const nextForm = {
      ...tsForm,
      servers: tsForm.servers.map((server) => server.id === editingServer.id ? editingServer : server)
    };

    const saved = await persistTsForm(nextForm, 'Servidor atualizado e salvo no cofre.');
    if (saved) {
      setTsForm(nextForm);
      setEditingServer(null);
      setDeleteConfirmation('');
    }
  };

  const deleteEditedServer = async () => {
    if (deleteConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      servers: tsForm.servers.filter((server) => server.id !== editingServer.id),
      users: tsForm.users.map((user) => user.serverId === editingServer.id ? { ...user, serverId: '' } : user)
    };

    const saved = await persistTsForm(nextForm, 'Servidor excluído e cofre atualizado.');
    if (saved) {
      setTsForm(nextForm);
      setEditingServer(null);
      setDeleteConfirmation('');
    }
  };

  const updateUserDraft = (field, value) => {
    setUserDraft((current) => ({ ...current, [field]: value }));
  };

  const addTsUser = async () => {
    if (!userDraft.serverId) {
      alert('Selecione o servidor ao qual este usuário pertence.');
      return;
    }
    if (!userDraft.name.trim() || !userDraft.username.trim()) {
      alert('Informe o nome e o nome do usuário.');
      return;
    }

    const newUser = { ...userDraft, id: makeId() };
    const nextForm = { ...tsForm, users: [newUser, ...tsForm.users] };

    const saved = await persistTsForm(
      nextForm,
      'Usuário cadastrado e salvo automaticamente no cofre.'
    );

    if (saved) {
      setTsForm(nextForm);
      setUserDraft(emptyTsUser(userDraft.serverId));
    }
  };

  const updateTsUser = (userId, field, value) => {
    setTsForm((current) => ({
      ...current,
      users: current.users.map((user) => user.id === userId ? { ...user, [field]: value } : user)
    }));
  };

  const removeTsUser = async (userId) => {
    if (!window.confirm('Deseja remover este usuário da lista?')) return;
    
    const nextForm = { ...tsForm, users: tsForm.users.filter((user) => user.id !== userId) };
    const saved = await persistTsForm(nextForm, 'Usuário removido e cofre atualizado.');
    if (saved) setTsForm(nextForm);
  };

  const openEditUserModal = (user) => {
    setEditingUser({ ...user });
    setDeleteUserConfirmation('');
  };

  const saveEditedUser = async () => {
    if (!editingUser.serverId) {
      alert('Selecione o servidor ao qual este usuário pertence.');
      return;
    }
    if (!editingUser.name.trim() || !editingUser.username.trim()) {
      alert('Informe o nome e o nome do usuário.');
      return;
    }

    const nextForm = {
      ...tsForm,
      users: tsForm.users.map((user) =>
        user.id === editingUser.id ? editingUser : user
      )
    };

    const saved = await persistTsForm(nextForm, 'Usuário atualizado e salvo no cofre.');
    if (saved) {
      setTsForm(nextForm);
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  const deleteEditedUser = async () => {
    if (deleteUserConfirmation !== 'EXCLUIR') {
      alert('Para confirmar a exclusão, escreva EXCLUIR no campo de confirmação.');
      return;
    }

    const nextForm = {
      ...tsForm,
      users: tsForm.users.filter((user) => user.id !== editingUser.id)
    };

    const saved = await persistTsForm(nextForm, 'Usuário excluído e cofre atualizado.');
    if (saved) {
      setTsForm(nextForm);
      setEditingUser(null);
      setDeleteUserConfirmation('');
    }
  };

  if (!isVaultUnlocked) {
    return (
      <div className="max-w-md mx-auto mt-10 bg-white p-8 rounded-lg shadow-md border border-slate-200">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4">
            <KeyRound className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Cofre Bloqueado</h2>
          <p className="text-sm text-slate-500 mt-2">
            Sua chave de criptografia foi removida da memória. Insira sua senha mestre novamente para derivar a chave e desbloquear o cofre.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <SecurePasswordInput name="unlock_password" label="Senha Mestre" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} required />
          <button type="submit" className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
            Desbloquear Cofre
          </button>
        </form>
      </div>
    );
  }

  if (vaultKeyError) {
    return (
      <div className="max-w-2xl mx-auto mt-10 rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="text-lg font-semibold">Acesso criptográfico pendente</h2>
        <p className="mt-2 text-sm">{vaultKeyError}</p>
        <Link to="/" className="inline-flex mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-800">Voltar aos cofres</Link>
      </div>
    );
  }

  if (!vaultDataKey || !effectiveVaultPermissions) {
    return <p className="max-w-5xl mx-auto mt-10 text-sm text-slate-500">Carregando acesso seguro ao cofre...</p>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-vault-readonly-scope="true">
      <VaultReadOnlyGuard enabled permissions={effectiveVaultPermissions} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{client.name}</h1>
            <p className="text-sm text-slate-500">Cofre de Senhas e Credenciais</p>
          </div>
        </div>
        <div className="relative flex items-center gap-2">
          <button type="button" disabled={!canManageModules || isSavingModules} onClick={() => setIsAddModuleOpen((open) => !open)} className="inline-flex items-center justify-center rounded-md border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="mr-2 h-4 w-4" /> Adicionar
          </button>
          {hasEnabledModules && (effectiveVaultPermissions.is_owner || effectiveVaultPermissions.is_admin) && (
            <button type="button" onClick={() => setIsSharingModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 border border-indigo-200 rounded-md shadow-sm text-sm font-medium text-indigo-700 bg-white hover:bg-indigo-50">
              <Share className="w-4 h-4 mr-2" /> Compartilhar
            </button>
          )}
          {isAddModuleOpen && canManageModules && (
            <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {availableModules.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">Todas as abas já foram adicionadas.</p> : availableModules.map((module) => (
                <button key={module.id} type="button" disabled={isSavingModules} onClick={() => addModule(module.id)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <module.icon className="h-4 w-4 text-slate-500" /> {module.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {allVaultItemsFailed && !effectiveVaultPermissions.is_owner && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <h2 className="font-semibold">Não foi possível descriptografar os itens deste cofre</h2>
          <p className="mt-1 text-sm">A chave compartilhada deste cofre está inválida ou desatualizada. Peça ao proprietário para ressincronizar o compartilhamento.</p>
        </div>
      )}

      {failedVaultItems.length > 0 && !allVaultItemsFailed && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">Alguns itens não puderam ser abertos</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {failedVaultItems.map((item) => (
              <li key={item.id}>{item.category || 'Item do cofre'}: Não foi possível descriptografar este item.</li>
            ))}
          </ul>
        </div>
      )}

      {!modulesLoaded ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow">Carregando abas da empresa...</div>
      ) : tabs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="font-medium text-slate-800">Nenhuma aba adicionada.</h2>
          <p className="mt-1 text-sm text-slate-500">Clique em &quot;Adicionar&quot; para incluir cPanel / Web, VPN, Servidor Windows ou Servidor Linux nesta empresa.</p>
        </div>
      ) : (
      <div className="bg-white shadow rounded-lg border border-slate-200 overflow-hidden">
        <div className="border-b border-slate-200">
          <nav className="flex -mb-px overflow-x-auto" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveModuleId(tab.id)}
                className={`flex-1 min-w-0 py-4 px-4 text-center text-sm font-medium border-b-2 whitespace-nowrap flex items-center justify-center gap-2 ${activeModuleId === tab.id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
              >
                <tab.icon className={`w-5 h-5 ${activeModuleId === tab.id ? 'text-indigo-500' : 'text-slate-400'}`} />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeModuleId === 'cpanelWeb' && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2">Acesso ao cPanel / Hospedagem</h3>
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Endereço do cPanel (URL)</label>
                  <input type="url" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={cpanelForm.url} onChange={(e) => setCpanelForm({ ...cpanelForm, url: e.target.value })} placeholder="https://cpanel.dominio.com.br" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Usuário</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={cpanelForm.username} onChange={(e) => setCpanelForm({ ...cpanelForm, username: e.target.value })} />
                </div>
                <div>
                  <SecurePasswordInput name="cpanel_pass" label="Senha do cPanel" value={cpanelForm.password} onChange={(e) => setCpanelForm({ ...cpanelForm, password: e.target.value })} />
                </div>
              </div>

              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2 mt-8">E-mail Principal</h3>
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">E-mail / Usuário</label>
                  <input type="email" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={cpanelForm.email} onChange={(e) => setCpanelForm({ ...cpanelForm, email: e.target.value })} />
                </div>
                <div>
                  <SecurePasswordInput name="email_pass" label="Senha do E-mail" value={cpanelForm.emailPassword} onChange={(e) => setCpanelForm({ ...cpanelForm, emailPassword: e.target.value })} />
                </div>
                <div className="sm:col-span-2 flex items-center mt-2">
                  <span className="mr-3 text-sm font-medium text-slate-700">Tipo de Acesso:</span>
                  <div className="flex items-center space-x-4">
                    <label className="inline-flex items-center">
                      <input type="radio" className="form-radio text-indigo-600 focus:ring-indigo-500" checked={cpanelForm.isSystem} onChange={() => setCpanelForm({ ...cpanelForm, isSystem: true })} />
                      <span className="ml-2 text-sm text-slate-700">Sistema</span>
                    </label>
                    <label className="inline-flex items-center">
                      <input type="radio" className="form-radio text-indigo-600 focus:ring-indigo-500" checked={!cpanelForm.isSystem} onChange={() => setCpanelForm({ ...cpanelForm, isSystem: false })} />
                      <span className="ml-2 text-sm text-slate-700">Pessoa Física</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-5 flex justify-end">
                <button disabled={isSaving} onClick={() => handleSaveData('cPanel', cpanelForm)} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                  <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Criptografando...' : 'Salvar cPanel'}
                </button>
              </div>
            </div>
          )}

          {activeModuleId === 'vpn' && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2">Configuração de VPN</h3>
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de VPN</label>
                  <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 bg-white" value={vpnForm.type} onChange={(e) => setVpnForm({ ...vpnForm, type: e.target.value })}>
                    <option>OpenVPN</option>
                    <option>WireGuard</option>
                    <option>ZeroTier</option>
                    <option>Radmin</option>
                    <option>Outro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Porta</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={vpnForm.port} onChange={(e) => setVpnForm({ ...vpnForm, port: e.target.value })} placeholder="Ex: 1194" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VLAN</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={vpnForm.vlan} onChange={(e) => setVpnForm({ ...vpnForm, vlan: e.target.value })} placeholder="Ex: 10.8.0.0/24" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Usuário VPN</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={vpnForm.username} onChange={(e) => setVpnForm({ ...vpnForm, username: e.target.value })} />
                </div>
                <div>
                  <SecurePasswordInput name="vpn_pass" label="Senha VPN" value={vpnForm.password} onChange={(e) => setVpnForm({ ...vpnForm, password: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Pessoa Vinculada</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={vpnForm.personName} onChange={(e) => setVpnForm({ ...vpnForm, personName: e.target.value })} placeholder="Nome de quem usa" />
                </div>
              </div>
              <div className="pt-5 flex justify-end">
                <button disabled={isSaving} onClick={() => handleSaveData('VPN', vpnForm)} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                  <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Criptografando...' : 'Salvar VPN'}
                </button>
              </div>
            </div>
          )}

          {activeModuleId === 'windowsServer' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                <h3 className="text-lg font-medium text-slate-900 mb-4">Cadastro de Servidores</h3>
                <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome do servidor</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={serverDraft.name} onChange={(e) => updateServerDraft('name', e.target.value)} placeholder="Ex: TS Matriz" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IP do servidor</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={serverDraft.ip} onChange={(e) => updateServerDraft('ip', e.target.value)} placeholder="192.168.1.100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Porta interna</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={serverDraft.internalPort} onChange={(e) => updateServerDraft('internalPort', e.target.value)} placeholder="3389" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Porta externa</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={serverDraft.externalPort} onChange={(e) => updateServerDraft('externalPort', e.target.value)} placeholder="10061" />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
                    <textarea rows={2} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={serverDraft.notes} onChange={(e) => updateServerDraft('notes', e.target.value)} placeholder="Observações sobre o servidor"></textarea>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="button" disabled={isSaving} onClick={addTsServer} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                    <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Cadastrar servidor'}
                  </button>
                </div>

                <div className="mt-6 space-y-3">
                  {tsForm.servers.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum servidor cadastrado.</p>
                  ) : tsForm.servers.map((server) => (
                    <div key={server.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
                      <div>
                        <p className="font-medium text-slate-900">{server.name}</p>
                        <p className="text-sm text-slate-500">IP: {server.ip || '-'} | Porta interna: {server.internalPort || '-'} | Porta externa: {server.externalPort || '-'}</p>
                      </div>
                      <button type="button" onClick={() => openEditServerModal(server)} className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50">
                        <Edit2 className="w-4 h-4 mr-2" /> Editar
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* CARD: Cadastro de Usuários */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                <h3 className="text-lg font-medium text-slate-900 mb-4">Cadastro de Usuários</h3>
                <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Servidor</label>
                    <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={userDraft.serverId} onChange={(e) => updateUserDraft('serverId', e.target.value)}>
                      <option value="">Selecione o servidor</option>
                      {tsForm.servers.map((server) => (
                        <option key={server.id} value={server.id}>{server.name || server.ip}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={userDraft.name} onChange={(e) => updateUserDraft('name', e.target.value)} placeholder="Ex: João Silva" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome do usuário</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={userDraft.username} onChange={(e) => updateUserDraft('username', e.target.value)} placeholder="login" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Permissão</label>
                    <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={userDraft.permission} onChange={(e) => updateUserDraft('permission', e.target.value)}>
                      <option value="admin">Admin</option>
                      <option value="user">User</option>
                      <option value="user+TS">User + TS</option>
                      <option value="admin+TS">Admin + TS</option>
                      <option value="sistema">Sistema</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Departamento</label>
                    <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white" value={userDraft.department} onChange={(e) => updateUserDraft('department', e.target.value)}>
                      <option value="">Selecione...</option>
                      <option value="Comercial">Comercial</option>
                      <option value="Contabilidade">Contabilidade</option>
                      <option value="ERP">ERP</option>
                      <option value="Financeiro">Financeiro</option>
                      <option value="Fiscal">Fiscal</option>
                      <option value="Gerencia">Gerência</option>
                      <option value="Outro">Outro</option>
                      <option value="RH">RH</option>
                      <option value="Suporte">Suporte</option>
                      <option value="Vendas">Vendas</option>
                    </select>
                  </div>
                </div>

                {/* Linha: Senha + Botão na mesma linha */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1 max-w-md">
                    <SecurePasswordInput name="new_ts_user_password" label="Senha" value={userDraft.password} onChange={(e) => updateUserDraft('password', e.target.value)} />
                  </div>
                  <div className="flex-shrink-0">
                    <button onClick={addTsUser} type="button" disabled={isSaving} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 h-[42px]">
                      <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Adicionar Usuário'}
                    </button>
                  </div>
                </div>
              </div>

              {/* PESQUISA: campo solto, fora do card */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pesquisar usuário</label>
                <input
                  type="text"
                  className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Buscar por nome, login, departamento ou servidor..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
              </div>

              {/* CARD: Lista de Usuários Cadastrados */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                <h3 className="text-lg font-medium text-slate-900 mb-4">Usuários Cadastrados</h3>
                <div className="space-y-3">
                  {(() => {
                    const filtered = tsForm.users.filter((user) => {
                      if (!userSearch.trim()) return true;
                      const q = userSearch.toLowerCase();
                      return (
                        (user.name || '').toLowerCase().includes(q) ||
                        (user.username || '').toLowerCase().includes(q) ||
                        (user.department || '').toLowerCase().includes(q) ||
                        getServerLabel(user.serverId).toLowerCase().includes(q)
                      );
                    });
                    if (filtered.length === 0) {
                      return <p className="text-sm text-slate-500">{userSearch.trim() ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado.'}</p>;
                    }
                    return filtered.map((user) => (
                      <div key={user.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{user.name || 'Usuário sem nome'}</p>
                          <p className="text-sm text-slate-500">
                            Usuário: {user.username || '-'} | Permissão: {user.permission || '-'}
                            {user.department ? ` | Depto: ${user.department}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">Servidor: {getServerLabel(user.serverId)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEditUserModal(user)}
                          className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-700 bg-white hover:bg-slate-50"
                        >
                          <Edit2 className="w-4 h-4 mr-2" /> Editar
                        </button>
                      </div>
                    ));
                  })()}
                </div>
              </div>


            </div>
          )}

          {activeModuleId === 'linuxServer' && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2">Servidores Diversos / Anotações</h3>
              <div className="grid grid-cols-1 gap-y-6 gap-x-4">
                <div className="sm:w-1/3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Porta Principal</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" value={serverForm.port} onChange={(e) => setServerForm({ ...serverForm, port: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Senhas e Anotações Livres</label>
                  <textarea rows={6} className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm" value={serverForm.passwords} onChange={(e) => setServerForm({ ...serverForm, passwords: e.target.value })} placeholder="Cole aqui múltiplas senhas, chaves de API, etc..."></textarea>
                  <p className="mt-1 text-xs text-slate-500">Todo este texto será criptografado antes de ser salvo.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Anexo (.txt, .pem, .key)</label>
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-300 border-dashed rounded-md hover:border-indigo-500 transition-colors">
                    <div className="space-y-1 text-center">
                      <HardDrive className="mx-auto h-12 w-12 text-slate-400" />
                      <div className="flex text-sm text-slate-600 justify-center">
                        <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500">
                          <span>Selecione um arquivo</span>
                          <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".txt,.pem,.key,.csv" onChange={(e) => setServerForm({ ...serverForm, attachment: e.target.files[0] })} />
                        </label>
                      </div>
                      <p className="text-xs text-slate-500">{serverForm.attachment ? `Arquivo selecionado: ${serverForm.attachment.name}` : 'Apenas arquivos de texto até 5MB'}</p>
                      <p className="text-xs text-indigo-500 font-medium">O arquivo será convertido para base64 e criptografado localmente.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-5 flex justify-end">
                <button disabled={isSaving} onClick={() => handleSaveData('Servidores Diversos', serverForm)} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                  <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Criptografando...' : 'Salvar Servidores'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {isSharingModalOpen && hasEnabledModules && (effectiveVaultPermissions.is_owner || effectiveVaultPermissions.is_admin) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Compartilhamento do Cofre</h2>
              <button type="button" onClick={() => setIsSharingModalOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Fechar compartilhamento">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <VaultSharingManager clientId={id} clientVaultKey={vaultDataKey} compact />
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Editar usuário</h3>
              <button type="button" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Servidor</label>
                  <select
                    className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                    value={editingUser.serverId}
                    onChange={(e) => setEditingUser({ ...editingUser, serverId: e.target.value })}
                  >
                    <option value="">Selecione o servidor</option>
                    {tsForm.servers.map((server) => (
                      <option key={server.id} value={server.id}>{server.name || server.ip}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                  <input
                    type="text"
                    className="w-full border-slate-300 rounded-md shadow-sm p-2 border"
                    value={editingUser.name}
                    onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome do usuário</label>
                  <input
                    type="text"
                    className="w-full border-slate-300 rounded-md shadow-sm p-2 border"
                    value={editingUser.username}
                    onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Permissão</label>
                  <select
                    className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                    value={editingUser.permission}
                    onChange={(e) => setEditingUser({ ...editingUser, permission: e.target.value })}
                  >
                    <option value="admin">Admin</option>
                    <option value="user">User</option>
                    <option value="user+TS">User + TS</option>
                    <option value="admin+TS">Admin + TS</option>
                    <option value="sistema">Sistema</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Departamento</label>
                  <select
                    className="w-full border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                    value={editingUser.department || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                  >
                    <option value="">Selecione...</option>
                    <option value="Comercial">Comercial</option>
                    <option value="Contabilidade">Contabilidade</option>
                    <option value="ERP">ERP</option>
                    <option value="Financeiro">Financeiro</option>
                    <option value="Fiscal">Fiscal</option>
                    <option value="Gerencia">Gerência</option>
                    <option value="Outro">Outro</option>
                    <option value="RH">RH</option>
                    <option value="Suporte">Suporte</option>
                    <option value="Vendas">Vendas</option>
                  </select>
                </div>
                <div className="sm:col-span-2 max-w-md">
                  <SecurePasswordInput
                    name={`edit_ts_pass_${editingUser.id}`}
                    label="Senha"
                    value={editingUser.password}
                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-end sm:justify-between">
              <DeleteConfirmationControl value={deleteUserConfirmation} onChange={(e) => setDeleteUserConfirmation(e.target.value)} onDelete={deleteEditedUser} disabled={isSaving} />
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={saveEditedUser}
                  className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSaving ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingServer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Editar servidor</h3>
              <button type="button" onClick={() => setEditingServer(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome do servidor</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingServer.name} onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">IP</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingServer.ip} onChange={(e) => setEditingServer({ ...editingServer, ip: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Porta interna</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingServer.internalPort} onChange={(e) => setEditingServer({ ...editingServer, internalPort: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Porta externa</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingServer.externalPort} onChange={(e) => setEditingServer({ ...editingServer, externalPort: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
                  <textarea rows={3} className="w-full border-slate-300 rounded-md shadow-sm p-2 border" value={editingServer.notes} onChange={(e) => setEditingServer({ ...editingServer, notes: e.target.value })}></textarea>
                </div>
              </div>

            </div>
            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-end sm:justify-between">
              <DeleteConfirmationControl value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} onDelete={deleteEditedServer} />
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditingServer(null)} className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">Cancelar</button>
                <button type="button" onClick={saveEditedServer} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Salvar alterações</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
