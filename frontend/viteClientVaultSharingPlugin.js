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
          `import api from '../services/api';\nimport VaultSharingManager from '../components/VaultSharingManager';`
        )
      }

      if (!next.includes("id: 'sharing'")) {
        next = next.replace(
          `    { id: 'servers', name: 'Servidores Diversos', icon: HardDrive },`,
          `    { id: 'servers', name: 'Servidores Diversos', icon: HardDrive },\n    { id: 'sharing', name: 'Compartilhamento', icon: Shield },`
        )
      }

      if (!next.includes('setVaultPermissions')) {
        next = next.replace(
          `  const [savedItems, setSavedItems] = useState([]);`,
          `  const [savedItems, setSavedItems] = useState([]);\n  const [vaultPermissions, setVaultPermissions] = useState({\n    can_view: true,\n    can_edit: true,\n    can_add: true,\n    can_delete: true,\n    is_owner: true,\n    is_admin: false\n  });`
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
          `    if (!vaultPermissions.is_owner && !vaultPermissions.is_admin && !vaultPermissions.can_edit && !vaultPermissions.can_add) {\n      alert('Você tem permissão apenas para visualizar este cofre. Alterações não são permitidas.');\n      return false;\n    }\n\n    setIsSaving(true);`
        )
      }

      if (!next.includes('activeTab === \'sharing\'')) {
        next = next.replace(
          `        <div className="p-6">`,
          `        <div className="p-6">\n          {activeTab === 'sharing' && (\n            <VaultSharingManager clientId={id} />\n          )}`
        )
      }

      return next === code ? null : { code: next, map: null }
    }
  }
}
