import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock } from 'lucide-react';
import SecurePasswordInput from '../components/SecurePasswordInput';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [superAdminEmail, setSuperAdminEmail] = useState('');
  const [bootstrap, setBootstrap] = useState({ name: '', email: '', password: '', confirm: '', token: '' });
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    api.get('/auth/bootstrap/status')
      .then(({ data }) => {
        const configuredSuperAdminEmail = data.super_admin_email || '';
        setSuperAdminEmail(configuredSuperAdminEmail);
        setBootstrapRequired(Boolean(data.required));
        if (data.required) {
          setBootstrap((value) => ({ ...value, email: configuredSuperAdminEmail }));
        }
      })
      .catch(() => setError('Não foi possível verificar a configuração inicial.'));
  }, []);

  const handleBootstrap = async (e) => {
    e.preventDefault();
    setError('');
    if (superAdminEmail && bootstrap.email.trim().toLowerCase() !== superAdminEmail.toLowerCase()) {
      return setError(`O primeiro administrador deve usar o e-mail do Super Admin: ${superAdminEmail}`);
    }
    if (bootstrap.password.length < 12) return setError('A senha deve ter ao menos 12 caracteres.');
    if (bootstrap.password !== bootstrap.confirm) return setError('As senhas não coincidem.');
    setIsLoading(true);
    try {
      await api.post('/auth/bootstrap', {
        name: bootstrap.name,
        email: bootstrap.email,
        password: bootstrap.password,
        bootstrap_token: bootstrap.token
      });
      setEmail(bootstrap.email);
      setBootstrapRequired(false);
      setBootstrap({ name: '', email: '', password: '', confirm: '', token: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível configurar o administrador.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await login(email, password);
      
      if (result.success) {
        const userData = JSON.parse(localStorage.getItem('user') || '{}');
        if (userData.wrapped_key) {
          localStorage.setItem('user_wrapped_key', userData.wrapped_key);
          localStorage.setItem('user_salt', userData.crypto_salt);
        }

        navigate('/');
      } else {
        setError(result.error || 'Credenciais inválidas. Tente novamente.');
      }
    } catch {
      setError('Erro ao conectar com o servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="rounded-full bg-indigo-100 p-3">
            <Shield className="h-12 w-12 text-indigo-600" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900">
          FullPassword
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          Gerenciamento Seguro de Credenciais para MSP
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
          <form className="space-y-6" onSubmit={bootstrapRequired ? handleBootstrap : handleLogin}>
            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 p-4">
                <div className="flex">
                  <div className="ml-3">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {bootstrapRequired && (
              <div className="bg-amber-50 border-l-4 border-amber-400 p-4">
                <p className="text-sm text-amber-700">
                  Configuração inicial: o primeiro administrador será o Super Admin do sistema.
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  E-mail obrigatório do Super Admin: {superAdminEmail}
                </p>
              </div>
            )}

            {bootstrapRequired && (
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700">Nome do administrador</label>
                <input id="name" type="text" required value={bootstrap.name}
                  onChange={(e) => setBootstrap((value) => ({ ...value, name: e.target.value }))}
                  className="mt-1 appearance-none block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm" />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                E-mail
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={bootstrapRequired ? bootstrap.email : email}
                  onChange={(e) => bootstrapRequired
                    ? setBootstrap((value) => ({ ...value, email: e.target.value }))
                    : setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder={bootstrapRequired ? superAdminEmail : 'mail@exemplo.com'}
                />
              </div>
            </div>

            <div>
              <SecurePasswordInput
                name="password"
                label={bootstrapRequired ? 'Nova senha Master' : 'Senha Master'}
                value={bootstrapRequired ? bootstrap.password : password}
                onChange={(e) => bootstrapRequired
                  ? setBootstrap((value) => ({ ...value, password: e.target.value }))
                  : setPassword(e.target.value)}
                required={true}
                enableGenerator={bootstrapRequired}
                placeholder="Sua senha mestre"
              />
            </div>

            {bootstrapRequired && <>
              <div>
                <SecurePasswordInput name="confirm" label="Confirmar senha" value={bootstrap.confirm}
                  onChange={(e) => setBootstrap((value) => ({ ...value, confirm: e.target.value }))}
                  required={true} enableGenerator={false} />
              </div>
              <div>
                <label htmlFor="bootstrap-token" className="block text-sm font-medium text-slate-700">Token de instalação</label>
                <input id="bootstrap-token" type="password" required autoComplete="off" value={bootstrap.token}
                  onChange={(e) => setBootstrap((value) => ({ ...value, token: e.target.value }))}
                  className="mt-1 appearance-none block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm" />
              </div>
            </>}

            {!bootstrapRequired && <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-900">
                  Lembrar-me
                </label>
              </div>

              <div className="text-sm">
                <a href="#" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Esqueceu a senha?
                </a>
              </div>
            </div>}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {isLoading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {bootstrapRequired ? 'Configurando...' : 'Autenticando...'}
                  </span>
                ) : (
                  <span className="flex items-center">
                    <Lock className="w-4 h-4 mr-2" />
                    {bootstrapRequired ? 'Cadastrar Super Admin' : 'Acessar Cofre'}
                  </span>
                )}
              </button>
            </div>
          </form>
          
          <div className="mt-6 border-t border-slate-200 pt-6">
            <p className="text-xs text-center text-slate-500">
              Seus dados sensíveis são criptografados antes de serem armazenados.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
