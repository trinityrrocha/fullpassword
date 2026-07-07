export default function clientVaultVpnPlugin() {
  return {
    name: 'client-vault-vpn-manager-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      if (!next.includes('VpnManager')) {
        if (next.includes("import CpanelWebManager from '../components/CpanelWebManager';")) {
          next = next.replace(
            "import CpanelWebManager from '../components/CpanelWebManager';",
            "import CpanelWebManager from '../components/CpanelWebManager';\nimport VpnManager from '../components/VpnManager';"
          )
        } else {
          next = next.replace(
            "import api from '../services/api';",
            "import api from '../services/api';\nimport VpnManager from '../components/VpnManager';"
          )
        }
      }

      next = next.replace(
        /          \{activeTab === 'vpn' && \(\n[\s\S]*?\n          \)\}\n\n          \{activeTab === 'ts' && \(/,
        `          {activeTab === 'vpn' && (
            <VpnManager
              vpnForm={vpnForm}
              setVpnForm={setVpnForm}
              handleSaveData={handleSaveData}
              isSaving={isSaving}
            />
          )}

          {activeTab === 'ts' && (`
      )

      return next === code ? null : { code: next, map: null }
    }
  }
}
