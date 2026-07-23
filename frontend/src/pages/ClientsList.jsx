import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Search, Plus, Pencil, Eye, Trash2, X, Loader2 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { decryptData } from '../services/cryptoService';
import { decryptVaultKeyShare } from '../services/clientVaultKeyService';

const formatDate = (value) => {
  if (!value) return 'Não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Não informado' : new Intl.DateTimeFormat('pt-BR').format(date);
};

const countList = (value) => Array.isArray(value) ? value.length : 0;

const summarizeModule = (moduleId, data = {}) => {
  if (moduleId === 'cpanelWeb') {
    const domains = Array.isArray(data.cpanels) ? data.cpanels.length : (data.url || data.username || data.email ? 1 : 0);
    const users = Array.isArray(data.users) ? data.users.length : (data.email ? 1 : 0);
    return domains || users ? `Servidor hospedagem possui ${domains} domínio(s) e ${users} usuário(s)` : 'Servidor hospedagem não possui domínio cadastrado';
  }
  if (moduleId === 'vpn') {
    const servers = Array.isArray(data.servers) ? data.servers.length : (data.type || data.port || data.vlan ? 1 : 0);
    const users = Array.isArray(data.users) ? data.users.length : (data.username || data.personName || data.password ? 1 : 0);
    return servers || users ? `VPN possui ${servers} servidor(es) e ${users} usuário(s)` : 'VPN não possui servidor cadastrado';
  }
  if (moduleId === 'windowsServer') {
    const servers = Array.isArray(data.servers) ? data.servers.length : (data.ip || data.port || data.domain ? 1 : 0);
    const users = countList(data.users);
    return servers || users ? `Servidor Windows possui ${servers} servidor(es) e ${users} usuário(s)` : 'Servidor Windows não possui servidor cadastrado';
  }
  const servers = Array.isArray(data.servers) ? data.servers.length : (data.port || data.notes || data.annotations || data.hasAttachment ? 1 : 0);
  const users = Array.isArray(data.sshCredentials) ? data.sshCredentials.length : countList(data.users);
  return servers || users ? `Servidor Linux possui ${servers} servidor(es) e ${users} usuário(s)` : 'Servidor Linux não tem servidor';
};

const SUMMARY_MODULES = [
  { id: 'cpanelWeb', label: 'Servidor hospedagem', categories: ['cPanel'] },
  { id: 'vpn', label: 'VPN', categories: ['VPN'] },
  { id: 'windowsServer', label: 'Servidor Windows', categories: ['Servidor TS'] },
  { id: 'linuxServer', label: 'Servidor Linux', categories: ['Servidor Linux', 'Servidores Diversos'] }
];

export default function ClientsList() {
  const { user, masterKey, unlockVault } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [viewClient, setViewClient] = useState(null);
  const [viewSummary, setViewSummary] = useState({ loading: false, lines: [], error: '' });
  const [unlockClient, setUnlockClient] = useState(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [newClient, setNewClient] = useState({
    name: '',
    address: '',
    phone: '',
    email: ''
  });

  const loadClients = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/clients');
      setClients(response.data || []);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      alert('Não foi possível carregar a lista de clientes.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.get('/clients')
      .then((response) => {
        if (!cancelled) setClients(response.data || []);
      })
      .catch((error) => {
        console.error('Erro ao carregar clientes:', error);
        if (!cancelled) alert('Não foi possível carregar a lista de clientes.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredClients = clients.filter(client => 
    client.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateClient = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.post('/clients', newClient);
      alert('Cliente criado com sucesso!');
      setIsModalOpen(false);
      setNewClient({ name: '', address: '', phone: '', email: '' });
      loadClients(); // Recarrega a lista
    } catch (error) {
      console.error('Erro ao criar cliente:', error);
      alert(error.response?.data?.error || 'Erro ao criar cliente.');
    } finally {
      setIsSaving(false);
    }
  };

  const loadClientSummary = async (client, activeMasterKey = masterKey, activeUser = user) => {
    setViewSummary({ loading: true, lines: [], error: '' });
    if (!activeMasterKey || !activeUser) {
      setViewSummary({ loading: false, lines: [], error: 'Não foi possível abrir o resumo deste cofre. Verifique a senha informada.' });
      return;
    }

    try {
      const [permissionsResponse, keyResponse] = await Promise.all([
        api.get(`/vault-items/${client.id}/permissions`),
        api.get(`/vault-items/${client.id}/key-share`)
      ]);
      const permissions = permissionsResponse.data || {};
      let vaultKey = null;

      if (keyResponse.data?.encrypted_client_key) {
        if (!activeUser.encrypted_private_key) throw new Error('Chave privada indisponível');
        vaultKey = await decryptVaultKeyShare(keyResponse.data.encrypted_client_key, activeUser.encrypted_private_key, activeMasterKey);
      } else if (permissions.is_owner === true || permissions.isOwner === true) {
        vaultKey = activeMasterKey;
      }

      if (!vaultKey) throw new Error('Chave do cofre indisponível');

      const itemsResponse = await api.get(`/vault-items/${client.id}`);
      const items = itemsResponse.data || [];
      const lines = [];
      let decryptedModules = 0;
      let decryptionFailures = 0;

      for (const module of SUMMARY_MODULES) {
        const item = items.find((candidate) => module.categories.includes(candidate.category));
        if (!item) {
          lines.push(summarizeModule(module.id));
          continue;
        }
        try {
          const decrypted = await decryptData(item.encrypted_data, vaultKey);
          lines.push(summarizeModule(module.id, decrypted));
          decryptedModules += 1;
        } catch (error) {
          decryptionFailures += 1;
          console.warn('Não foi possível carregar o resumo criptografado do módulo.', {
            clientId: client.id,
            moduleId: module.id,
            itemId: item.id,
            errorName: error?.name || 'Error'
          });
          lines.push(`${module.label}: Não foi possível carregar o resumo deste módulo.`);
        }
      }
      if (decryptionFailures > 0 && decryptedModules === 0) {
        setViewSummary({ loading: false, lines: [], error: 'Não foi possível abrir o resumo deste cofre. Verifique a senha informada.' });
        return;
      }
      setViewSummary({ loading: false, lines, error: '' });
    } catch (error) {
      console.warn('Resumo seguro do cofre indisponível.', { clientId: client.id, errorName: error?.name || 'Error' });
      setViewSummary({ loading: false, lines: [], error: 'Não foi possível abrir o resumo deste cofre. Verifique a senha informada.' });
    }
  };

  const openViewClient = (client) => {
    if (!masterKey) {
      setUnlockClient(client);
      setUnlockPassword('');
      setUnlockError('');
      return;
    }
    setViewClient(client);
    loadClientSummary(client, masterKey, user);
  };

  const closeUnlockModal = () => {
    if (isUnlocking) return;
    setUnlockClient(null);
    setUnlockPassword('');
    setUnlockError('');
  };

  const unlockClientPreview = async (event) => {
    event.preventDefault();
    if (!unlockClient || isUnlocking) return;

    if (!user?.wrapped_key || !user?.crypto_salt) {
      setUnlockError('Chave criptográfica indisponível. Faça login novamente para desbloquear o cofre.');
      return;
    }

    setIsUnlocking(true);
    setUnlockError('');
    const client = unlockClient;
    try {
      const result = await unlockVault(unlockPassword, user.wrapped_key, user.crypto_salt);
      if (!result.success || !result.key) {
        setUnlockError('Não foi possível abrir o resumo deste cofre. Verifique a senha informada.');
        return;
      }

      setUnlockClient(null);
      setUnlockPassword('');
      setViewClient(client);
      await loadClientSummary(client, result.key, result.user || user);
    } finally {
      setIsUnlocking(false);
    }
  };

  const openEditClient = (client) => {
    setDeleteConfirmation('');
    setEditClient({ ...client, name: client.name || '', address: client.address || '', phone: client.phone || '', email: client.email || '' });
  };

  const saveClient = async (event) => {
    event.preventDefault();
    if (!editClient) return;
    setIsSaving(true);
    try {
      const response = await api.put(`/clients/${editClient.id}`, {
        name: editClient.name,
        address: editClient.address,
        phone: editClient.phone,
        email: editClient.email
      });
      setClients((current) => current.map((client) => client.id === editClient.id ? { ...client, ...response.data } : client));
      setEditClient(null);
    } catch (error) {
      alert(error.response?.data?.error || 'Não foi possível atualizar o cliente.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteClient = async () => {
    if (!editClient || deleteConfirmation.trim() !== 'EXCLUIR') return;
    setIsSaving(true);
    try {
      await api.delete(`/clients/${editClient.id}`, { data: { confirmation: deleteConfirmation.trim() } });
      setClients((current) => current.filter((client) => client.id !== editClient.id));
      setEditClient(null);
      setDeleteConfirmation('');
    } catch (error) {
      alert(error.response?.data?.error || 'Não foi possível excluir o cliente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">Selecione um cliente para acessar seu cofre de senhas</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Cliente
        </button>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden border border-slate-200">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <div className="relative rounded-md shadow-sm max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md p-2 border"
              placeholder="Buscar cliente por nome..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <ul className="divide-y divide-slate-200">
          {isLoading ? (
            <li className="px-4 py-8 text-center text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
              Carregando clientes...
            </li>
          ) : filteredClients.length === 0 ? (
            <li className="px-4 py-8 text-center text-slate-500">
              Nenhum cliente encontrado.
            </li>
          ) : filteredClients.map((client) => {
            const canEdit = client.is_owner || client.is_admin || client.can_edit;
            return (
              <li key={client.id} className="flex h-11 items-center gap-2 px-4 hover:bg-slate-50 sm:px-6">
                <Link to={`/client/${client.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-1">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-indigo-100">
                    <Building2 className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="truncate text-sm font-medium leading-tight text-indigo-600">{client.name}</div>
                    <div className="truncate text-xs leading-tight text-slate-500">{client.address || 'Endereço não informado'}</div>
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {canEdit && <button type="button" title="Alterar cliente" aria-label="Alterar cliente" onClick={() => openEditClient(client)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
                  <button type="button" title="Visualizar cliente" aria-label="Visualizar cliente" onClick={() => openViewClient(client)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><Eye className="h-4 w-4" /></button>
                </div>
              </li>
            );
          })}

        </ul>
      </div>

      {unlockClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="unlock-client-title" onClick={closeUnlockModal}>
          <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 id="unlock-client-title" className="text-lg font-semibold text-slate-900">Desbloquear cofre</h2>
              <button type="button" title="Fechar" aria-label="Fechar" onClick={closeUnlockModal} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={unlockClientPreview}>
              <div className="space-y-4 p-6">
                <p className="text-sm text-slate-600">Informe a senha do cofre para visualizar o resumo desta empresa.</p>
                <div>
                  <label htmlFor="clientPreviewPassword" className="mb-1 block text-sm font-medium text-slate-700">Senha do cofre</label>
                  <input id="clientPreviewPassword" type="password" required autoFocus autoComplete="current-password" value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)} className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                {unlockError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{unlockError}</p>}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
                <button type="button" onClick={closeUnlockModal} disabled={isUnlocking} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isUnlocking} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{isUnlocking ? 'Validando...' : 'Visualizar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="view-client-title" onClick={() => setViewClient(null)}>
          <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 id="view-client-title" className="text-lg font-semibold text-slate-900">Visualizar cliente</h2>
              <button type="button" title="Fechar" aria-label="Fechar" onClick={() => setViewClient(null)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[75vh] space-y-6 overflow-y-auto p-6">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Nome da empresa</dt><dd className="mt-1 text-sm text-slate-900">{viewClient.name || 'Não informado'}</dd></div>
                <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Endereço</dt><dd className="mt-1 text-sm text-slate-900">{viewClient.address || 'Não informado'}</dd></div>
                <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Contato</dt><dd className="mt-1 text-sm text-slate-900">{[viewClient.phone, viewClient.email].filter(Boolean).join(' · ') || 'Não informado'}</dd></div>
                <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Data do cadastro</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(viewClient.created_at)}</dd></div>
                <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Cadastrado por</dt><dd className="mt-1 text-sm text-slate-900">{viewClient.created_by_name || 'Não informado'}</dd></div>
              </dl>
              <section>
                <h3 className="text-sm font-semibold text-slate-900">Resumo do cofre</h3>
                {viewSummary.loading ? <p className="mt-3 text-sm text-slate-500">Carregando resumo seguro...</p> : viewSummary.error ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{viewSummary.error}</p> : (
                  <ul className="mt-3 space-y-2">{viewSummary.lines.map((line) => <li key={line} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{line}</li>)}</ul>
                )}
              </section>
            </div>
            <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-6 py-3"><button type="button" onClick={() => setViewClient(null)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Fechar</button></div>
          </div>
        </div>
      )}

      {editClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-client-title" onClick={() => setEditClient(null)}>
          <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 id="edit-client-title" className="text-lg font-semibold text-slate-900">Alterar cliente</h2>
              <button type="button" title="Fechar" aria-label="Fechar" onClick={() => setEditClient(null)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form id="editClientForm" onSubmit={saveClient} className="max-h-[75vh] space-y-4 overflow-y-auto p-6">
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Nome da empresa</label><input required value={editClient.name} onChange={(event) => setEditClient({ ...editClient, name: event.target.value })} className="w-full rounded-md border border-slate-300 p-2" /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Endereço</label><input value={editClient.address} onChange={(event) => setEditClient({ ...editClient, address: event.target.value })} className="w-full rounded-md border border-slate-300 p-2" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="mb-1 block text-sm font-medium text-slate-700">Telefone</label><input value={editClient.phone} onChange={(event) => setEditClient({ ...editClient, phone: event.target.value })} className="w-full rounded-md border border-slate-300 p-2" /></div>
                <div><label className="mb-1 block text-sm font-medium text-slate-700">E-mail de contato</label><input type="email" value={editClient.email} onChange={(event) => setEditClient({ ...editClient, email: event.target.value })} className="w-full rounded-md border border-slate-300 p-2" /></div>
              </div>
            </form>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
              {(editClient.is_owner || editClient.is_admin || editClient.can_delete) && (
                <>
                  <button type="button" title="Excluir empresa" aria-label="Excluir empresa" disabled={deleteConfirmation.trim() !== 'EXCLUIR' || isSaving} onClick={deleteClient} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
                  <label htmlFor="deleteClientConfirmation" className="sr-only">Digite EXCLUIR para confirmar a exclusão da empresa</label>
                  <input id="deleteClientConfirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="EXCLUIR" title="Digite EXCLUIR para confirmar a exclusão da empresa" autoComplete="off" className="h-9 w-28 rounded-md border border-red-300 bg-white px-2 text-sm" />
                </>
              )}
              <button type="button" onClick={() => setEditClient(null)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
              <button type="submit" form="editClientForm" disabled={isSaving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Novo Cliente */}
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
                    Cadastrar Novo Cliente
                  </h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-500">
                    <X className="h-6 w-6" />
                  </button>
                </div>
                
                <form id="newClientForm" onSubmit={handleCreateClient} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Empresa</label>
                    <input 
                      type="text" 
                      required
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={newClient.name}
                      onChange={e => setNewClient({...newClient, name: e.target.value})}
                      placeholder="Ex: Acme Corp"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Endereço Completo</label>
                    <input 
                      type="text" 
                      className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={newClient.address}
                      onChange={e => setNewClient({...newClient, address: e.target.value})}
                      placeholder="Rua, Número, Bairro, Cidade - UF"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                      <input 
                        type="text" 
                        className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                        value={newClient.phone}
                        onChange={e => setNewClient({...newClient, phone: e.target.value})}
                        placeholder="(00) 0000-0000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">E-mail de Contato</label>
                      <input 
                        type="email" 
                        className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                        value={newClient.email}
                        onChange={e => setNewClient({...newClient, email: e.target.value})}
                        placeholder="contato@empresa.com.br"
                      />
                    </div>
                  </div>
                </form>
              </div>
              <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button 
                  type="submit" 
                  form="newClientForm"
                  disabled={isSaving}
                  className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
                  ) : 'Salvar Cliente'}
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
