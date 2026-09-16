import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  Trophy,
  Bookmark,
  Search,
  Files,
  Sparkles,
  Activity,
  GitBranch,
  Archive,
  UserRound,
  FileText,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Rocket,
  Server,
  Users,
} from 'lucide-react';
import { useDemoMode } from '../../context/DemoModeContext';
import { useAuth } from '../../context/AuthContext';

interface NavItem {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Jobs',
    items: [
      { name: 'All Jobs', href: '/jobs', icon: Briefcase },
      { name: 'Ranked Jobs', href: '/ranked', icon: Trophy },
      { name: 'Saved Jobs', href: '/saved-jobs', icon: Bookmark },
      { name: 'Job Search', href: '/search', icon: Search },
    ],
  },
  {
    label: 'Applications',
    items: [
      { name: 'Applications', href: '/applications', icon: Files },
      { name: 'Application Assistant', href: '/assistant', icon: Sparkles },
    ],
  },
  {
    label: 'System',
    items: [
      { name: 'Pipeline Health', href: '/health', icon: Activity },
      { name: 'Pipeline', href: '/pipeline', icon: GitBranch },
      { name: 'Retention', href: '/retention', icon: Archive },
      { name: 'Profile', href: '/profile', icon: UserRound },
      { name: 'Resume', href: '/resume', icon: FileText },
    ],
  },
  {
    label: 'Settings',
    items: [{ name: 'Search Preferences', href: '/preferences', icon: Settings }],
  },
];

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarProps {
  mobileOpen: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}

export function Sidebar({ mobileOpen, collapsed, onToggleCollapsed, onCloseMobile }: SidebarProps) {
  const location = useLocation();
  const { isDemoMode, loading, bootstrapDemo, resetDemo } = useDemoMode();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const adminNavGroup: NavGroup = {
    label: 'Administration',
    items: [
      { name: 'Job Sources', href: '/admin/sources', icon: Server },
      { name: 'System Users', href: '/admin/users', icon: Users },
    ],
  };

  const navGroups = isAdmin ? [...NAV_GROUPS, adminNavGroup] : NAV_GROUPS;

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      {/* Sidebar — fixed; content column accounts for width via left padding. */}
      <aside
        aria-label="Sidebar navigation"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.07] bg-night-900/80 backdrop-blur-xl transition-all duration-200 ease-out ${
          collapsed ? 'w-[76px]' : 'w-[264px]'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand */}
        <div className={`flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 ${collapsed ? 'justify-center px-0' : ''}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#7551ff,#a855f7)] shadow-glow-brand">
            <Rocket className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-tight text-slate-50">CareerPilot</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-brand-300/80">AI Job Search</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5" aria-label="Main navigation">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {group.label}
                </p>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = isActive(location.pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        onClick={onCloseMobile}
                        title={collapsed ? item.name : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                          collapsed ? 'justify-center px-0' : ''
                        } ${
                          active
                            ? 'bg-[linear-gradient(90deg,rgba(117,81,255,0.30)_0%,rgba(117,81,255,0.08)_100%)] text-white shadow-glow-soft'
                            : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
                        }`}
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand-500 shadow-glow-brand"
                            aria-hidden="true"
                          />
                        )}
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        {!collapsed && <span className="truncate">{item.name}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer — demo mode + collapse */}
        <div className="shrink-0 border-t border-white/[0.06] p-3">
          {!collapsed && (
            <div className="mb-2 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-300">Demo Mode</p>
                <p className="text-[10px] text-slate-500">{isDemoMode ? 'Active — simulated data' : 'Off — real data'}</p>
              </div>
              <button
                onClick={() => (isDemoMode ? resetDemo() : bootstrapDemo())}
                disabled={loading}
                role="switch"
                aria-checked={isDemoMode}
                aria-label={isDemoMode ? 'Disable demo mode' : 'Enable demo mode'}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
                  isDemoMode ? 'bg-brand-600' : 'bg-white/[0.12]'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    isDemoMode ? 'translate-x-[18px]' : 'translate-x-1'
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={onToggleCollapsed}
              className="hidden flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100 lg:flex"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                  <span>Collapse</span>
                </>
              )}
            </button>
            {!collapsed && (
              <button
                onClick={onCloseMobile}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100 lg:hidden"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Close
              </button>
            )}
          </div>

          {!collapsed && (
            <p className="mt-2 text-center text-[10px] font-medium text-slate-600">CareerPilot · v0.1.0</p>
          )}
        </div>
      </aside>
    </>
  );
}