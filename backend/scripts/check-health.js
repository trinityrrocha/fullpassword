const { isReadyResponse } = require('../src/config/runtimeReadiness');

const checkHealth = async (expectedCommit, checkFrontend = false, request = fetch) => {
  const response = await request('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(3000) });
  if (!response.ok || !isReadyResponse(await response.json(), expectedCommit)) throw new Error('BACKEND_NOT_READY');
  if (checkFrontend) {
    const frontend = await request('http://frontend/', { signal: AbortSignal.timeout(3000) });
    if (!frontend.ok) throw new Error('FRONTEND_NOT_READY');
  }
};
if (require.main === module) {
  checkHealth(process.argv[2] || undefined, process.argv[3] === '--frontend')
    .catch(() => { console.error('Deploy não está pronto: verificar backend, schema e versão da imagem.'); process.exitCode = 1; });
}
module.exports = { checkHealth };
