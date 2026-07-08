const windowsNormalizeTsForm = `const normalizeTsForm = (data = {}) => {
  const sanitizePortInput = (value = '') => String(value).replace(/\\D/g, '');
  const sanitizeIpv4MaskInput = (value = '') => {
    const cleaned = String(value).replace(/[^0-9./]/g, '');
    const [address, ...maskParts] = cleaned.split('/');
    return maskParts.length ? \`${'${address}'}/${'${maskParts.join(\'\').replace(/\\D/g, \'\')}' }\` : address;
  };

  const normalizeConnections = (server = {}) => {
    if (Array.isArray(server.connections)) {
      return server.connections.map((connection) => ({
        id: connection.id || makeId(),
        type: connection.type || 'Eth1',
        ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')
      }));
    }

    if (server.ip) return [{ id: makeId(), type: 'Eth1', ipv4: sanitizeIpv4MaskInput(server.ip) }];
    return [];
  };

  const normalizePortRules = (server = {}) => {
    if (Array.isArray(server.portRules)) {
      return server.portRules.map((rule) => ({
        id: rule.id || makeId(),
        name: rule.name || '',
        portNumber: sanitizePortInput(rule.portNumber || rule.port || ''),
        direction: rule.direction || 'Entrada',
        protocol: rule.protocol || 'TCP'
      }));
    }

    const migratedRules = [];
    if (server.internalPort || server.port) {
      migratedRules.push({
        id: makeId(),
        name: 'Porta interna',
        portNumber: sanitizePortInput(server.internalPort || server.port || ''),
        direction: 'Entrada',
        protocol: 'RPD'
      });
    }
    if (server.externalPort) {
      migratedRules.push({
        id: makeId(),
        name: 'Porta externa',
        portNumber: sanitizePortInput(server.externalPort),
        direction: 'Entrada',
        protocol: 'RPD'
      });
    }

    return migratedRules;
  };

  const normalizeTsRules = (server = {}) => {
    if (!Array.isArray(server.tsRules)) return [];

    return server.tsRules.map((rule) => ({
      id: rule.id || makeId(),
      name: rule.name || '',
      host: rule.host || rule.ip || '',
      port: sanitizePortInput(rule.port || '')
    }));
  };

  const normalizeServer = (server = {}) => ({
    id: server.id || makeId(),
    name: server.name || server.domain || '',
    notes: server.notes || server.observations || '',
    connections: normalizeConnections(server),
    portRules: normalizePortRules(server),
    tsRules: normalizeTsRules(server)
  });

  if (Array.isArray(data.servers) || Array.isArray(data.users)) {
    return {
      servers: Array.isArray(data.servers) ? data.servers.map((server) => normalizeServer(server)) : [],
      users: Array.isArray(data.users)
        ? data.users.map((user) => ({
            id: user.id || makeId(),
            serverId: user.serverId || '',
            name: user.name || '',
            username: user.username || user.login || '',
            password: user.password || '',
            permission: user.permission || 'user',
            department: user.department || ''
          }))
        : []
    };
  }

  const legacyServerId = \`legacy-\${String(data.ip || 'principal').replace(/[^a-zA-Z0-9_-]/g, '-')}\`;
  const legacyServer = data.ip || data.port || data.domain
    ? [normalizeServer({
        id: legacyServerId,
        name: data.domain || 'Servidor principal',
        ip: data.ip || '',
        internalPort: data.port || '',
        externalPort: data.externalPort || '',
        notes: data.notes || data.observations || ''
      })]
    : [];

  return {
    servers: legacyServer,
    users: Array.isArray(data.users)
      ? data.users.map((user) => ({
          id: user.id || makeId(),
          serverId: user.serverId || legacyServerId,
          name: user.name || '',
          username: user.username || user.login || '',
          password: user.password || '',
          permission: user.permission || 'user',
          department: user.department || ''
        }))
      : []
  };
};`

function transformWindowsManager(code) {
  let next = code

  if (!next.includes('const sanitizePortInput')) {
    next = next.replace(
      "const directionOptions = ['Entrada', 'Saída'];",
      `const directionOptions = ['Entrada', 'Saída'];

const sanitizePortInput = (value = '') => String(value).replace(/\\D/g, '');
const sanitizeIpv4MaskInput = (value = '') => {
  const cleaned = String(value).replace(/[^0-9./]/g, '');
  const [address, ...maskParts] = cleaned.split('/');
  return maskParts.length ? \`${'${address}'}/${'${maskParts.join(\'\').replace(/\\D/g, \'\')}' }\` : address;
};`
    )
  }

  next = next.replace('ipv4: connection.ipv4 || connection.ip || \'\'', 'ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || \'\')')
  next = next.replace("return [{ id: makeId(), type: 'Eth1', ipv4: server.ip }];", "return [{ id: makeId(), type: 'Eth1', ipv4: sanitizeIpv4MaskInput(server.ip) }];")
  next = next.replace('portNumber: rule.portNumber || rule.port || \'\'', 'portNumber: sanitizePortInput(rule.portNumber || rule.port || \'\')')
  next = next.replace('portNumber: server.internalPort || server.port || \'\'', 'portNumber: sanitizePortInput(server.internalPort || server.port || \'\')')
  next = next.replace('portNumber: server.externalPort,', 'portNumber: sanitizePortInput(server.externalPort),')
  next = next.replace('port: rule.port || \'\'', 'port: sanitizePortInput(rule.port || \'\')')
  next = next.replace('updateConnection(connection.id, e.target.value)', 'updateConnection(connection.id, sanitizeIpv4MaskInput(e.target.value))')
  next = next.replace("updatePortRule(rule.id, 'portNumber', e.target.value)", "updatePortRule(rule.id, 'portNumber', sanitizePortInput(e.target.value))")
  next = next.replace("updateTsRule(rule.id, 'port', e.target.value)", "updateTsRule(rule.id, 'port', sanitizePortInput(e.target.value))")

  return next
}

export default function clientVaultWindowsPlugin() {
  return {
    name: 'client-vault-windows-manager-transform',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('WindowsServerManager.jsx')) {
        const next = transformWindowsManager(code)
        return next === code ? null : { code: next, map: null }
      }

      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      next = next.replace(/const normalizeTsForm = \(data = \{\}\) => \{[\s\S]*?\n\};\n\nexport default function ClientVault/, `${windowsNormalizeTsForm}\n\nexport default function ClientVault`)

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
