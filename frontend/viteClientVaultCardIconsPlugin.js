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

function transformWindowsServerManager(code) {
  let next = code

  next = addMissingLucideImports(next, ['Server', 'UserRound', 'UserStar', 'TriangleAlert', 'ShieldCheck', 'EthernetPort'])

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
