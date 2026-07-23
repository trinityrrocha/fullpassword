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
  const [masterKey, setMasterKey] = useState(null);
  const [loading, setLoading] = useState(true);

  const finishAuthentication = (data) => {
    if (!data?.user) return { success: false, error: 'Resposta de autenticação inválida' };
    setUser(data.user);
    return { success: true, recoveryCodes: data.recovery_codes || [], recoveryCodeUsed: data.recovery_code_used === true };
  };

  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('user_wrapped_key');
    localStorage.removeItem('user_salt');

    api.get('/auth/me')
      .then(({ data }) => setUser(data.user || null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      if (response.data?.mfa_required) return { success: false, mfa: response.data };
      return finishAuthentication(response.data);
    } catch (error) {
      console.error('Falha na tentativa de login.');
      return { 
        success: false, 
        error: error.response?.data?.error || 'Erro ao conectar com o servidor' 
      };
    }
  };

  const verifyMfaLogin = async (challengeToken, { code, recoveryCode }) => {
    try {
      const response = await api.post('/auth/mfa/verify-login', {
        challenge_token: challengeToken,
        code: code || undefined,
        recovery_code: recoveryCode || undefined
      });
      return finishAuthentication(response.data);
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Não foi possível validar o MFA' };
    }
  };

  const confirmMfaSetup = async (setupToken, code) => {
    try {
      const response = await api.post('/auth/mfa/setup/confirm', { setup_token: setupToken, code });
      return finishAuthentication(response.data);
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Não foi possível confirmar o MFA' };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Erro ao encerrar sessão no servidor:', error);
    } finally {
      setUser(null);
      setMasterKey(null);
    }
  };

  const unlockVault = async (password, wrappedKeyStr, saltStr) => {
    try {
      const kek = await deriveMasterKey(password, saltStr);
      const key = await unwrapMasterKey(wrappedKeyStr, kek);
      setMasterKey(key);

      const currentUser = user;
      let unlockedUser = currentUser;
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
          
          unlockedUser = {
            ...currentUser,
            public_key: publicKeyStr,
            encrypted_private_key: encryptedPrivateKeyStr
          };
          setUser((existingUser) => ({
            ...existingUser,
            public_key: publicKeyStr,
            encrypted_private_key: encryptedPrivateKeyStr
          }));
          console.log('Chaves RSA salvas para compartilhamento de cofres.');
        } catch (rsaError) {
          console.error('Erro ao gerar/salvar chaves RSA:', rsaError);
        }
      }

      return { success: true, key, user: unlockedUser };
    } catch {
      console.warn('Não foi possível validar a senha mestre informada.');
      return { success: false, error: 'Senha mestre incorreta' };
    }
  };

  const value = {
    user,
    masterKey,
    isAuthenticated: !!user,
    isVaultUnlocked: !!masterKey,
    login,
    verifyMfaLogin,
    confirmMfaSetup,
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
