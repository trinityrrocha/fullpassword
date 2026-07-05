import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Server, Globe, Shield, HardDrive, Plus, Save, KeyRound } from 'lucide-react';
import SecurePasswordInput from '../components/SecurePasswordInput';
import { useAuth } from '../context/AuthContext';
import { encryptData, encryptFile, decryptData, base64ToBlob, downloadBlob } from '../services/cryptoService';
import api from '../services/api';

export default function ClientVault() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('cpanel');

  // Mock do cliente atual
  const client = { id, name: 'Acme Corp', address: 'Av. Paulista, 1000 - SP' };

  const tabs = [
    { id: 'cpanel', name: 'cPanel / Web', icon: Globe },
    { id: 'vpn', name: 'VPN', icon: Shield },
    { id: 'ts', name: 'Servidor TS', icon: Server },
    { id: 'servers', name: 'Servidores Diversos', icon: HardDrive },
  ];

  // ==========================================
  // ESTADOS DOS FORMULÁRIOS
  // ==========================================
  
  // Estado Aba 1: cPanel
  const [cpanelForm, setCpanelForm] = useState({
    url: '',
    username: '',
    password: '',
    email: '',
    emailPassword: '',
    isSystem: true
  });

  // Estado Aba 2: VPN
  const [vpnForm, setVpnForm] = useState({
    type: 'OpenVPN',
    username: '',
    password: '',
    port: '',
    vlan: '',
    personName: ''
  });

  // Estado Aba 3: Servidor TS
  const [tsForm, setTsForm] = useState({
    type: 'Windows',
    ip: '',
    domain: '',
    port: '',
    users: [{ id: Date.now(), name: '', login: '', password: '', permission: 'user' }]
  });

  // Estado Aba 4: Servidores Diversos
  const [serverForm, setServerForm] = useState({
    port: '',
    passwords: '',
    attachment: null
  });

  const { masterKey, isVaultUnlocked, unlockVault } = useAuth();
  const [unlockPassword, setUnlockPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [savedItems, setSavedItems] = useState([]);

  // ==========================================
  // CARREGAR E DESCRIPTOGRAFAR DADOS
  // ==========================================

  const loadVaultItems = async () => {
    if (!isVaultUnlocked) return;
    
    setIsLoading(true);
    try {
      const response = await api.get(`/vault-items/${id}`);
      const items = response.data;
      
      const decryptedItems = [];
      
      // Descriptografar cada item
      for (const item of items) {
        try {
          const decryptedData = await decryptData(item.encrypted_data, masterKey);
          decryptedItems.push({
            ...item,
            decrypted: decryptedData
          });
          
          // Popular os formulários com o dado mais recente de cada categoria
          if (item.category === 'cPanel') setCpanelForm(decryptedData);
          if (item.category === 'VPN') setVpnForm(decryptedData);
          if (item.category === 'Servidor TS') setTsForm(decryptedData);
          if (item.category === 'Servidores Diversos') {
            setServerForm({
              ...decryptedData,
              attachment: null // Arquivos não são populados de volta no input file
            });
          }
        } catch (err) {
          console.error(`Falha ao descriptografar item ${item.id}:`, err);
          // Adicionar item mesmo com falha para mostrar que existe, mas não pôde ser lido
          decryptedItems.push({ ...item, decryptError: true });
        }
      }
      
      setSavedItems(decryptedItems);
    } catch (error) {
      console.error('Erro ao carregar itens do cofre:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Carregar dados quando o cofre for desbloqueado ou o ID mudar
  useEffect(() => {
    if (isVaultUnlocked) {
      loadVaultItems();
    }
  }, [id, isVaultUnlocked]);

  // ==========================================
  // HANDLERS DE CRIPTOGRAFIA E SALVAMENTO
  // ==========================================

  const handleSaveData = async (category, data) => {
    if (!isVaultUnlocked) {
      alert("Cofre bloqueado. Por favor, insira sua senha mestre para continuar.");
      return;
    }

    setIsSaving(true);
    try {
      // Separar metadados não sensíveis para busca
      const metadata = {
        category,
        description: data.type || data.url || data.port || 'Registro do cofre',
        timestamp: new Date().toISOString()
      };

      // Se for a aba de Servidores e tiver anexo
      let encryptedAttachment = null;
      let dataToEncrypt = { ...data };
      
      if (category === 'Servidores Diversos' && data.attachment) {
        // Criptografar o arquivo separadamente
        encryptedAttachment = await encryptFile(data.attachment, masterKey);
        // Remover o File object do JSON que será criptografado
        delete dataToEncrypt.attachment;
        dataToEncrypt.hasAttachment = true;
        dataToEncrypt.attachmentName = data.attachment.name;
      }

      // 1. Criptografar os dados com a Master Key (Zero-Knowledge)
      const encryptedData = await encryptData(dataToEncrypt, masterKey);

      // 2. Preparar payload
      const payload = {
        category,
        encrypted_data: encryptedData,
        encrypted_attachment: encryptedAttachment,
        metadata
      };

      // 3. Enviar para o backend via Axios
      await api.post(`/vault-items/${id}`, payload);
      
      alert(`Dados de ${category} salvos com sucesso e criptografados localmente!`);
      
    } catch (error) {
      console.error('Erro ao salvar no cofre:', error);
      alert('Erro ao salvar os dados. Verifique o console.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    // NOTA: Em um cenário real, `wrappedKeyStr` e `saltStr` devem vir do perfil do usuário via API.
    // Como o backend atual ainda não os fornece, usaremos valores simulados para garantir
    // que a arquitetura criptográfica funcione no frontend sem quebrar a aplicação atual.
    // Na Fase 40 ajustaremos o backend para fornecê-los.
    const userWrappedKey = localStorage.getItem('user_wrapped_key');
    const userSalt = localStorage.getItem('user_salt') || 'fullpassword-salt-super-seguro-123';
    
    if (!userWrappedKey) {
      alert("Erro crítico: Chave envelopada do usuário não encontrada. Faça login novamente ou recadastre o usuário.");
      return;
    }

    const result = await unlockVault(unlockPassword, userWrappedKey, userSalt);
    if (!result.success) {
      alert(result.error); // Exibirá "Senha mestre incorreta"
    } else {
      setUnlockPassword('');
    }
  };

  const handleDownloadAttachment = async (item) => {
    if (!item.encrypted_attachment) return;
    
    try {
      // 1. Descriptografar o anexo
      const decryptedFile = await decryptData(item.encrypted_attachment, masterKey);
      
      // 2. Converter Base64 de volta para Blob
      const blob = base64ToBlob(decryptedFile.data);
      
      // 3. Fazer o download
      downloadBlob(blob, decryptedFile.name);
    } catch (error) {
      console.error('Erro ao descriptografar anexo:', error);
      alert('Erro ao descriptografar o anexo. A chave pode estar incorreta.');
    }
  };

  const addTsUser = () => {
    setTsForm({
      ...tsForm,
      users: [...tsForm.users, { id: Date.now(), name: '', login: '', password: '', permission: 'user' }]
    });
  };

  const updateTsUser = (id, field, value) => {
    setTsForm({
      ...tsForm,
      users: tsForm.users.map(u => u.id === id ? { ...u, [field]: value } : u)
    });
  };

  const removeTsUser = (id) => {
    setTsForm({
      ...tsForm,
      users: tsForm.users.filter(u => u.id !== id)
    });
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
            Sua chave de criptografia foi removida da memória. 
            Insira sua senha mestre novamente para derivar a chave e desbloquear o cofre.
          </p>
        </div>
        
        <form onSubmit={handleUnlock} className="space-y-4">
          <SecurePasswordInput 
            name="unlock_password" 
            label="Senha Mestre" 
            value={unlockPassword} 
            onChange={(e) => setUnlockPassword(e.target.value)} 
            required 
          />
          <button 
            type="submit" 
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Desbloquear Cofre
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{client.name}</h1>
          <p className="text-sm text-slate-500">Cofre de Senhas e Credenciais</p>
        </div>
      </div>

      {/* Navegação de Abas */}
      <div className="bg-white shadow rounded-lg border border-slate-200 overflow-hidden">
        <div className="border-b border-slate-200">
          <nav className="flex -mb-px overflow-x-auto" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex-1 min-w-0 py-4 px-4 text-center text-sm font-medium border-b-2 whitespace-nowrap flex items-center justify-center gap-2
                  ${activeTab === tab.id 
                    ? 'border-indigo-500 text-indigo-600' 
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }
                `}
              >
                <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-indigo-500' : 'text-slate-400'}`} />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        {/* Conteúdo das Abas */}
        <div className="p-6">
          
          {/* ABA 1: cPanel */}
          {activeTab === 'cpanel' && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2">Acesso ao cPanel / Hospedagem</h3>
              
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Endereço do cPanel (URL)</label>
                  <input type="url" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={cpanelForm.url} onChange={e => setCpanelForm({...cpanelForm, url: e.target.value})} placeholder="https://cpanel.dominio.com.br" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Usuário</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={cpanelForm.username} onChange={e => setCpanelForm({...cpanelForm, username: e.target.value})} />
                </div>
                
                <div>
                  <SecurePasswordInput name="cpanel_pass" label="Senha do cPanel" 
                    value={cpanelForm.password} onChange={e => setCpanelForm({...cpanelForm, password: e.target.value})} />
                </div>
              </div>

              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2 mt-8">E-mail Principal</h3>
              
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">E-mail / Usuário</label>
                  <input type="email" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={cpanelForm.email} onChange={e => setCpanelForm({...cpanelForm, email: e.target.value})} />
                </div>
                
                <div>
                  <SecurePasswordInput name="email_pass" label="Senha do E-mail" 
                    value={cpanelForm.emailPassword} onChange={e => setCpanelForm({...cpanelForm, emailPassword: e.target.value})} />
                </div>

                <div className="sm:col-span-2 flex items-center mt-2">
                  <span className="mr-3 text-sm font-medium text-slate-700">Tipo de Acesso:</span>
                  <div className="flex items-center space-x-4">
                    <label className="inline-flex items-center">
                      <input type="radio" className="form-radio text-indigo-600 focus:ring-indigo-500" 
                        checked={cpanelForm.isSystem} onChange={() => setCpanelForm({...cpanelForm, isSystem: true})} />
                      <span className="ml-2 text-sm text-slate-700">Sistema</span>
                    </label>
                    <label className="inline-flex items-center">
                      <input type="radio" className="form-radio text-indigo-600 focus:ring-indigo-500" 
                        checked={!cpanelForm.isSystem} onChange={() => setCpanelForm({...cpanelForm, isSystem: false})} />
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

          {/* ABA 2: VPN */}
          {activeTab === 'vpn' && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2">Configuração de VPN</h3>
              
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de VPN</label>
                  <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    value={vpnForm.type} onChange={e => setVpnForm({...vpnForm, type: e.target.value})}>
                    <option>OpenVPN</option>
                    <option>WireGuard</option>
                    <option>ZeroTier</option>
                    <option>Radmin</option>
                    <option>Outro</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Porta</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={vpnForm.port} onChange={e => setVpnForm({...vpnForm, port: e.target.value})} placeholder="Ex: 1194" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VLAN</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={vpnForm.vlan} onChange={e => setVpnForm({...vpnForm, vlan: e.target.value})} placeholder="Ex: 10.8.0.0/24" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Usuário VPN</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={vpnForm.username} onChange={e => setVpnForm({...vpnForm, username: e.target.value})} />
                </div>

                <div>
                  <SecurePasswordInput name="vpn_pass" label="Senha VPN" 
                    value={vpnForm.password} onChange={e => setVpnForm({...vpnForm, password: e.target.value})} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Pessoa Vinculada</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={vpnForm.personName} onChange={e => setVpnForm({...vpnForm, personName: e.target.value})} placeholder="Nome de quem usa" />
                </div>
              </div>

              <div className="pt-5 flex justify-end">
                <button disabled={isSaving} onClick={() => handleSaveData('VPN', vpnForm)} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                  <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Criptografando...' : 'Salvar VPN'}
                </button>
              </div>
            </div>
          )}

          {/* ABA 3: Servidor TS */}
          {activeTab === 'ts' && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2">Servidor Terminal Service / SSH</h3>
              
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sistema Operacional</label>
                  <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    value={tsForm.type} onChange={e => setTsForm({...tsForm, type: e.target.value})}>
                    <option>Windows</option>
                    <option>Linux SSH</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">IP do Servidor</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={tsForm.ip} onChange={e => setTsForm({...tsForm, ip: e.target.value})} placeholder="192.168.1.100" />
                </div>

                {tsForm.type === 'Windows' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Domínio (Opcional)</label>
                    <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                      value={tsForm.domain} onChange={e => setTsForm({...tsForm, domain: e.target.value})} placeholder="CORP" />
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Porta</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={tsForm.port} onChange={e => setTsForm({...tsForm, port: e.target.value})} placeholder={tsForm.type === 'Windows' ? '3389' : '22'} />
                </div>
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-md font-medium text-slate-800">Usuários de Acesso</h4>
                  <button onClick={addTsUser} type="button" className="inline-flex items-center px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
                    <Plus className="w-4 h-4 mr-1" /> Adicionar Usuário
                  </button>
                </div>

                <div className="space-y-4">
                  {tsForm.users.map((user, index) => (
                    <div key={user.id} className="flex flex-wrap items-end gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-medium text-slate-500 mb-1">Nome / Descrição</label>
                        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border text-sm" 
                          value={user.name} onChange={e => updateTsUser(user.id, 'name', e.target.value)} placeholder="Ex: João Silva" />
                      </div>
                      <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-medium text-slate-500 mb-1">Login</label>
                        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border text-sm" 
                          value={user.login} onChange={e => updateTsUser(user.id, 'login', e.target.value)} />
                      </div>
                      <div className="flex-1 min-w-[200px]">
                        <SecurePasswordInput name={`ts_pass_${user.id}`} label="" placeholder="Senha"
                          value={user.password} onChange={e => updateTsUser(user.id, 'password', e.target.value)} />
                      </div>
                      <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-medium text-slate-500 mb-1">Permissão</label>
                        <select className="w-full border-slate-300 rounded-md shadow-sm p-2 border text-sm bg-white"
                          value={user.permission} onChange={e => updateTsUser(user.id, 'permission', e.target.value)}>
                          <option value="admin">Admin</option>
                          <option value="user">User</option>
                          <option value="user+TS">User + TS</option>
                          <option value="admin+TS">Admin + TS</option>
                          <option value="sistema">Sistema</option>
                        </select>
                      </div>
                      {tsForm.users.length > 1 && (
                        <button onClick={() => removeTsUser(user.id)} type="button" className="p-2 text-red-500 hover:bg-red-50 rounded-md">
                          Remover
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-5 flex justify-between items-center">
                <button type="button" onClick={() => handleShareClick('Servidor TS')} className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
                  <Share2 className="w-4 h-4 mr-2 text-indigo-500" /> Compartilhar
                </button>
                <button disabled={isSaving} onClick={() => handleSaveData('Servidor TS', tsForm)} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                  <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Criptografando...' : 'Salvar Servidor TS'}
                </button>
              </div>
            </div>
          )}

          {/* ABA 4: Servidores Diversos */}
          {activeTab === 'servers' && (
            <div className="space-y-6 animate-fadeIn">
              <h3 className="text-lg font-medium leading-6 text-slate-900 border-b pb-2">Servidores Diversos / Anotações</h3>
              
              <div className="grid grid-cols-1 gap-y-6 gap-x-4">
                <div className="sm:w-1/3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Porta Principal</label>
                  <input type="text" className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" 
                    value={serverForm.port} onChange={e => setServerForm({...serverForm, port: e.target.value})} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Senhas e Anotações Livres</label>
                  <textarea rows={6} className="w-full border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                    value={serverForm.passwords} onChange={e => setServerForm({...serverForm, passwords: e.target.value})} 
                    placeholder="Cole aqui múltiplas senhas, chaves de API, etc..."></textarea>
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
                          <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".txt,.pem,.key,.csv"
                            onChange={e => setServerForm({...serverForm, attachment: e.target.files[0]})} />
                        </label>
                      </div>
                      <p className="text-xs text-slate-500">
                        {serverForm.attachment ? `Arquivo selecionado: ${serverForm.attachment.name}` : 'Apenas arquivos de texto até 5MB'}
                      </p>
                      <p className="text-xs text-indigo-500 font-medium">
                        O arquivo será convertido para base64 e criptografado localmente.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-5 flex justify-between items-center">
                <button type="button" onClick={() => handleShareClick('Servidores Diversos')} className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
                  <Share2 className="w-4 h-4 mr-2 text-indigo-500" /> Compartilhar
                </button>
                <button disabled={isSaving} onClick={() => handleSaveData('Servidores Diversos', serverForm)} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                  <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Criptografando...' : 'Salvar Servidores'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
