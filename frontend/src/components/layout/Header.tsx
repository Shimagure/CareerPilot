import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, ShieldAlert, ChevronDown, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDemoMode } from '../../context/DemoModeContext';

interface HeaderProps {
  onOpenMobileNav: () => void;
}

export function Header({ onOpenMobileNav }: HeaderProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const { isDemoMode, loading, bootstrapDemo, resetDemo } = useDemoMode();

  const [accountOpen, setAccountOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    if (accountOpen) {
      document.addEventListener('mousedown', onClickOutside);
      return () => document.removeEventListener('mousedown', onClickOutside);
    }
  }, [accountOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initial = (user?.email ?? '?').charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-white/[0.06] bg-night-900/70 px-4 backdrop-blur-xl sm:px-6">
      {/* Left — mobile nav trigger */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="inline-flex items-center justify-center rounded-xl p-2.5 text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="hidden text-sm font-medium text-slate-500 sm:block">Your AI-assisted job search workspace</p>
      </div>

      {/* Right — demo + account */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => (isDemoMode ? resetDemo() : bootstrapDemo())}
          disabled={loading}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
            isDemoMode
              ? 'border-amber-500/40 bg-amber-500/[0.12] text-amber-300 hover:bg-amber-500/[0.2]'
              : 'border-white/[0.1] bg-white/[0.05] text-slate-400 hover:bg-white/[0.1] hover:text-slate-200'
          }`}
          aria-label={isDemoMode ? 'Exit demo mode (shows live data)' : 'Enable demo mode (simulated data)'}
        >
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{isDemoMode ? 'Demo Mode' : 'Demo'}</span>
        </button>

        {isAuthenticated && user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setAccountOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.05] py-1 pl-1 pr-2.5 transition-colors hover:bg-white/[0.1]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#7551ff,#49a3f1)] text-sm font-bold text-white">
                {initial}
              </span>
              <span className="hidden max-w-[160px] truncate text-xs font-medium text-slate-200 md:block">
                {user.email}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${accountOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {accountOpen && (
              <div
                role="menu"
                aria-label="Account menu"
                className="absolute right-0 top-full mt-2 w-60 rounded-2xl border border-white/[0.08] bg-night-800/95 p-2 shadow-card backdrop-blur-xl animate-fade-in"
              >
                <div className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#7551ff,#49a3f1)] text-sm font-bold text-white">
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">{user.email}</p>
                    <p className="text-[11px] capitalize text-slate-500">{user.status}</p>
                  </div>
                </div>
                <div className="border-t border-white/[0.06] pt-1">
                  <button
                    role="menuitem"
                    onClick={() => navigate('/profile')}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white"
                  >
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                    Profile
                  </button>
                  <button
                    role="menuitem"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-300/90 transition-colors hover:bg-red-500/[0.12] hover:text-red-200"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}