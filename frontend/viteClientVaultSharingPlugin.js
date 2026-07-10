export default function clientVaultSharingPlugin() {
  return {
    name: 'client-vault-sharing-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      if (!next.includes("import VaultSharingManager from '../components/VaultSharingManager';")) {
        next = next.replace(
          `import api from '../services/api';`,
          `import api from '../services/api';\nimport VaultSharingManager from '../components/VaultSharingManager';\nimport VaultReadOnlyGuard from '../components/VaultReadOnlyGuard';\nimport { generateClientVaultKey, encryptVaultKeyForPublicKey, decryptVaultKeyShare } from '../services/clientVaultKeyService';`
        )
      } else {
        if (!next.includes("clientVaultKeyService")) {
          next = next.replace(
            `import VaultSharingManager from '../components/VaultSharingManager';`,
            `import VaultSharingManager from '../components/VaultSharingManager';\nimport { generateClientVaultKey, encryptVaultKeyForPublicKey, decryptVaultKeyShare } from '../services/clientVaultKeyService';`
          )
        }

        if (!next.includes("VaultReadOnlyGuard")) {
          next = next.replace(
            `import VaultSharingManager from '../components/VaultSharingManager';`,
            `import VaultSharingManager from '../components/VaultSharingManager';\nimport VaultReadOnlyGuard from '../components/VaultReadOnlyGuard';`
          )
        }
      }

      if (!next.includes("id: 'sharing'")) {
        next = next.replace(
          `    { id: 'servers', name: 'Servidores Diversos', icon: HardDrive },`,
          `    { id: 'servers', name: 'Servidores Diversos', icon: HardDrive },\n    { id: 'sharing', name: 'Compartilhamento', icon: Shield },`
        )
      }

      next = next.replace(
        `  const { masterKey, isVaultUnlocked, unlockVault } = useAuth();`,
        `  const { user, masterKey, isVaultUnlocked, unlockVault } = useAuth();`
      )

      if (!next.includes('setVaultPermissions')) {
        next = next.replace(
          `  const [savedItems, setSavedItems] = useState([]);`,
          `  const [savedItems, setSavedItems] = useState([]);\n  const [clientVaultKey, setClientVaultKey] = useState(null);\n  const [clientVaultKeyError, setClientVaultKeyError] = useState('');\n  const [vaultPermissions, setVaultPermissions] = useState({\n    can_view: true,\n    can_edit: true,\n    can_add: true,\n    can_delete: true,\n    is_owner: true,\n    is_admin: false\n  });`
        )
      } else if (!next.includes('setClientVaultKey')) {
        next = next.replace(
          `  const [savedItems, setSavedItems] = useState([]);`,
          `  const [savedItems, setSavedItems] = useState([]);\n  const [clientVaultKey, setClientVaultKey] = useState(null);\n  const [clientVaultKeyError, setClientVaultKeyError] = useState('');`
        )
      }

      if (!next.includes('const getStoredUser = () =>')) {
        next = next.replace(
          `  const loadVaultItems = async () => {`,
          `  const isReadOnlyMode = Boolean(
    vaultPermissions.can_view &&
    !vaultPermissions.is_owner &&
    !vaultPermissions.is_admin &&
    !vaultPermissions.can_edit &&
    !vaultPermissions.can_add &&
    !vaultPermissions.can_delete
  );

  const getStoredUser = () => {
    try {
      return user || JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return user || null;
    }
  };

  const getCurrentUserPublicKey = async () => {
    const currentUser = getStoredUser();
    if (currentUser?.public_key && typeof currentUser.public_key === 'string') return currentUser.public_key;

    const usersResponse = await api.get('/users');
    const foundUser = (usersResponse.data || []).find((item) => item.id === currentUser?.id);
    return foundUser?.public_key || null;
  };

  const saveClientKeyShareForCurrentUser = async (key) => {
    const currentUser = getStoredUser();
    const publicKey = await getCurrentUserPublicKey();

    if (!currentUser?.id || !publicKey) return false;

    const encryptedClientKey = await encryptVaultKeyForPublicKey(key, publicKey);
    await api.put(\`/vault-items/${'${id}'}/key-shares\`, {
      shares: [{ user_id: currentUser.id, encrypted_client_key: encryptedClientKey }]
    });
    return true;
  };

  const ensureClientVaultKey = async () => {
    if (clientVaultKey) return clientVaultKey;

    const currentUser = getStoredUser();

    try {
      const shareResponse = await api.get(\`/vault-items/${'${id}'}/key-share\`);
      const encryptedClientKey = shareResponse.data?.encrypted_client_key;

      if (encryptedClientKey && currentUser?.encrypted_private_key) {
        const key = await decryptVaultKeyShare(encryptedClientKey, currentUser.encrypted_private_key, masterKey);
        setClientVaultKey(key);
        setClientVaultKeyError('');
        return key;
      }
    } catch (error) {
      console.warn('Chave compartilhada do cofre ainda não disponível:', error);
    }

    const permissionsResponse = await api.get(\`/vault-items/${'${id}'}/permissions\`);
    const permissions = permissionsResponse.data || {};
    setVaultPermissions(permissions);

    if (permissions.is_owner || permissions.is_admin) {
      const key = await generateClientVaultKey();
      const saved = await saveClientKeyShareForCurrentUser(key);
      if (!saved) {
        const message = 'Não foi possível preparar sua chave de compartilhamento. Desbloqueie o cofre novamente para gerar suas chaves de usuário.';
        setClientVaultKeyError(message);
        return null;
      }
      setClientVaultKey(key);
      setClientVaultKeyError('');
      return key;
    }

    const message = 'Este cofre foi compartilhado com você, mas a chave criptográfica do cofre ainda não foi liberada para seu usuário.';
    setClientVaultKeyError(message);
    return null;
  };

  const migrateLegacyItemToClientKey = async (item, decryptedData, activeClientVaultKey) => {
    if (!activeClientVaultKey || item.created_by !== getStoredUser()?.id) return;

    try {
      let encryptedAttachment = null;

      if (item.encrypted_attachment) {
        const decryptedFile = await decryptData(item.encrypted_attachment, masterKey);
        encryptedAttachment = await encryptData(decryptedFile, activeClientVaultKey);
      }

      const encryptedData = await encryptData(decryptedData, activeClientVaultKey);
      await api.post(\`/vault-items/${'${id}'}\`, {
        category: item.category,
        encrypted_data: encryptedData,
        encrypted_attachment: encryptedAttachment,
        metadata: {
          ...(item.metadata || {}),
          migrated_to_client_key: true,
          migrated_at: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Erro ao migrar item legado do cofre:', error);
    }
  };

  const loadVaultItems = async () => {`
        )
      }

      if (!next.includes('const activeClientVaultKey = await ensureClientVaultKey();')) {
        next = next.replace(
          `    if (!isVaultUnlocked) return;`,
          `    if (!isVaultUnlocked) return;

    const activeClientVaultKey = await ensureClientVaultKey();
    if (!activeClientVaultKey) {
      setSavedItems([]);
      return;
    }`
        )
      }

      if (!next.includes('let usedLegacyMasterKey = false;')) {
        next = next.replace(
          `          const decryptedData = await decryptData(item.encrypted_data, masterKey);`,
          `          let decryptedData;
          let usedLegacyMasterKey = false;

          try {
            decryptedData = await decryptData(item.encrypted_data, activeClientVaultKey);
          } catch {
            decryptedData = await decryptData(item.encrypted_data, masterKey);
            usedLegacyMasterKey = true;
          }`
        )

        next = next.replace(
          `          loadedCategories.add(item.category);`,
          `          loadedCategories.add(item.category);

          if (usedLegacyMasterKey) {
            await migrateLegacyItemToClientKey(item, decryptedData, activeClientVaultKey);
          }`
        )
      }

      if (!next.includes('/permissions`);')) {
        next = next.replace(
          `      const response = await api.get(\`/vault-items/${'${id}'}\`);`,
          `      const permissionsResponse = await api.get(\`/vault-items/${'${id}'}/permissions\`);\n      setVaultPermissions(permissionsResponse.data || vaultPermissions);\n\n      const response = await api.get(\`/vault-items/${'${id}'}\`);`
        )
      }

      if (!next.includes('Você tem permissão apenas para visualizar este cofre')) {
        next = next.replace(
          `    setIsSaving(true);`,
          `    if (!vaultPermissions.is_owner && !vaultPermissions.is_admin && !vaultPermissions.can_edit && !vaultPermissions.can_add) {
      alert('Você tem permissão apenas para visualizar este cofre. Alterações não são permitidas.');
      return false;
    }

    const activeClientVaultKey = await ensureClientVaultKey();
    if (!activeClientVaultKey) {
      alert(clientVaultKeyError || 'Chave criptográfica do cofre indisponível.');
      return false;
    }

    setIsSaving(true);`
        )
      } else if (!next.includes("Chave criptográfica do cofre indisponível")) {
        next = next.replace(
          `    setIsSaving(true);`,
          `    const activeClientVaultKey = await ensureClientVaultKey();
    if (!activeClientVaultKey) {
      alert(clientVaultKeyError || 'Chave criptográfica do cofre indisponível.');
      return false;
    }

    setIsSaving(true);`
        )
      }

      next = next.replace(
        `encryptFile(normalizedData.attachment, masterKey)`,
        `encryptFile(normalizedData.attachment, activeClientVaultKey)`
      )

      next = next.replace(
        `encryptData(dataToEncrypt, masterKey)`,
        `encryptData(dataToEncrypt, activeClientVaultKey)`
      )

      next = next.replace(
        `decryptData(item.encrypted_attachment, masterKey)`,
        `decryptData(item.encrypted_attachment, clientVaultKey || masterKey)`
      )

      if (!next.includes('setClientVaultKey(null);')) {
        next = next.replace(
          `  useEffect(() => {
    if (isVaultUnlocked) {`,
          `  useEffect(() => {
    setClientVaultKey(null);
    setClientVaultKeyError('');
  }, [id]);

  useEffect(() => {
    if (isVaultUnlocked) {`
        )
      }

      if (!next.includes('data-vault-readonly-scope')) {
        next = next.replace(
          `        <div className="p-6">`,
          `        <div className="p-6" data-vault-readonly-scope={isReadOnlyMode ? 'true' : 'false'}>
          <VaultReadOnlyGuard enabled={isReadOnlyMode} />
          {isReadOnlyMode && (
            <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Modo somente leitura: você pode visualizar e copiar as informações deste cofre, mas não pode alterar, adicionar ou excluir dados.
            </div>
          )}`
        )
      }

      if (!next.includes('activeTab === \'sharing\'')) {
        next = next.replace(
          `        <div className="p-6" data-vault-readonly-scope={isReadOnlyMode ? 'true' : 'false'}>`,
          `        <div className="p-6" data-vault-readonly-scope={isReadOnlyMode ? 'true' : 'false'}>\n          {activeTab === 'sharing' && (\n            <VaultSharingManager clientId={id} clientVaultKey={clientVaultKey} />\n          )}`
        )
      } else {
        next = next.replace(
          `<VaultSharingManager clientId={id} />`,
          `<VaultSharingManager clientId={id} clientVaultKey={clientVaultKey} />`
        )
      }

      return next === code ? null : { code: next, map: null }
    }
  }
}
