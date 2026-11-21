import { useCallback, useEffect, useState } from 'react';
import { getMenuModules } from '../services/spfblService';
import { MODULES_CHANGED_EVENT } from '../utils/spfbl';

// Which optional modules this account may open. The menu is only a convenience: every module route checks again on the
// server. A failed call means "no modules" (never an error screen), and the list is fetched again after a toggle.
export default function useModulesMenu(userId) {
  const [modules, setModules] = useState({});

  const refresh = useCallback(async () => {
    if (!userId) { setModules({}); return; }
    try { setModules(await getMenuModules()); } catch { setModules({}); }
  }, [userId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!userId) { setModules({}); return; }
      try { const next = await getMenuModules(); if (active) setModules(next); } catch { if (active) setModules({}); }
    };
    load();
    const onChanged = () => { load(); };
    window.addEventListener(MODULES_CHANGED_EVENT, onChanged);
    return () => { active = false; window.removeEventListener(MODULES_CHANGED_EVENT, onChanged); };
  }, [userId]);

  return { modules, refresh };
}
