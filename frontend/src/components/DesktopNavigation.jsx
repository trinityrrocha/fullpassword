import { Link, useLocation } from 'react-router-dom';
import { Shield, LogOut } from 'lucide-react';
import { normalizeNavigationPreferences } from '../utils/navigationPreferences';

function Tooltip({ children, side }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute z-[60] whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow group-hover:opacity-100 group-focus-within:opacity-100 ${side ? 'left-full ml-2' : 'top-full mt-2 right-0'}`}>{children}</span>;
}

export default function DesktopNavigation({ user, navigation, onProfile, onLogout, children }) {
  const { pathname } = useLocation();
  const preferences = normalizeNavigationPreferences(user);
  const top = preferences.menu_position === 'top';
  const icons = preferences.menu_display === 'icons';
  const Container = top ? 'header' : 'aside';
  const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400';
  return <Container data-desktop-navigation={`${preferences.menu_position}/${preferences.menu_display}`} className={top
    ? 'hidden h-16 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 text-white md:flex'
    : `hidden shrink-0 flex-col bg-slate-900 text-white md:flex ${icons ? 'w-20' : 'w-64'}`}>
    <div className={`flex shrink-0 items-center justify-center ${top ? 'pr-1' : 'h-16 border-b border-slate-800'}`} title="FullPassword" aria-label="FullPassword">
      <Shield className="h-7 w-7 shrink-0 text-indigo-400" aria-hidden="true" />
      {!icons && <span className={`ml-2 font-bold ${top ? 'text-base' : 'text-xl'}`}>FullPassword</span>}
    </div>
    <nav aria-label="Menu principal" className={top ? 'flex min-w-0 flex-1 items-center gap-1' : 'flex-1 space-y-1 px-2 py-4'}>
      {navigation.map((item) => {
        const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
        return <Link key={item.href} to={item.href} title={item.name} aria-label={item.name} aria-current={active ? 'page' : undefined}
          className={`group relative flex min-w-0 items-center rounded-md text-sm font-medium transition-colors ${focus} ${icons ? 'justify-center px-3 py-3' : top ? 'px-2 py-2' : 'px-4 py-3'} ${active ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          {icons ? <><item.icon className="h-5 w-5 shrink-0" aria-hidden="true" /><Tooltip side={!top}>{item.name}</Tooltip></> : <span className="truncate">{item.name}</span>}
        </Link>;
      })}
    </nav>
    <div className={top ? 'flex shrink-0 items-center gap-2' : `border-t border-slate-800 ${icons ? 'space-y-3 p-2' : 'space-y-3 p-4'}`}>
      {top && children}
      <button type="button" title="Meu Perfil" aria-label="Meu Perfil" onClick={onProfile} className={`group relative flex items-center rounded-md ${focus} ${top ? '' : 'w-full'} ${icons ? 'justify-center' : ''}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold text-white">{user?.name?.charAt(0) || 'U'}</span>
        {!top && !icons && <span className="ml-3 min-w-0 text-left"><span className="block truncate text-sm">{user?.name || 'Usuário'}</span><span className="block text-xs text-slate-400">{user?.is_super_admin ? 'Super Admin' : user?.role || 'user'}</span></span>}
        {(top || icons) && <Tooltip side={!top}>Meu Perfil</Tooltip>}
      </button>
      <button type="button" title="Sair" aria-label="Sair" onClick={onLogout} className={`group relative flex items-center rounded-md p-2 text-sm text-slate-300 hover:bg-red-500/10 hover:text-red-400 ${focus} ${top ? '' : 'w-full'} ${icons ? 'justify-center' : ''}`}>
        {icons ? <><LogOut className="h-5 w-5" aria-hidden="true" /><Tooltip side={!top}>Sair</Tooltip></> : 'Sair'}
      </button>
    </div>
  </Container>;
}
