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

      if (!next.includes("CpanelWebManager")) {
        next = next.replace(
          `import api from '../services/api';`,
          `import api from '../services/api';\nimport CpanelWebManager from '../components/CpanelWebManager';`
        )
      }

      next = next.replace(
        /          \{activeTab === 'cpanel' && \(\n[\s\S]*?\n          \)\}\n\n          \{activeTab === 'vpn' && \(/,
        `          {activeTab === 'cpanel' && (
            <CpanelWebManager
              cpanelForm={cpanelForm}
              setCpanelForm={setCpanelForm}
              handleSaveData={handleSaveData}
              isSaving={isSaving}
            />
          )}

          {activeTab === 'vpn' && (`
      )

      next = next.replace(
        `{ id: 'ts', name: 'Servidor TS', icon: Server }`,
        `{ id: 'ts', name: 'Servidor Windows', icon: Server }`
      )

      next = next.replace(
        `  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');`,
        `  const [deleteUserConfirmation, setDeleteUserConfirmation] = useState('');\n  const [userSearchTerm, setUserSearchTerm] = useState('');`
      )

      next = next.replace(
        `  const getServerLabel = (serverId) => {
    const server = tsForm.servers.find((item) => item.id === serverId);
    if (!server) return 'Servidor não informado';
    return server.name ? \`${'${server.name}'} - ${'${server.ip || \'sem IP\''}\'}\` : server.ip || 'Servidor sem nome';
  };`,
        `  const getServerLabel = (serverId) => {
    const server = tsForm.servers.find((item) => item.id === serverId);
    if (!server) return 'Servidor não informado';
    return server.name ? \`${'${server.name}'} - ${'${server.ip || \'sem IP\''}\'}\` : server.ip || 'Servidor sem nome';
  };

  const filteredTsUsers = tsForm.users.filter((user) => {
    const search = userSearchTerm.trim().toLowerCase();
    if (!search) return true;

    const haystack = [
      user.name,
      user.username,
      user.permission,
      getServerLabel(user.serverId)
    ].join(' ').toLowerCase();

    return haystack.includes(search);
  });`
      )

      if (!next.includes('const filteredTsUsers = tsForm.users.filter')) {
        next = next.replace(
          `  const loadVaultItems = async () => {`,
          `  const filteredTsUsers = tsForm.users.filter((user) => {
    const search = userSearchTerm.trim().toLowerCase();
    if (!search) return true;

    const haystack = [
      user.name,
      user.username,
      user.permission,
      getServerLabel(user.serverId)
    ].join(' ').toLowerCase();

    return haystack.includes(search);
  });

  const loadVaultItems = async () => {`
        )
      }

      next = next.replace(
        `                <div className="mt-4 flex justify-end">
                  <button onClick={addTsUser} type="button" disabled={isSaving} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                    <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Adicionar Usuário'}
                  </button>
                </div>`,
        `                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <input
                    type="text"
                    className="w-full sm:max-w-md border-slate-300 rounded-md shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500"
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                    placeholder="Pesquisar usuário, login, permissão ou servidor"
                  />
                  <button onClick={addTsUser} type="button" disabled={isSaving} className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                    <Plus className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Adicionar Usuário'}
                  </button>
                </div>`
      )

      next = next.replace(
        `                  {tsForm.users.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum usuário cadastrado.</p>
                  ) : tsForm.users.map((user) => (`,
        `                  {filteredTsUsers.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum usuário encontrado.</p>
                  ) : filteredTsUsers.map((user) => (`
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
