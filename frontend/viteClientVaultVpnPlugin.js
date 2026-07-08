function transformVpnManager(code) {
  let next = code

  if (!next.includes('const sanitizePortInput')) {
    next = next.replace(
      "const defaultVpn = 'OpenVPN';",
      `const defaultVpn = 'OpenVPN';

const sanitizePortInput = (value = '') => String(value).replace(/\\D/g, '');
const sanitizeIpv4MaskInput = (value = '') => {
  const cleaned = String(value).replace(/[^0-9./]/g, '');
  const [address, ...maskParts] = cleaned.split('/');
  return maskParts.length ? address + '/' + maskParts.join('').replace(/\\D/g, '') : address;
};`
    )
  }

  next = next.replace('ipv4Local: server.ipv4Local || server.localIpv4 || \'\'', 'ipv4Local: sanitizeIpv4MaskInput(server.ipv4Local || server.localIpv4 || \'\')')
  next = next.replace('ipv4Tunnel: server.ipv4Tunnel || server.tunnelIpv4 || \'\'', 'ipv4Tunnel: sanitizeIpv4MaskInput(server.ipv4Tunnel || server.tunnelIpv4 || \'\')')
  next = next.replace('vlan: server.vlan || \'\'', 'vlan: sanitizeIpv4MaskInput(server.vlan || \'\')')
  next = next.replace('port: server.port || \'\'', 'port: sanitizePortInput(server.port || \'\')')
  next = next.replace('ipv4Local: data.ipv4Local || \'\'', 'ipv4Local: sanitizeIpv4MaskInput(data.ipv4Local || \'\')')
  next = next.replace('ipv4Tunnel: data.ipv4Tunnel || \'\'', 'ipv4Tunnel: sanitizeIpv4MaskInput(data.ipv4Tunnel || \'\')')
  next = next.replace('vlan: data.vlan || \'\'', 'vlan: sanitizeIpv4MaskInput(data.vlan || \'\')')
  next = next.replace('port: data.port || \'\'', 'port: sanitizePortInput(data.port || \'\')')
  next = next.replace('ipv4Local: e.target.value', 'ipv4Local: sanitizeIpv4MaskInput(e.target.value)')
  next = next.replace('ipv4Tunnel: e.target.value', 'ipv4Tunnel: sanitizeIpv4MaskInput(e.target.value)')
  next = next.replace('vlan: e.target.value', 'vlan: sanitizeIpv4MaskInput(e.target.value)')
  next = next.replace('port: e.target.value', 'port: sanitizePortInput(e.target.value)')

  return next
}

export default function clientVaultVpnPlugin() {
  return {
    name: 'client-vault-vpn-manager-transform',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('VpnManager.jsx')) {
        const next = transformVpnManager(code)
        return next === code ? null : { code: next, map: null }
      }

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
