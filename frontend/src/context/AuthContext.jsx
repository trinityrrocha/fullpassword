import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { 
  deriveMasterKey, 
  unwrapMasterKey, 
  generateRSAKeyPair, 
  exportPublicKey, 
  encryptPrivateKey 
} from '../services/cryptoService';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [masterKey, setMasterKey] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
    
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { token: jwtToken, user: userData } = response.data;

      localStorage.setItem('token', jwtToken);
      localStorage.setItem('user', JSON.stringify(userData));
      localStorage.setItem('user_wrapped_key', userData.wrapped_key || '');
      localStorage.setItem('user_salt', userData.crypto_salt || '');
      
      setToken(jwtToken);
      setUser(userData);
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
    localStorage.removeItem('user_wrapped_key');
    localStorage.removeItem('user_salt');
    setToken(null);
    setUser(null);
    setMasterKey(null);
  };

  const unlockVault = async (password, wrappedKeyStr, saltStr) => {
    try {
      const kek = await deriveMasterKey(password, saltStr);
      const key = await unwrapMasterKey(wrappedKeyStr, kek);
      setMasterKey(key);

      const currentUser = JSON.parse(localStorage.getItem('user'));
      if (currentUser && (!currentUser.public_key || !currentUser.encrypted_private_key)) {
        console.log('Gerando chaves RSA para compartilhamento de cofres...');
        try {
          const keyPair = await generateRSAKeyPair();
          const publicKeyStr = await exportPublicKey(keyPair.publicKey);
          const encryptedPrivateKeyStr = await encryptPrivateKey(keyPair.privateKey, key);
          
          await api.put('/users/keys', {
            public_key: publicKeyStr,
            encrypted_private_key: encryptedPrivateKeyStr
          });
          
          currentUser.public_key = publicKeyStr;
          currentUser.encrypted_private_key = encryptedPrivateKeyStr;
          localStorage.setItem('user', JSON.stringify(currentUser));
          setUser(currentUser);
          console.log('Chaves RSA salvas para compartilhamento de cofres.');
        } catch (rsaError) {
          console.error('Erro ao gerar/salvar chaves RSA:', rsaError);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Falha no desbloqueio:', error);
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
