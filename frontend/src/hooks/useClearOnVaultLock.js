import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export default function useClearOnVaultLock(clearCallback) {
  const { registerVaultLockCleanup } = useAuth();
  const clearCallbackRef = useRef(clearCallback);

  useEffect(() => {
    clearCallbackRef.current = clearCallback;
  }, [clearCallback]);

  useEffect(() => (
    registerVaultLockCleanup(() => clearCallbackRef.current())
  ), [registerVaultLockCleanup]);
}
