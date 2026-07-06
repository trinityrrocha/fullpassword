import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function readGitCommitFromDir(gitDir) {
  const headPath = path.join(gitDir, 'HEAD')

  if (!fs.existsSync(headPath)) return null

  const head = fs.readFileSync(headPath, 'utf8').trim()

  if (head.startsWith('ref:')) {
    const refPath = path.join(gitDir, head.replace('ref:', '').trim())

    if (fs.existsSync(refPath)) {
      return fs.readFileSync(refPath, 'utf8').trim().slice(0, 7)
    }

    return null
  }

  return head.slice(0, 7)
}

function readGitCommit() {
  const envCommit = process.env.VITE_APP_COMMIT || process.env.APP_COMMIT || process.env.GIT_COMMIT

  if (envCommit) {
    return String(envCommit).trim().slice(0, 7)
  }

  const possibleGitDirs = [
    path.resolve(__dirname, '..', '.git'),
    '/opt/fullpassword/.git',
    '/repo/.git'
  ]

  for (const gitDir of possibleGitDirs) {
    try {
      const commit = readGitCommitFromDir(gitDir)
      if (commit) return commit
    } catch {
      // Tenta o próximo local possível
    }
  }

  return 'unknown'
}

function clientVaultUiPlugin() {
  return {
    name: 'client-vault-ui-adjustments',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      next = next.replace(
        `{ id: 'ts', name: 'Servidor TS', icon: Server }`,
        `{ id: 'ts', name: 'Servidor Windows', icon: Server }`
      )

      next = next.replace(
        `  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');`,
        `  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');\n  const [userSearchTerm, setUserSearchTerm] = useState('');`
      )

      next = next.replace(
        `  const getServerLabel = (serverId) => {\n    const server = tsForm.servers.find((item) => item.id === serverId);\n    if (!server) return 'Servidor não informado';\n    return server.name ? \`${'${server.name}'} - ${'${server.ip || \'sem IP\''}\'}\` : server.ip || 'Servidor sem nome';\n  };`,
        `  const getServerLabel = (serverId) => {\n    const server = tsForm.servers.find((item) => item.id === serverId);\n    if (!server) return 'Servidor não informado';\n    return server.name ? \`${'${server.name}'} - ${'${server.ip || \'sem IP\''}\'}\` : server.ip || 'Servidor sem nome';\n  };\n\n  const filteredTsUsers = tsForm.users.filter((user) => {\n    const search = userSearchTerm.trim().toLowerCase();\n    if (!search) return true;\n\n    const haystack = [\n      user.name,\n      user.username,\n      user.permission,\n      getServerLabel(user.serverId)\n    ].join(' ').toLowerCase();\n\n    return haystack.includes(search);\n  });`
      )

      next = next.replace(
        `                <div className="mt-4 flex justify-end">\n                  <button onClick={addTsUser} type="button" disabled={isSaving} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">\n                    <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Adicionar Usuário'}\n                  </button>\n                </div>`,
        `                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">\n                  <input\n                    type="text"\n                    className="w-full sm:max-w-md border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500"\n                    value={userSearchTerm}\n                    onChange={(e) => setUserSearchTerm(e.target.value)}\n                    placeholder="Pesquisar usuário, login, permissão ou servidor"\n                  />\n                  <button onClick={addTsUser} type="button" disabled={isSaving} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">\n                    <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Adicionar Usuário'}\n                  </button>\n                </div>`
      )

      next = next.replace(
        `                  {tsForm.users.length === 0 ? (\n                    <p className="text-sm text-slate-500">Nenhum usuário cadastrado.</p>\n                  ) : tsForm.users.map((user) => (`,
        `                  {filteredTsUsers.length === 0 ? (\n                    <p className="text-sm text-slate-500">Nenhum usuário encontrado.</p>\n                  ) : filteredTsUsers.map((user) => (`
      )

      return next === code ? null : { code: next, map: null }
    }
  }
}

const appCommit = readGitCommit()

// https://vite.dev/config/
export default defineConfig({
  plugins: [clientVaultUiPlugin(), react()],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit),
    Share2: '((props) => null)',
    handleShareClick: '((category) => window.alert(`Compartilhamento de ${category} ainda não foi implementado nesta versão.`))'
  }
})
