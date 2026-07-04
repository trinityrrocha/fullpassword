import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';

// Páginas (serão criadas nos próximos passos)
import Login from './pages/Login';
import ClientsList from './pages/ClientsList';
import ClientVault from './pages/ClientVault';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Rotas Protegidas */}
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<ClientsList />} />
          <Route path="/client/:id" element={<ClientVault />} />
          <Route path="/team" element={<div className="p-4 bg-white rounded-lg shadow">Gestão de Equipe (Em breve)</div>} />
          <Route path="/settings" element={<div className="p-4 bg-white rounded-lg shadow">Configurações (Em breve)</div>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
