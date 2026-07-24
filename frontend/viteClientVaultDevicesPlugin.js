export default function clientVaultDevicesPlugin() {
  return {
    name: 'client-vault-devices-manager-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null;

      let next = code;

      if (!next.includes("import DevicesManager from '../components/DevicesManager';")) {
        if (next.includes("import LinuxServerManager from '../components/LinuxServerManager';")) {
          next = next.replace(
            "import LinuxServerManager from '../components/LinuxServerManager';",
            "import LinuxServerManager from '../components/LinuxServerManager';\nimport DevicesManager from '../components/DevicesManager';"
          );
        } else {
          next = next.replace(
            "import api from '../services/api';",
            "import api from '../services/api';\nimport DevicesManager from '../components/DevicesManager';"
          );
        }
      }

      if (!next.includes("{ id: 'devices', name: 'Dispositivos'")) {
        next = next.replace(
          /(\{ id: 'linuxServer', name: 'Servidor Linux', icon: HardDrive \})\r?\n\];/,
          `$1,\n  { id: 'devices', name: 'Dispositivos', icon: HardDrive }\n];`
        );
      }

      if (!next.includes('const LEGACY_COMPANY_MODULE_IDS')) {
        next = next.replace(
          'const COMPANY_MODULE_IDS = COMPANY_MODULES.map((module) => module.id);',
          `const COMPANY_MODULE_IDS = COMPANY_MODULES.map((module) => module.id);
const LEGACY_COMPANY_MODULE_IDS = COMPANY_MODULE_IDS.filter((moduleId) => moduleId !== 'devices');`
        );
      }

      if (!next.includes("devices: ['Dispositivos']")) {
        next = next.replace(
          /([ ]{2}linuxServer: \['Servidor Linux', 'Servidores Diversos'\])\r?\n\}\);/,
          `$1,\n  devices: ['Dispositivos']\n});`
        );
      }

      if (!next.includes('const [devicesForm, setDevicesForm]')) {
        next = next.replace(
          '  const [tsForm, setTsForm] = useState({ servers: [], users: [] });',
          `  const [tsForm, setTsForm] = useState({ servers: [], users: [] });
  const [devicesForm, setDevicesForm] = useState({ devices: [] });`
        );
      }

      if (!next.includes("if (item.category === 'Dispositivos') setDevicesForm")) {
        next = next.replace(
          "          if (item.category === 'Servidor TS') setTsForm(normalizeTsForm(decryptedData));",
          `          if (item.category === 'Servidor TS') setTsForm(normalizeTsForm(decryptedData));
          if (item.category === 'Dispositivos') setDevicesForm(decryptedData);`
        );
      }

      next = next.replace(
        '      const resolvedModules = configuredModules ?? COMPANY_MODULE_IDS;',
        '      const resolvedModules = configuredModules ?? LEGACY_COMPANY_MODULE_IDS;'
      );

      if (!next.includes("if (moduleId === 'devices') setDevicesForm")) {
        next = next.replace(
          "    if (moduleId === 'linuxServer') setServerForm({ servers: [], sshCredentials: [] });",
          `    if (moduleId === 'linuxServer') setServerForm({ servers: [], sshCredentials: [] });
    if (moduleId === 'devices') setDevicesForm({ devices: [] });`
        );
      }

      if (!next.includes("activeModuleId === 'devices'")) {
        next = next.replace(
          /([ ]{10}\{activeModuleId === 'linuxServer' && \(\r?\n[ ]{12}<LinuxServerManager[\s\S]*?\r?\n[ ]{10}\)\})\r?\n[ ]{8}<\/div>/,
          `$1

          {activeModuleId === 'devices' && (
            <DevicesManager
              devicesForm={devicesForm}
              setDevicesForm={setDevicesForm}
              handleSaveData={handleSaveData}
              isSaving={isSaving}
              onDeleteModule={canDeleteModules ? openDeleteModuleModal : undefined}
            />
          )}
        </div>`
        );
      }

      next = next.replace(
        'Servidor hospedagem, VPN, Servidor Windows ou Servidor Linux nesta empresa.',
        'Servidor hospedagem, VPN, Servidor Windows, Servidor Linux ou Dispositivos nesta empresa.'
      );

      next = next.replace(
        /<SecurePasswordInput name="unlock_password"[^\r\n]*\/>/,
        (field) => field.includes('showCopyButton=')
          ? field
          : field.replace(/\s*\/>$/, ' showCopyButton={false} />')
      );

      return next === code ? null : { code: next, map: null };
    }
  };
}
