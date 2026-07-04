import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { deriveMasterKey } from '../services/cryptoService';

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

      // 3. ZERO-KNOWLEDGE: Derivar a Master Key a partir da senha em texto claro
      // e guardar APENAS no estado do React (memória)
      const key = await deriveMasterKey(password);
      setMasterKey(key);

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

  // Função para solicitar a senha master novamente (caso a página tenha sido recarregada)
  const unlockVault = async (password) => {
    try {
      const key = await deriveMasterKey(password);
      setMasterKey(key);
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Erro ao gerar chave mestra' };
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
