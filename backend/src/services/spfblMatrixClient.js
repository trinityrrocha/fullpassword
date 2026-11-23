const https = require('node:https');

// Port of the Matrix adapter of the original PHP SPFBL portal (Matrix.php). Fixed host, TLS verified, no redirects, bounded
// response, and only fixed diagnostic tokens ever leave this module: the provider takes the credentials in the
// query string, so the URL, the query and the response body must never reach logs, errors or the audit trail.
const MATRIX_HOST = 'matrix.spfbl.net';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20000;
// Phase 1 only checks the connection (history). Extend deliberately in the phase that needs more.
const ENDPOINTS = new Set(['history']);

class MatrixError extends Error {
  constructor(message, code, statusCode = 502, diagnostic = '') {
    super(message);
    this.name = 'MatrixError';
    this.code = code;
    this.statusCode = statusCode;
    this.diagnostic = diagnostic;
  }
}

const RESULTS = new Set(['VALID', 'DONE', 'INVALID', 'EXPIRED', 'FAIL', 'NOTFOUND', 'UNAVAILABLE']);
const INFORMATION = new Map([
  ['valid credential', 'VALID_CREDENTIAL'],
  ['invalid credential', 'INVALID_CREDENTIAL'],
  ['expired session', 'EXPIRED_SESSION'],
  ['invalid key', 'INVALID_KEY'],
  ['registry not found', 'REGISTRY_NOT_FOUND'],
  ['you cannot define the credential here for security reasons', 'CREDENTIAL_MODE_REFUSED'],
  ['no parameters was provided', 'NO_PARAMETERS'],
  ['unavailable service', 'UNAVAILABLE_SERVICE']
]);

const responseDiagnostic = (data) => {
  const result = data.result;
  const code = result === undefined || result === null ? 'MISSING'
    : typeof result !== 'string' ? 'INVALID_TYPE'
      : RESULTS.has(result) ? result : 'OTHER';
  const information = data.information;
  const info = information === undefined || information === null ? 'MISSING'
    : typeof information !== 'string' ? 'INVALID_TYPE'
      : INFORMATION.get(information) || 'OTHER';
  return ` result=${code} info=${info}`;
};

// Test hooks (connectTo, port, ca, maxBytes) are never passed by request(): production always connects to the fixed
// host over the system trust store. A total timer bounds the exchange (https.request's own timeout is idle-only).
const defaultTransport = ({ endpoint, query, timeoutMs, connectTo, port = 443, ca, maxBytes = MAX_RESPONSE_BYTES }) => new Promise((resolve, reject) => {
  let finished = false;
  let timer;
  const finish = (action, value) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    action(value);
  };
  const connectionFailed = () => new MatrixError('Falha de conexão com o Matrix.', 'MATRIX_CONNECTION_FAILED', 502);
  const request = https.request({
    host: connectTo || MATRIX_HOST,
    port,
    method: 'GET',
    path: `/${endpoint}/?${query}`,
    servername: MATRIX_HOST,
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
    agent: false,
    timeout: timeoutMs,
    headers: { Accept: 'application/json', 'User-Agent': 'FullPassword-SPFBL/1', Host: MATRIX_HOST }
  }, (response) => {
    const chunks = [];
    let size = 0;
    response.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        request.destroy();
        finish(reject, new MatrixError('Resposta do Matrix excedeu o limite.', 'MATRIX_RESPONSE_TOO_LARGE', 502));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => finish(resolve, { status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    response.on('error', () => finish(reject, connectionFailed()));
  });
  const expire = () => { request.destroy(); finish(reject, connectionFailed()); };
  timer = setTimeout(expire, timeoutMs);
  request.on('timeout', expire);
  request.on('error', () => finish(reject, connectionFailed()));
  request.end();
});

const request = async (endpoint, { user, password, params = {} }, { transport = defaultTransport, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  if (!ENDPOINTS.has(endpoint)) throw new MatrixError('Operação Matrix não permitida.', 'MATRIX_ENDPOINT_FORBIDDEN', 403);
  let diagnostic = endpoint;
  const fail = (message, code, statusCode = 502) => { throw new MatrixError(message, code, statusCode, diagnostic); };
  if (!user || !password) {
    diagnostic += ' NOT_CONFIGURED';
    fail('Matrix não configurado. Salve o usuário e a senha antes de testar.', 'MATRIX_NOT_CONFIGURED', 422);
  }
  const query = new URLSearchParams({ user, password, ...params }).toString();
  let response;
  try {
    response = await transport({ endpoint, query, timeoutMs });
  } catch (error) {
    if (error instanceof MatrixError) { error.diagnostic = `${diagnostic} ${error.code === 'MATRIX_RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'CONNECTION_FAILED'}`; throw error; }
    diagnostic += ' CONNECTION_FAILED';
    return fail('Não foi possível concluir a conexão com o Matrix.', 'MATRIX_CONNECTION_FAILED');
  }
  diagnostic += ` HTTP=${Number(response?.status) || 0}`;
  if (response?.status !== 200) fail('O Matrix retornou um HTTP inesperado. Tente novamente mais tarde.', 'MATRIX_HTTP_UNEXPECTED');
  const body = typeof response.body === 'string' ? response.body : '';
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) { diagnostic += ' RESPONSE_TOO_LARGE'; fail('Resposta do Matrix excedeu o limite.', 'MATRIX_RESPONSE_TOO_LARGE'); }
  let data;
  try { data = JSON.parse(body); } catch { diagnostic += ' INVALID_JSON'; return fail('Resposta JSON inválida do Matrix.', 'MATRIX_INVALID_JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { diagnostic += ' INVALID_JSON_SHAPE'; return fail('Formato JSON inesperado do Matrix.', 'MATRIX_INVALID_SHAPE'); }
  diagnostic += responseDiagnostic(data);
  if (data.result !== 'VALID') {
    if (data.result === 'INVALID' || data.result === 'EXPIRED') fail('O Matrix recusou a autenticação. Revise o usuário e a senha.', 'MATRIX_AUTH_REFUSED', 422);
    fail('O Matrix não confirmou a consulta. Encaminhe o código de diagnóstico ao administrador.', 'MATRIX_NOT_CONFIRMED');
  }
  return { data, diagnostic };
};

// Validates credentials by reading one page of history; the content is never returned or stored.
const testConnection = async (credentials, options) => {
  const { data, diagnostic } = await request('history', credentials, options);
  if (!Array.isArray(data.message)) {
    throw new MatrixError('Estrutura do histórico do Matrix inesperada.', 'MATRIX_INVALID_SHAPE', 502, `${diagnostic} MESSAGE_NOT_LIST`);
  }
  return { ok: true, diagnostic };
};

module.exports = { MATRIX_HOST, MatrixError, request, testConnection, defaultTransport };
