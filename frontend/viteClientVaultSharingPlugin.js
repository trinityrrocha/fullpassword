export default function clientVaultSharingPlugin() {
  return {
    name: 'client-vault-sharing-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      if (!next.includes('Share, X')) {
        next = next.replace(
          `import { ArrowLeft, Server, Globe, Shield, HardDrive, Plus, Save, KeyRound, Edit2, Trash2, X } from 'lucide-react';`,
          `import { ArrowLeft, Server, Globe, Shield, HardDrive, Plus, Save, KeyRound, Edit2, Trash2, Share, X } from 'lucide-react';`
        )
      }

      if (!next.includes('isSharingModalOpen')) {
        next = next.replace(
          `  const [activeTab, setActiveTab] = useState('cpanel');`,
          `  const [activeTab, setActiveTab] = useState('cpanel');\n  const [isSharingModalOpen, setIsSharingModalOpen] = useState(false);`
        )
      }

      const headerCard = `      <div className="flex items-center gap-4">
        <Link to="/" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{client.name}</h1>
          <p className="text-sm text-slate-500">Cofre de Senhas e Credenciais</p>
        </div>
      </div>`

      const headerWithShareButton = `      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{client.name}</h1>
            <p className="text-sm text-slate-500">Cofre de Senhas e Credenciais</p>
          </div>
        </div>
        {(effectiveVaultPermissions.is_owner || effectiveVaultPermissions.is_admin) && (
          <button
            type="button"
            onClick={() => setIsSharingModalOpen(true)}
            title="Compartilhar cofre"
            aria-label="Compartilhar cofre"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <Share className="w-5 h-5" />
          </button>
        )}
      </div>`

      if (!next.includes('Compartilhar cofre')) {
        next = next.replace(headerCard, headerWithShareButton)
      }

      const sharingCard = `      {(effectiveVaultPermissions.is_owner || effectiveVaultPermissions.is_admin) && (
        <div className="bg-white shadow rounded-lg border border-slate-200 p-6">
          <VaultSharingManager clientId={id} clientVaultKey={vaultDataKey} />
        </div>
      )}`

      const sharingModal = `      {(effectiveVaultPermissions.is_owner || effectiveVaultPermissions.is_admin) && isSharingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-60 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Compartilhamento do Cofre</h3>
                <p className="text-sm text-slate-500">Escolha os grupos com acesso a este cofre.</p>
              </div>
              <button type="button" onClick={() => setIsSharingModalOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Fechar compartilhamento">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <VaultSharingManager clientId={id} clientVaultKey={vaultDataKey} compact />
            </div>
          </div>
        </div>
      )}`

      if (!next.includes('isSharingModalOpen &&')) {
        next = next.replace(sharingCard, sharingModal)
      }

      return next === code ? null : { code: next, map: null }
    }
  }
}
