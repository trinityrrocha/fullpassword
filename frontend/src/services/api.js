import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  // Axios precisa definir JSON ou multipart (com boundary) conforme o corpo enviado.
  withCredentials: true,
});

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const CSRF_EXEMPT_PATHS = ['/auth/login', '/auth/bootstrap', '/auth/mfa/verify-login', '/auth/mfa/setup/confirm'];
const readCookie = (name) => document.cookie
  .split('; ')
  .find((item) => item.startsWith(`${name}=`))
  ?.slice(name.length + 1);

let csrfRefreshPromise = null;
api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toLowerCase();
  const url = String(config.url || '');
  if (!MUTATING_METHODS.has(method) || CSRF_EXEMPT_PATHS.some((path) => url.includes(path))) return config;

  let csrfToken = readCookie('fp_csrf');
  if (!csrfToken) {
    csrfRefreshPromise ||= api.get('/auth/csrf').finally(() => { csrfRefreshPromise = null; });
    await csrfRefreshPromise;
    csrfToken = readCookie('fp_csrf');
  }
  if (csrfToken) config.headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));
  return config;
});

// Interceptor para tratar erros globais (ex: token expirado)
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      const url = error.config?.url || '';
      if (!url.includes('/auth/login') && !url.includes('/auth/me')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
