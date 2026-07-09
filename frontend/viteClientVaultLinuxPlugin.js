export default function clientVaultLinuxPlugin() {
  return {
    name: 'client-vault-linux-manager-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      if (!next.includes('LinuxServerManager')) {
        if (next.includes("import WindowsServerManager from '../components/WindowsServerManager';")) {
          next = next.replace(
            "import WindowsServerManager from '../components/WindowsServerManager';",
            "import WindowsServerManager from '../components/WindowsServerManager';\nimport LinuxServerManager from '../components/LinuxServerManager';"
          )
        } else if (next.includes("import VpnManager from '../components/VpnManager';")) {
          next = next.replace(
            "import VpnManager from '../components/VpnManager';",
            "import VpnManager from '../components/VpnManager';\nimport LinuxServerManager from '../components/LinuxServerManager';"
          )
        } else {
          next = next.replace(
            "import api from '../services/api';",
            "import api from '../services/api';\nimport LinuxServerManager from '../components/LinuxServerManager';"
          )
        }
      }

      next = next.replace(
        `{ id: 'servers', name: 'Servidores Diversos', icon: HardDrive }`,
        `{ id: 'servers', name: 'Servidor Linux', icon: HardDrive }`
      )

      next = next.replace(
        `          if (item.category === 'Servidores Diversos') {
            setServerForm({ ...decryptedData, attachment: null });
          }`,
        `          if (item.category === 'Servidor Linux' || item.category === 'Servidores Diversos') {
            setServerForm(decryptedData);
          }`
      )

      next = next.replace(
        /          \{activeTab === 'servers' && \(\n[\s\S]*?\n          \)\}\n        <\/div>/,
        `          {activeTab === 'servers' && (
            <LinuxServerManager
              serverForm={serverForm}
              setServerForm={setServerForm}
              handleSaveData={handleSaveData}
              isSaving={isSaving}
            />
          )}
        </div>`
      )

      return next === code ? null : { code: next, map: null }
    }
  }
}
