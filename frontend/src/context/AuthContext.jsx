import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { deriveMasterKey, unwrapMasterKey } from '../services/cryptoService';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  // A Master Key fica APENAS na memória do React. Nunca vai para o localStorage.
  const [masterKey, setMasterKey] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restaurar sessão do localStorage (exceto a Master Key)
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      // NOTA CRÍTICA: Se a página for recarregada (F5), a Master Key é perdida por segurança.
      // O usuário precisará redigitar a senha master para derivar a chave novamente
      // e poder descriptografar os dados do cofre.
    }
    
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      // 1. Fazer login na API
      const response = await api.post('/auth/login', { email, password });
      const { token: jwtToken, user: userData } = response.data;

      // 2. Salvar JWT e dados não sensíveis no localStorage
      localStorage.setItem('token', jwtToken);
      localStorage.setItem('user', JSON.stringify(userData));
      
      setToken(jwtToken);
      setUser(userData);

      // 3. ZERO-KNOWLEDGE: O login agora apenas autentica.
      // A Master Key real deve ser desenvelopada a partir do wrapped_key do usuário.
      // Se o usuário logou, ele terá que desbloquear o cofre depois.
      // NOTA: Se tivéssemos o wrapped_key no response do login, poderíamos desenvelopar aqui.
      // Por enquanto, vamos simular que o usuário precisa desbloquear explicitamente.
      
      return { success: true };
    } catch (error) {
      console.error('Erro no login:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Erro ao conectar com o servidor' 
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setMasterKey(null); // Limpar a chave da memória
  };

  // Função para solicitar a senha master e desenvelopar a Master Key real
  const unlockVault = async (password, wrappedKeyStr, saltStr) => {
    try {
      // 1. Derivar a KEK (Key Encryption Key) a partir da senha fornecida
      const kek = await deriveMasterKey(password, saltStr);
      
      // 2. Tentar desenvelopar a Master Key
      // Se a senha estiver errada, o unwrapKey falhará com erro criptográfico
      const key = await unwrapMasterKey(wrappedKeyStr, kek);
      
      // 3. Sucesso! Guardar na memória
      setMasterKey(key);
      return { success: true };
    } catch (error) {
      console.error("Falha no desbloqueio:", error);
      return { success: false, error: 'Senha mestre incorreta' };
    }
  };

  const value = {
    user,
    token,
    masterKey,
    isAuthenticated: !!token,
    isVaultUnlocked: !!masterKey,
    login,
    logout,
    unlockVault,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
