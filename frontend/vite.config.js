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

const appCommit = readGitCommit()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit),
    Share2: '((props) => null)',
    handleShareClick: '((category) => window.alert(`Compartilhamento de ${category} ainda não foi implementado nesta versão.`))'
  }
})
