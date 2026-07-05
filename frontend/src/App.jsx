import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';

// Páginas (serão criadas nos próximos passos)
import Login from './pages/Login';
import ClientsList from './pages/ClientsList';
import ClientVault from './pages/ClientVault';
import TeamList from './pages/TeamList';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Rotas Protegidas com AuthGuard */}
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<ClientsList />} />
            <Route path="/client/:id" element={<ClientVault />} />
            <Route path="/team" element={<TeamList />} />
            <Route path="/settings" element={<div className="p-4 bg-white rounded-lg shadow">Configurações (Em breve)</div>} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
