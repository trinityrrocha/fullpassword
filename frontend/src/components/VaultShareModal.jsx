import { useState, useEffect } from 'react';
import { X, Share2, Users, User, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { encryptData, importPublicKey } from '../services/cryptoService';

const VaultShareModal = ({ isOpen, onClose, vaultItem, onShareSuccess }) => {
  const { masterKey } = useAuth();
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadData();
      setSelectedUsers([]);
      setSelectedGroups([]);
      setError('');
    }
  }, [isOpen]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [usersRes, groupsRes] = await Promise.all([
        api.get('/users'),
        api.get('/groups')
      ]);
      
      // Filtrar apenas usuários ativos que possuem chave pública e não são o criador do cofre
      const eligibleUsers = usersRes.data.filter(u => 
        u.is_active && 
        u.public_key && 
        u.id !== vaultItem.created_by
      );
      
      setUsers(eligibleUsers);
      setGroups(groupsRes.data);
    } catch (err) {
      console.error("Erro ao carregar usuários/grupos:", err);
      setError("Falha ao carregar lista de usuários e grupos.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleUser = (userId) => {
    setSelectedUsers(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleToggleGroup = (groupId) => {
    setSelectedGroups(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleShare = async () => {
    if (selectedUsers.length === 0 && selectedGroups.length === 0) {
      setError("Selecione pelo menos um usuário ou grupo.");
      return;
    }

    setIsSharing(true);
    setError('');

    try {
      // 1. Descriptografar o dado do cofre original para extrair a chave simétrica ou o próprio dado
      // No nosso modelo atual (Client-Side), o dado já foi criptografado com a Master Key do criador.
      // Para compartilhar, o criador (que está logado e tem a masterKey) precisa recriptografar
      // o dado (ou a chave dele) para as chaves públicas dos destinatários.
      
      // Como o vault_items guarda `encrypted_data` (criptografado com a masterKey do criador),
      // precisamos:
      // a) O criador não compartilha a masterKey dele!
      // b) Ele gera uma chave aleatória para este item (Vault Key) OU
      // c) Ele descriptografa o item com sua masterKey e recriptografa com a chave pública do destinatário.
      // 
      // Para manter a eficiência, vamos descriptografar o item e recriptografar com a public key do destino.
      // (Em um modelo mais avançado, usaríamos uma Vault Key simétrica única por item).
      
      // Vamos simular o processo: no componente pai (ClientVault), o item foi descriptografado.
      // Aqui, vamos recriptografar o JSON original (que deve ser passado como prop `decryptedData`) 
      // com a chave pública de cada destinatário.
      
      if (!vaultItem.decryptedData) {
        throw new Error("Dados descriptografados não fornecidos para compartilhamento.");
      }

      const jsonString = JSON.stringify(vaultItem.decryptedData);

      // Expandir usuários dos grupos selecionados
      let finalUserIds = new Set([...selectedUsers]);
      
      selectedGroups.forEach(groupId => {
        const group = groups.find(g => g.id === groupId);
        if (group && group.users) {
          group.users.forEach(u => {
            // Só adicionar se o usuário existir na nossa lista de elegíveis (ativos com public_key)
            if (users.some(eligible => eligible.id === u.id)) {
              finalUserIds.add(u.id);
            }
          });
        }
      });

      const userIdsArray = Array.from(finalUserIds);
      
      if (userIdsArray.length === 0) {
        throw new Error("Nenhum usuário elegível (com chave pública) encontrado na seleção.");
      }

      const sharesPayload = [];

      for (const userId of userIdsArray) {
        const targetUser = users.find(u => u.id === userId);
        if (!targetUser || !targetUser.public_key) continue;

        // Importar a chave pública do destinatário
        const publicKey = await importPublicKey(targetUser.public_key);
        
        // Criptografar o dado com a chave pública RSA
        // IMPORTANTE: RSA só criptografa pequenos volumes de dados. 
        // Se o JSON for grande, devemos gerar uma chave AES simétrica, criptografar o JSON com ela,
        // e criptografar a chave AES com a RSA.
        // Para este MVP, assumimos que encryptData usa a chave AES (Master Key).
        // Como a arquitetura pede: "A chave simétrica do cofre criptografada com a Chave Pública RSA"
        
        // Passo A: Gerar uma Vault Key simétrica temporária para este item
        const vaultKeyBuffer = window.crypto.getRandomValues(new Uint8Array(32));
        const vaultKeyBase64 = btoa(String.fromCharCode.apply(null, vaultKeyBuffer));
        
        // Passo B: Criptografar a Vault Key com a Chave Pública RSA do destinatário
        const encodedVaultKey = new TextEncoder().encode(vaultKeyBase64);
        const encryptedVaultKeyBuffer = await window.crypto.subtle.encrypt(
          { name: "RSA-OAEP" },
          publicKey,
          encodedVaultKey
        );
        const encryptedVaultKeyBase64 = btoa(String.fromCharCode.apply(null, new Uint8Array(encryptedVaultKeyBuffer)));

        sharesPayload.push({
          userId: userId,
          encryptedVaultKey: encryptedVaultKeyBase64
        });
      }

      // Enviar para a API
      await api.post(`/vault-items/${vaultItem.id}/share`, { shares: sharesPayload });
      
      onShareSuccess();
      onClose();
    } catch (err) {
      console.error("Erro no compartilhamento:", err);
      setError(err.message || "Erro ao processar o compartilhamento criptográfico.");
    } finally {
      setIsSharing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Compartilhar Cofre</h2>
              <p className="text-sm text-slate-500">
                {vaultItem?.category || 'Item'} (Criptografia RSA-OAEP)
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3">
              <AlertCircle size={20} />
              <p>{error}</p>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : (
            <div className="space-y-8">
              
              {/* Seleção de Grupos */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Users size={16} />
                  Grupos de Equipe
                </h3>
                {groups.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">Nenhum grupo cadastrado.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {groups.map(group => (
                      <label 
                        key={group.id} 
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedGroups.includes(group.id) 
                            ? 'bg-indigo-50 border-indigo-200' 
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input 
                          type="checkbox" 
                          className="mt-1 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                          checked={selectedGroups.includes(group.id)}
                          onChange={() => handleToggleGroup(group.id)}
                        />
                        <div>
                          <div className="font-medium text-slate-800">{group.name}</div>
                          <div className="text-xs text-slate-500">{group.users?.length || 0} membros</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Seleção de Usuários */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <User size={16} />
                  Usuários Individuais
                </h3>
                {users.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">Nenhum usuário elegível encontrado.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {users.map(user => (
                      <label 
                        key={user.id} 
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedUsers.includes(user.id) 
                            ? 'bg-indigo-50 border-indigo-200' 
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input 
                          type="checkbox" 
                          className="mt-1 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                          checked={selectedUsers.includes(user.id)}
                          onChange={() => handleToggleUser(user.id)}
                        />
                        <div>
                          <div className="font-medium text-slate-800">{user.name}</div>
                          <div className="text-xs text-slate-500">{user.email}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
            disabled={isSharing}
          >
            Cancelar
          </button>
          <button 
            onClick={handleShare}
            disabled={isSharing || (selectedUsers.length === 0 && selectedGroups.length === 0)}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSharing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Criptografando...
              </>
            ) : (
              <>
                <Share2 size={18} />
                Compartilhar Cofre
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default VaultShareModal;
