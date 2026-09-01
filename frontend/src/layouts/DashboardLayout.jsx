import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, Settings, Shield, LogOut, Menu, X, Building2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import UserProfileModal from '../components/UserProfileModal';
import ScreenProtection from '../components/ScreenProtection';
import api from '../services/api';
import { SCREEN_PROTECTION_CHANGED_EVENT } from '../utils/screenProtection';
import useClearOnVaultLock from '../hooks/useClearOnVaultLock';
import UserCryptoIdentitySetup from '../components/UserCryptoIdentitySetup';
import SecurityNotificationsMenu from '../components/SecurityNotificationsMenu';
import ThemeToggle from '../components/ThemeToggle';

export default function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [notifications, setNotifications] = useState({ unread_count: 0, items: [] });
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [screenProtectionEnabled, setScreenProtectionEnabled] = useState(true);

  const { user, logout } = useAuth();
  const mustChangePassword = user?.must_change_password === true;

  useClearOnVaultLock(() => {
    setIsMobileMenuOpen(false);
    setIsProfileModalOpen(false);
    setIsNotificationsOpen(false);
  });

  useEffect(() => {
    if (!user?.is_super_admin) return undefined;
    let isMounted = true;
    const refreshNotifications = () => {
      api.get('/system/security-notifications')
        .then((response) => {
          if (isMounted) setNotifications(response.data);
        })
        .catch(() => {
          if (isMounted) setNotifications({ unread_count: 0, items: [] });
        });
    };

    refreshNotifications();
    const refreshInterval = window.setInterval(refreshNotifications, 60000);
    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
    };
  }, [user?.is_super_admin]);

  useEffect(() => {
    if (!user?.id) return undefined;

    let isMounted = true;
    const handleProtectionChange = (event) => {
      setScreenProtectionEnabled(event.detail?.enabled !== false);
    };

    window.addEventListener(SCREEN_PROTECTION_CHANGED_EVENT, handleProtectionChange);
    api.get('/system/screen-protection')
      .then((response) => {
        if (isMounted) setScreenProtectionEnabled(response.data.enabled !== false);
      })
      .catch(() => {
        if (isMounted) setScreenProtectionEnabled(true);
      });

    return () => {
      isMounted = false;
      window.removeEventListener(SCREEN_PROTECTION_CHANGED_EVENT, handleProtectionChange);
    };
  }, [user?.id]);

  const closeNotifications = useCallback(() => {
    setIsNotificationsOpen(false);
  }, []);

  const openNotification = (targetUrl) => {
    setIsNotificationsOpen(false);
    navigate(targetUrl);
  };

  const toggleNotifications = async () => {
    if (isNotificationsOpen) {
      setIsNotificationsOpen(false);
      return;
    }

    setIsNotificationsOpen(true);
    let response;
    try {
      response = await api.get('/system/security-notifications');
    } catch {
      return;
    }

    const nextNotifications = response.data || { unread_count: 0, items: [] };
    setNotifications(nextNotifications);
    const unreadCount = Number(nextNotifications.unread_count || 0);
    const seenThrough = nextNotifications.items?.[0]?.created_at;
    if (unreadCount <= 0 || !seenThrough) return;

    setNotifications((current) => ({ ...current, unread_count: 0 }));
    try {
      const seenResponse = await api.post('/system/security-notifications/mark-seen', {
        seen_through: seenThrough
      });
      setNotifications((current) => ({
        ...current,
        unread_count: Number(seenResponse.data?.unread_count || 0),
        last_seen_at: seenResponse.data?.last_seen_at || seenThrough
      }));
    } catch {
      setNotifications((current) => ({ ...current, unread_count: unreadCount }));
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navigation = [
    { name: 'Clientes / Cofre', href: '/', icon: Building2 },
    ...(user?.role === 'admin' ? [{ name: 'Gestão de Equipe', href: '/team', icon: Users }] : []),
    { name: 'Configurações', href: '/settings', icon: Settings },
  ];

  return (
    <ScreenProtection enabled={screenProtectionEnabled}>
      <div className="flex h-screen bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 bg-slate-900 text-white md:flex md:flex-col">
        <div className="flex items-center justify-center h-16 border-b border-slate-800">
          <Shield className="w-8 h-8 text-indigo-400 mr-2" />
          <span className="text-xl font-bold">FullPassword</span>
        </div>
        
        <div className="flex flex-col flex-1 overflow-y-auto">
          <nav className="flex-1 px-2 py-4 space-y-1">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || 
                              (item.href !== '/' && location.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex items-center px-4 py-3 text-sm font-medium rounded-md transition-colors ${
                    isActive 
                      ? 'bg-indigo-600 text-white' 
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold cursor-pointer hover:bg-indigo-400" onClick={() => setIsProfileModalOpen(true)} title="Meu Perfil">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="ml-3 cursor-pointer" onClick={() => setIsProfileModalOpen(true)}>
              <p className="text-sm font-medium text-white hover:text-indigo-300">{user?.name || 'Usuário'}</p>
              <p className="text-xs text-slate-400 capitalize">{user?.is_super_admin ? 'Super Admin' : user?.role || 'user'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-2 text-sm font-medium text-slate-300 rounded-md hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sair
          </button>
        </div>
      </aside>

      {/* Mobile Header & Menu */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-slate-900 text-white flex items-center justify-between gap-2 px-4 z-50 dark:border-b dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center">
          <Shield className="w-6 h-6 text-indigo-400 mr-2" />
          <span className="text-lg font-bold">FullPassword</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <button type="button" aria-label={isMobileMenuOpen ? 'Fechar menu' : 'Abrir menu'} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 top-16 bg-slate-900 z-40 flex flex-col">
          <nav className="flex-1 px-4 py-6 space-y-2">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center px-4 py-3 text-base font-medium rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <item.icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            ))}
          </nav>
          <div className="p-4 border-t border-slate-800">
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-4 py-3 text-base font-medium text-red-400 rounded-md hover:bg-red-500/10"
            >
              <LogOut className="w-5 h-5 mr-3" />
              Sair
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden pt-16 md:pt-0">
        <div className="hidden h-16 shrink-0 items-center justify-end gap-2 border-b border-slate-200 bg-white px-8 md:flex dark:border-slate-800 dark:bg-slate-900">
          <ThemeToggle />
          {user?.is_super_admin && (
            <SecurityNotificationsMenu
              notifications={notifications}
              isOpen={isNotificationsOpen}
              onToggle={toggleNotifications}
              onClose={closeNotifications}
              onNavigate={openNotification}
            />
          )}
        </div>
        {user?.password_change_recommended && !mustChangePassword && (
          <button type="button" onClick={() => setIsProfileModalOpen(true)} className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-left text-sm text-amber-900 md:px-8 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Sua senha está antiga. Recomendamos atualizá-la. Clique aqui para abrir seu perfil.
          </button>
        )}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </div>
      </main>

      <UserProfileModal 
        isOpen={isProfileModalOpen || mustChangePassword}
        onClose={() => {
          if (!mustChangePassword) setIsProfileModalOpen(false);
        }}
        forcePasswordChange={mustChangePassword}
      />
      <UserCryptoIdentitySetup />
      </div>
    </ScreenProtection>
  );
}
