function addMissingLucideImports(code, importNames) {
  let next = code

  const importMatch = next.match(/import \{([^}]+)\} from 'lucide-react';/)
  if (!importMatch) return next

  const currentImports = importMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
  const mergedImports = [...currentImports]

  importNames.forEach((name) => {
    if (!mergedImports.includes(name)) mergedImports.push(name)
  })

  return next.replace(importMatch[0], `import { ${mergedImports.join(', ')} } from 'lucide-react';`)
}

function addVpnConnectionOptions(code) {
  let next = code

  if (!next.includes('const connectionVpnOptions')) {
    next = next.replace(
      "const connectionOptions = ['Eth1', 'Eth2', 'Eth3', 'Eth4', 'Eth5', 'VPN'];",
      "const connectionOptions = ['Eth1', 'Eth2', 'Eth3', 'Eth4', 'Eth5', 'VPN'];\nconst connectionVpnOptions = ['OpenVPN', 'WireGuard', 'ZeroTier', 'Tailscale', 'Outro'];"
    )
  }

  return next
}

function addVpnConnectionCardFields(code) {
  let next = code

  next = next.replace(
    '<div key={connection.id} className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-3 items-end rounded-md border border-slate-200 bg-slate-50 p-3">',
    '<div key={connection.id} className={`flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 ${connection.type === \'VPN\' ? \'flex-nowrap\' : \'flex-wrap\'}`}> '
  )

  next = next.replace(
    /                  <div>\n                    <label className="block text-sm font-medium text-slate-700 mb-1">Conexão<\/label>\n                    (<div className="rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 flex items-center gap-2"><ConnectionIcon type=\{connection\.type\} \/>\{getConnectionLabel\(connection, connections\)\}<\/div>)\n                  <\/div>\n                  <div>\n                    <label className="block text-sm font-medium text-slate-700 mb-1">IPv4<\/label>\n                    (<input[\s\S]*?value=\{connection\.ipv4\}[\s\S]*?\/>)[\n\s]*<\/div>/,
    `                  {connection.type === 'VPN' ? (
                    <>
                      <div className="w-40 shrink-0 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 flex items-center gap-2"><ConnectionIcon type={connection.type} />{getConnectionLabel(connection, connections)}</div>
                      <select
                        aria-label="Tipo de VPN"
                        className="w-48 shrink-0 border-slate-300 rounded-md shadow-sm p-2 border bg-white"
                        value={connection.vpn || 'OpenVPN'}
                        onChange={(e) => setServer({
                          ...server,
                          connections: connections.map((item) => item.id === connection.id ? { ...item, vpn: e.target.value } : item)
                        })}
                      >
                        {connectionVpnOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                      $2
                    </>
                  ) : (
                    <>
                      $1
                      $2
                    </>
                  )}`
  )

  next = next.replace(
    /(<input type="text" inputMode="decimal" className=")w-full( border-slate-300 rounded-md shadow-sm p-2 border" value=\{connection\.ipv4\})/g,
    '$1flex-1 min-w-0$2'
  )

  next = next.replace(
    /(<button type="button" onClick=\{\(\) => removeConnection\(connection\.id\)\} className=")inline-flex items-center justify-center/g,
    '$1shrink-0 inline-flex items-center justify-center'
  )

  return next
}

function addLinuxConnectionNameField(code) {
  let next = code

  next = next.replace(
    "type: connection.type || 'Eth1',\n      vpn: connection.type === 'VPN' ? (connection.vpn || connection.vpnType || 'OpenVPN') : '',\n      ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')",
    "type: connection.type || 'Eth1',\n      vpn: connection.type === 'VPN' ? (connection.vpn || connection.vpnType || 'OpenVPN') : '',\n      name: connection.name || connection.connectionName || '',\n      ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')"
  )

  next = next.replace(
    "if (server.ip) return [{ id: makeId(), type: 'Eth1', vpn: '', ipv4: sanitizeIpv4MaskInput(server.ip) }];",
    "if (server.ip) return [{ id: makeId(), type: 'Eth1', vpn: '', name: '', ipv4: sanitizeIpv4MaskInput(server.ip) }];"
  )

  next = next.replace(
    "connections: [...connections, { id: makeId(), type, vpn: type === 'VPN' ? 'OpenVPN' : '', ipv4: '' }]",
    "connections: [...connections, { id: makeId(), type, vpn: type === 'VPN' ? 'OpenVPN' : '', name: '', ipv4: '' }]"
  )

  if (!next.includes('aria-label="Nome da conexão"')) {
    next = next.replace(
      `<div className="w-40 shrink-0 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 flex items-center gap-2"><ConnectionIcon type={connection.type} />{getConnectionLabel(connection, connections)}</div>`,
      `<div className="w-64 shrink-0 rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 flex items-center gap-2"><ConnectionIcon type={connection.type} /><span className="shrink-0">{getConnectionLabel(connection, connections)}</span><input type="text" aria-label="Nome da conexão" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-0" value={connection.name || ''} onChange={(e) => updateConnection(connection.id, 'name', e.target.value)} placeholder="Nome" /></div>`
    )
  }

  return next
}

function transformWindowsServerManager(code) {
  let next = code

  next = addMissingLucideImports(next, ['Server', 'UserRound', 'UserStar', 'TriangleAlert', 'ShieldCheck', 'EthernetPort'])
  next = addVpnConnectionOptions(next)

  if (!next.includes('function PermissionIcon')) {
    next = next.replace(
      'const directionOptions = [\'Entrada\', \'Saída\'];',
      `const directionOptions = ['Entrada', 'Saída'];

const getPermissionIconConfig = (permission = '') => {
  const normalizedPermission = String(permission || '').toLowerCase();

  if (normalizedPermission === 'sistema') {
    return { Icon: TriangleAlert, className: 'text-amber-500', style: undefined };
  }

  if (normalizedPermission.includes('admin')) {
    return { Icon: UserStar, className: '', style: { color: '#ff8a78' } };
  }

  return { Icon: UserRound, className: 'text-slate-500', style: undefined };
};

function PermissionIcon({ permission }) {
  const { Icon, className, style } = getPermissionIconConfig(permission);
  return <Icon className={'h-5 w-5 shrink-0 ' + className} style={style} />;
}

function ConnectionIcon({ type }) {
  const isVpn = String(type || '').toUpperCase() === 'VPN';
  const Icon = isVpn ? ShieldCheck : EthernetPort;
  return <Icon className={isVpn ? 'h-5 w-5 shrink-0 text-indigo-500' : 'h-5 w-5 shrink-0 text-slate-500'} />;
}`
    )
  }

  next = next.replace(
    `<p className="font-medium text-slate-900">{server.name || 'Servidor sem nome'}</p>`,
    `<p className="font-medium text-slate-900 flex items-center gap-2"><Server className="h-5 w-5 shrink-0 text-slate-500" />{server.name || 'Servidor sem nome'}</p>`
  )

  next = next.replace(
    `<p className="font-medium text-slate-900">{user.name || 'Usuário sem nome'}</p>`,
    `<p className="font-medium text-slate-900 flex items-center gap-2"><PermissionIcon permission={user.permission} />{user.name || 'Usuário sem nome'}</p>`
  )

  next = next.replace(
    `<div className="rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700">{getConnectionLabel(connection, connections)}</div>`,
    `<div className="rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 flex items-center gap-2"><ConnectionIcon type={connection.type} />{getConnectionLabel(connection, connections)}</div>`
  )

  next = addVpnConnectionCardFields(next)

  return next
}

function transformLinuxServerManager(code) {
  let next = code

  next = addVpnConnectionOptions(next)
  next = next.replace(
    "type: connection.type || 'Eth1',\n      ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')",
    "type: connection.type || 'Eth1',\n      vpn: connection.type === 'VPN' ? (connection.vpn || connection.vpnType || 'OpenVPN') : '',\n      ipv4: sanitizeIpv4MaskInput(connection.ipv4 || connection.ip || '')"
  )
  next = next.replace(
    "connections: [...connections, { id: makeId(), type, ipv4: '' }]",
    "connections: [...connections, { id: makeId(), type, vpn: type === 'VPN' ? 'OpenVPN' : '', ipv4: '' }]"
  )
  next = addVpnConnectionCardFields(next)
  next = addLinuxConnectionNameField(next)

  return next
}

function transformCpanelWebManager(code) {
  let next = code

  next = addMissingLucideImports(next, ['Globe', 'Mail'])

  next = next.replace(
    `<p className="font-medium text-slate-900">{cpanel.domain || 'Domínio sem nome'}</p>`,
    `<p className="font-medium text-slate-900 flex items-center gap-2"><Globe className="h-5 w-5 shrink-0 text-slate-500" />{cpanel.domain || 'Domínio sem nome'}</p>`
  )

  next = next.replace(
    `<p className="font-medium text-slate-900">{user.name || 'Usuário sem nome'}</p>`,
    `<p className="font-medium text-slate-900 flex items-center gap-2"><Mail className="h-5 w-5 shrink-0 text-slate-500" />{user.name || 'Usuário sem nome'}</p>`
  )

  return next
}

function transformVpnManager(code) {
  let next = code

  next = addMissingLucideImports(next, ['Server', 'UserRound'])

  next = next.replace(
    `<p className="font-medium text-slate-900">{server.name || 'Servidor VPN sem nome'} - {server.vpn || '-'}</p>`,
    `<p className="font-medium text-slate-900 flex items-center gap-2"><Server className="h-5 w-5 shrink-0 text-slate-500" />{server.name || 'Servidor VPN sem nome'} - {server.vpn || '-'}</p>`
  )

  next = next.replace(
    `<p className="font-medium text-slate-900">{user.personName || 'Pessoa não informada'}</p>`,
    `<p className="font-medium text-slate-900 flex items-center gap-2"><UserRound className="h-5 w-5 shrink-0 text-slate-500" />{user.personName || 'Pessoa não informada'}</p>`
  )

  return next
}

export default function clientVaultCardIconsPlugin() {
  return {
    name: 'client-vault-card-icons-transform',
    enforce: 'pre',
    transform(code, id) {
      let next = code

      if (id.endsWith('WindowsServerManager.jsx')) {
        next = transformWindowsServerManager(code)
        return next === code ? null : { code: next, map: null }
      }

      if (id.endsWith('LinuxServerManager.jsx')) {
        next = transformLinuxServerManager(code)
        return next === code ? null : { code: next, map: null }
      }

      if (id.endsWith('CpanelWebManager.jsx')) {
        next = transformCpanelWebManager(code)
        return next === code ? null : { code: next, map: null }
      }

      if (id.endsWith('VpnManager.jsx')) {
        next = transformVpnManager(code)
        return next === code ? null : { code: next, map: null }
      }

      return null
    }
  }
}
