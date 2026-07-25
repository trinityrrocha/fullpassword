import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { 
  deriveMasterKey, 
  unwrapMasterKey, 
  generateRSAKeyPair, 
  exportPublicKey, 
  encryptPrivateKey,
  CRYPTO_KDF_PARAMS_INVALID_ERROR,
  CRYPTO_SALT_REQUIRED_ERROR,
  isValidCryptoSalt,
  resolveKdfParams
} from '../services/cryptoService';
import { safeLogError, safeLogInfo } from '../utils/safeLogger';

const AuthContext = createContext(null);
const AUTO_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [masterKey, setMasterKey] = useState(null);
  const [vaultLockReason, setVaultLockReason] = useState(null);
  const [vaultStateEpoch, setVaultStateEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const lastActivityRef = useRef(null);

  const finishAuthentication = (data) => {
    if (!data?.user) return { success: false, error: 'Resposta de autenticação inválida' };
    if (!isValidCryptoSalt(data.user.crypto_salt)) {
      safeLogError('Resposta de autenticação sem salt criptográfico válido.', {
        name: 'CryptoSaltValidationError',
        code: CRYPTO_SALT_REQUIRED_ERROR
      });
      return {
        success: false,
        error: 'Não foi possível inicializar a chave criptográfica do usuário. Entre em contato com o administrador.'
      };
    }
    try {
      resolveKdfParams(data.user);
    } catch (error) {
      safeLogError('Resposta de autenticação com parâmetros KDF inválidos.', error);
      return {
        success: false,
        error: 'Não foi possível validar os parâmetros criptográficos do usuário. Entre em contato com o administrador.'
      };
    }
    setUser(data.user);
    setVaultLockReason(null);
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
      safeLogError('Falha na tentativa de login.', error);
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

  const clearSensitiveVaultState = useCallback((reason = 'manual') => {
    if (!masterKey) return false;
    setMasterKey(null);
    setVaultLockReason(reason);
    setVaultStateEpoch((current) => current + 1);
    return true;
  }, [masterKey]);
  const lockVault = clearSensitiveVaultState;

  useEffect(() => {
    if (!masterKey) return undefined;

    let timeoutId;
    function scheduleCheck() {
      window.clearTimeout(timeoutId);
      const remaining = Math.max(0, AUTO_LOCK_TIMEOUT_MS - (Date.now() - lastActivityRef.current));
      timeoutId = window.setTimeout(checkInactivity, remaining);
    }
    function checkInactivity() {
      if (Date.now() - lastActivityRef.current >= AUTO_LOCK_TIMEOUT_MS) {
        lockVault('inactivity');
        return;
      }
      scheduleCheck();
    }
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) checkInactivity();
    };

    lastActivityRef.current = Date.now();
    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, markActivity, true));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    scheduleCheck();

    return () => {
      window.clearTimeout(timeoutId);
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, markActivity, true));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [lockVault, masterKey]);

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      safeLogError('Erro ao encerrar sessão no servidor.', error);
    } finally {
      setUser(null);
      setMasterKey(null);
      setVaultLockReason(null);
      setVaultStateEpoch((current) => current + 1);
    }
  };

  const unlockVault = async (password, wrappedKeyStr, saltStr) => {
    try {
      const kek = await deriveMasterKey(password, saltStr, resolveKdfParams(user || {}));
      const key = await unwrapMasterKey(wrappedKeyStr, kek);
      setMasterKey(key);
      setVaultLockReason(null);

      const currentUser = user;
      let unlockedUser = currentUser;
      if (currentUser && (!currentUser.public_key || !currentUser.encrypted_private_key)) {
        safeLogInfo('Gerando chaves RSA para compartilhamento de cofres.');
        try {
          const keyPair = await generateRSAKeyPair();
          const publicKeyStr = await exportPublicKey(keyPair.publicKey);
          const encryptedPrivateKeyStr = await encryptPrivateKey(keyPair.privateKey, key);
          
          const keysResponse = await api.put('/users/keys', {
            public_key: publicKeyStr,
            encrypted_private_key: encryptedPrivateKeyStr
          });
          const rsaMetadata = keysResponse.data?.key_metadata || {};
          
          unlockedUser = {
            ...currentUser,
            public_key: publicKeyStr,
            encrypted_private_key: encryptedPrivateKeyStr,
            ...rsaMetadata
          };
          setUser((existingUser) => ({
            ...existingUser,
            public_key: publicKeyStr,
            encrypted_private_key: encryptedPrivateKeyStr,
            ...rsaMetadata
          }));
          safeLogInfo('Chaves RSA salvas para compartilhamento de cofres.');
        } catch (rsaError) {
          safeLogError('Erro ao gerar ou salvar chaves RSA.', rsaError);
        }
      }

      return { success: true, key, user: unlockedUser };
    } catch (error) {
      if ([CRYPTO_SALT_REQUIRED_ERROR, CRYPTO_KDF_PARAMS_INVALID_ERROR].includes(error?.code)) {
        safeLogError('Não foi possível inicializar a chave criptográfica do usuário.', error);
        return {
          success: false,
          error: error.code === CRYPTO_KDF_PARAMS_INVALID_ERROR
            ? 'Os parâmetros criptográficos do usuário são inválidos. Entre em contato com o administrador.'
            : 'Não foi possível inicializar a chave criptográfica do usuário. Entre em contato com o administrador.'
        };
      }
      console.warn('Não foi possível validar a senha mestre informada.');
      return { success: false, error: 'Senha mestre incorreta' };
    }
  };

  const value = {
    user,
    masterKey,
    isAuthenticated: !!user,
    isVaultUnlocked: !!masterKey,
    vaultLockReason,
    vaultStateEpoch,
    login,
    verifyMfaLogin,
    confirmMfaSetup,
    logout,
    lockVault,
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
