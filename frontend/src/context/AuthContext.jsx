import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import api from '../services/api';
import {
  ensureUserCryptoIdentity,
  unlockUserIdentity,
  hasUserCryptoIdentity
} from '../services/userCryptoIdentityService';
import { safeLogError } from '../utils/safeLogger';

const AuthContext = createContext(null);
const AUTO_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [masterKey, setMasterKey] = useState(null);
  const [identityKeys, setIdentityKeys] = useState(null);
  const [vaultLockReason, setVaultLockReason] = useState(null);
  const [vaultStateEpoch, setVaultStateEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const lastActivityRef = useRef(null);
  // O par cifrado/KEK exato que concluiu o desbloqueio fica fora do valor
  // público do contexto. Nenhuma chave exportável é mantida nesta referência.
  const transientMasterKeySourceRef = useRef(null);
  const vaultLockCleanupsRef = useRef(new Set());

  const registerVaultLockCleanup = useCallback((cleanup) => {
    if (typeof cleanup !== 'function') return () => undefined;
    vaultLockCleanupsRef.current.add(cleanup);
    return () => {
      vaultLockCleanupsRef.current.delete(cleanup);
    };
  }, []);

  const notifyVaultLockCleanups = useCallback(() => {
    for (const cleanup of [...vaultLockCleanupsRef.current]) {
      try {
        cleanup();
      } catch {
        // Uma falha local não deve impedir a remoção das chaves e dos demais estados.
      }
    }

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText('').catch(() => undefined);
    }
  }, []);

  const finishAuthentication = (data) => {
    if (!data?.user) return { success: false, error: 'Resposta de autenticação inválida' };
    setUser(data.user);
    setVaultLockReason(null);
    return {
      success: true,
      recoveryCodes: data.recovery_codes || [],
      recoveryCodeUsed: data.recovery_code_used === true,
      cryptoIdentitySetupRequired: !hasUserCryptoIdentity(data.user)
    };
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
    const hadSensitiveKey = Boolean(masterKey || transientMasterKeySourceRef.current);
    if (!hadSensitiveKey) return false;
    notifyVaultLockCleanups();
    transientMasterKeySourceRef.current = null;
    setMasterKey(null);
    setIdentityKeys(null);
    setVaultLockReason(reason);
    setVaultStateEpoch((current) => current + 1);
    return true;
  }, [masterKey, notifyVaultLockCleanups]);
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
      notifyVaultLockCleanups();
      transientMasterKeySourceRef.current = null;
      setUser(null);
      setMasterKey(null);
    setIdentityKeys(null);
      setVaultLockReason(null);
      setVaultStateEpoch((current) => current + 1);
    }
  };

  const ensureCurrentUserCryptoIdentity = async (password, unlockSecret, mfaCode) => {
    try {
      const identity = await ensureUserCryptoIdentity({
        user,
        password, unlockSecret, mfaCode,
        saveIdentity: async (payload) => (await api.post('/crypto/identity', payload)).data
      });
      setUser(identity.user);
      return { success: true, created: identity.created };
    } catch (error) {
      safeLogError('Falha ao configurar identidade criptográfica da conta.', error);
      return {
        success: false,
        error: error.response?.data?.error
          || 'Não foi possível configurar as chaves de segurança da sua conta. Confira a senha e tente novamente.'
      };
    }
  };

  const unlockVault = async (secret) => {
    try {
      const keys = await unlockUserIdentity(user,secret);
      setIdentityKeys(keys);
      setMasterKey(keys.masterKey);
      setVaultLockReason(null);
      return {success:true,key:keys.masterKey,keys,user};
    } catch {
      return {success:false,error:'Segredo de desbloqueio incorreto ou identidade ainda não migrada.'};
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
    ensureCurrentUserCryptoIdentity,
    logout,
    lockVault,
    unlockVault,
    identityKeys,
    registerVaultLockCleanup,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

// Auth hook intentionally co-located with its context provider.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
