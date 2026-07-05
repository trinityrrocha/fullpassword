import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function readGitCommit() {
  try {
    const gitDir = path.resolve(__dirname, '..', '.git')
    const headPath = path.join(gitDir, 'HEAD')

    if (!fs.existsSync(headPath)) return 'unknown'

    const head = fs.readFileSync(headPath, 'utf8').trim()

    if (head.startsWith('ref:')) {
      const refPath = path.join(gitDir, head.replace('ref:', '').trim())
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, 'utf8').trim().slice(0, 7)
      }
    }

    return head.slice(0, 7)
  } catch {
    return 'unknown'
  }
}

const appCommit = readGitCommit()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit),
    Share2: 'HardDrive',
    handleShareClick: '((category) => window.alert(`Compartilhamento de ${category} ainda não foi implementado nesta versão.`))'
  }
})
