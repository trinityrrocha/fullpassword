import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Shield } from 'lucide-react';
import api from '../services/api';

const GENERIC_MESSAGE = 'Se o e-mail estiver cadastrado, enviaremos instruções para recuperação de acesso.';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');
    setIsLoading(true);
    try {
      await api.post('/auth/password-reset/request', { email });
      setEmail('');
      setMessage(GENERIC_MESSAGE);
    } catch (error) {
      if (error.response?.status === 429) {
        setMessage(error.response?.data?.error || 'Muitas tentativas de recuperação. Aguarde alguns minutos e tente novamente.');
      } else {
        // A interface não distingue conta inexistente, SMTP indisponível ou falha
        // interna, evitando enumeração de usuários.
        setMessage(GENERIC_MESSAGE);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100">
          <Mail className="h-7 w-7 text-indigo-600" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-center text-2xl font-semibold text-slate-900">Recuperar acesso</h1>
        <p className="mt-2 text-center text-sm text-slate-600">
          Informe o e-mail da conta. Se ele estiver cadastrado e ativo, enviaremos um link temporário.
        </p>

        {message && (
          <div role="status" className="mt-5 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
            {message}
          </div>
        )}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="recovery-email" className="block text-sm font-medium text-slate-700">E-mail</label>
            <input
              id="recovery-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value.toLowerCase())}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Shield className="mr-2 h-4 w-4" aria-hidden="true" />
            {isLoading ? 'Enviando...' : 'Enviar instruções'}
          </button>
        </form>

        <Link to="/login" className="mt-5 block text-center text-sm font-medium text-indigo-600 hover:text-indigo-800">
          Voltar para o login
        </Link>
      </section>
    </main>
  );
}
