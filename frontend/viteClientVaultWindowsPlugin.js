export default function clientVaultWindowsPlugin() {
  return {
    name: 'client-vault-windows-manager-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      if (!next.includes('WindowsServerManager')) {
        if (next.includes("import VpnManager from '../components/VpnManager';")) {
          next = next.replace(
            "import VpnManager from '../components/VpnManager';",
            "import VpnManager from '../components/VpnManager';\nimport WindowsServerManager from '../components/WindowsServerManager';"
          )
        } else if (next.includes("import CpanelWebManager from '../components/CpanelWebManager';")) {
          next = next.replace(
            "import CpanelWebManager from '../components/CpanelWebManager';",
            "import CpanelWebManager from '../components/CpanelWebManager';\nimport WindowsServerManager from '../components/WindowsServerManager';"
          )
        } else {
          next = next.replace(
            "import api from '../services/api';",
            "import api from '../services/api';\nimport WindowsServerManager from '../components/WindowsServerManager';"
          )
        }
      }

      next = next.replace(
        /          \{activeTab === 'ts' && \(\n[\s\S]*?\n          \)\}\n\n          \{activeTab === 'servers' && \(/,
        `          {activeTab === 'ts' && (
            <WindowsServerManager
              tsForm={tsForm}
              setTsForm={setTsForm}
              handleSaveData={handleSaveData}
              isSaving={isSaving}
            />
          )}

          {activeTab === 'servers' && (`
      )

      return next === code ? null : { code: next, map: null }
    }
  }
}
