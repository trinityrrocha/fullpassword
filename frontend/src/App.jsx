import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';

// Páginas (serão criadas nos próximos passos)
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ClientsList from './pages/ClientsList';
import ClientVault from './pages/ClientVault';
import TeamList from './pages/TeamList';
import Settings from './pages/Settings';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';

function VaultAwareDashboardLayout() {
  const { vaultStateEpoch } = useAuth();
  return <DashboardLayout key={vaultStateEpoch} />;
}

function RouteErrorFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <section role="alert" className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6 text-center shadow dark:border-red-900 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Não foi possível abrir esta página</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Recarregue a aplicação. Se o problema continuar, entre em contato com o administrador.
        </p>
        <button
          type="button"
          onClick={() => window.location.assign('/')}
          className="mt-5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Voltar ao início
        </button>
      </section>
    </main>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} errorElement={<RouteErrorFallback />} />
        <Route path="/forgot-password" element={<ForgotPassword />} errorElement={<RouteErrorFallback />} />
        <Route path="/reset-password" element={<ResetPassword />} errorElement={<RouteErrorFallback />} />
        
        {/* Rotas Protegidas com AuthGuard */}
        <Route element={<VaultAwareDashboardLayout />} errorElement={<RouteErrorFallback />}>
          {/* Rotas para todos os usuários logados */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<ClientsList />} />
            <Route path="/client/:id" element={<ClientVault />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Rotas apenas para administradores */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/team" element={<TeamList />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
