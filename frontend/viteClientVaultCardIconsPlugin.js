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

  next = addMissingLucideImports(next, ['Server', 'UserRound', 'UserStar', 'TriangleAlert'])

  if (!next.includes('function PermissionIcon')) {
    next = next.replace(
      'const directionOptions = [\'Entrada\', \'Saída\'];',
      `const directionOptions = ['Entrada', 'Saída'];

const getPermissionIconConfig = (permission = '') => {
  const normalizedPermission = String(permission || '').toLowerCase();

  if (normalizedPermission === 'sistema') {
    return { Icon: TriangleAlert, className: 'text-amber-500' };
  }

  if (normalizedPermission.includes('admin')) {
    return { Icon: UserStar, className: 'text-[#ff8a78]' };
  }

  return { Icon: UserRound, className: 'text-slate-500' };
};

function PermissionIcon({ permission }) {
  const { Icon, className } = getPermissionIconConfig(permission);
  return <Icon className={'h-5 w-5 shrink-0 ' + className} />;
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

      return null
    }
  }
}
