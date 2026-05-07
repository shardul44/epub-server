/**
 * Navigation.jsx — Fixed top navigation bar for EPUB Studio.
 *
 * Role-based routing:
 *   platform_admin → /admin/organizations
 *   org_admin      → / (org dashboard)
 *   user / others  → /exports (library)
 *
 * Renders context-aware middle nav buttons and a user badge on the right.
 * Collapses to icon-only on small screens (≤ 640 px).
 */

import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  BookOpen,
  LayoutGrid,
  FileText,
  RefreshCw,
  Film,
  FolderOpen,
  Building2,
  LayoutTemplate,
  Users,
  Activity,
  LogOut,
  ChevronDown,
  Gauge,
  ClipboardCheck,
  ShieldCheck,
  Settings,
  Radio,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { hasFeature } from '../utils/features';
import './Navigation.css';

/* ─── helpers ──────────────────────────────────────────────────────────────── */

/**
 * Returns Tailwind-style inline class string for a nav button.
 * Keeps button style logic in one place.
 */
function navBtnClass(isActive) {
  const base =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 whitespace-nowrap';
  const active =
    'bg-indigo-600 text-white shadow-sm';
  const inactive =
    'text-slate-300 hover:bg-slate-700 hover:text-white';
  return `${base} ${isActive ? active : inactive}`;
}

function iconBtnClass(isActive) {
  const base =
    'flex items-center justify-center w-9 h-9 rounded-md transition-all duration-150';
  const active  = 'bg-indigo-600 text-white shadow-sm';
  const inactive = 'text-slate-300 hover:bg-slate-700 hover:text-white';
  return `${base} ${isActive ? active : inactive}`;
}

/* ─── sub-components ───────────────────────────────────────────────────────── */

/** A single nav button — shows label on md+, icon-only on sm. */
const NavBtn = ({ to, icon: Icon, label, isActive }) => (
  <Link to={to} className={navBtnClass(isActive)} title={label} aria-current={isActive ? 'page' : undefined}>
    <Icon size={16} className="shrink-0" />
    <span className="nav-label">{label}</span>
  </Link>
);

/** Icon-only variant used in collapsed mobile view. */
const NavBtnIcon = ({ to, icon: Icon, label, isActive }) => (
  <Link to={to} className={iconBtnClass(isActive)} title={label} aria-label={label} aria-current={isActive ? 'page' : undefined}>
    <Icon size={18} />
  </Link>
);

/** Role badge pill. */
const RoleBadge = ({ role }) => {
  const colours = {
    platform_admin: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    org_admin:      'bg-amber-500/20 text-amber-300 border-amber-500/30',
    user:           'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  };
  const label = {
    platform_admin: 'Admin',
    org_admin:      'Org Admin',
    user:           'User',
  };
  const cls = colours[role] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {label[role] ?? role}
    </span>
  );
};

/* ─── main component ───────────────────────────────────────────────────────── */

const Navigation = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, setUser } = useAuth();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsed, setCollapsed]       = useState(false);
  const menuRef = useRef(null);

  /* Close user menu on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* Detect small screens */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setCollapsed(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  /* ── role helpers ── */
  const role           = user?.role ?? '';
  const isPlatformAdmin = role === 'platform_admin';
  const isOrgAdmin      = role === 'org_admin';
  const isUser          = !isPlatformAdmin && !isOrgAdmin;

  /* ── feature flags ── */
  const showConversion    = !isPlatformAdmin && hasFeature(user, 'conversion.basic');
  const showEpubTools     = !isPlatformAdmin && hasFeature(user, 'epub_tools');
  const showAccessibility = !isPlatformAdmin && hasFeature(user, 'accessibility_tools');
  const showAi            = !isPlatformAdmin && hasFeature(user, 'ai_config');
  const showTts           = !isPlatformAdmin && hasFeature(user, 'tts_management');
  const showInteractive   = !isPlatformAdmin && hasFeature(user, 'interactive.content');

  /* ── active route helper ── */
  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  /* ── build middle nav items per role ── */
  const NavItem = collapsed ? NavBtnIcon : NavBtn;

  const renderMiddleNav = () => {
    /* Platform admin */
    if (isPlatformAdmin) {
      return (
        <>
          <NavItem to="/admin/organizations" icon={Building2}    label="Organizations" isActive={isActive('/admin/organizations')} />
          <NavItem to="/admin/plans"         icon={LayoutTemplate} label="Plans"        isActive={isActive('/admin/plans')} />
          <NavItem to="/activity"            icon={Activity}     label="Activity"      isActive={isActive('/activity')} />
        </>
      );
    }

    /* Org admin */
    if (isOrgAdmin) {
      return (
        <>
          <NavItem to="/"                  icon={LayoutGrid}    label="Dashboard"     isActive={isActive('/')} />
          {showConversion && (
            <>
              <NavItem to="/pdfs"          icon={FileText}      label="PDFs"          isActive={isActive('/pdfs') && !isActive('/pdfs/upload')} />
              <NavItem to="/conversions"   icon={RefreshCw}     label="Conversions"   isActive={isActive('/conversions')} />
            </>
          )}
          <NavItem to="/exports"           icon={Film}          label="Exports"       isActive={isActive('/exports')} />
          <NavItem to="/org/media-library" icon={FolderOpen}    label="Media"         isActive={isActive('/org/media-library')} />
          <NavItem to="/org/usage"         icon={Gauge}         label="Usage"         isActive={isActive('/org/usage')} />
          <NavItem to="/org/team"          icon={Users}         label="Team"          isActive={isActive('/org/team')} />
        </>
      );
    }

    /* Regular user */
    return (
      <>
        <NavItem to="/"        icon={LayoutGrid} label="Dashboard" isActive={isActive('/')} />
        {showConversion && (
          <>
            <NavItem to="/pdfs"        icon={FileText}  label="PDFs"        isActive={isActive('/pdfs') && !isActive('/pdfs/upload')} />
            <NavItem to="/conversions" icon={RefreshCw} label="Conversions" isActive={isActive('/conversions')} />
          </>
        )}
        <NavItem to="/exports" icon={Film} label="Exports" isActive={isActive('/exports')} />
        {showAccessibility && (
          <NavItem to="/accessibility" icon={ShieldCheck} label="Accessibility" isActive={isActive('/accessibility')} />
        )}
        {showEpubTools && (
          <NavItem to="/epub-checker" icon={ClipboardCheck} label="EPUB Checker" isActive={isActive('/epub-checker')} />
        )}
        {showAi && (
          <NavItem to="/ai-config" icon={Settings} label="AI Config" isActive={isActive('/ai-config')} />
        )}
        {showTts && (
          <NavItem to="/tts-management" icon={Radio} label="TTS" isActive={isActive('/tts-management')} />
        )}
        {showInteractive && (
          <NavItem to="/interactive" icon={BookOpen} label="Interactive" isActive={isActive('/interactive')} />
        )}
      </>
    );
  };

  /* ── home route for logo click ── */
  const homeRoute = isPlatformAdmin
    ? '/admin/organizations'
    : isOrgAdmin
    ? '/'
    : '/exports';

  /* ── display name ── */
  const displayName = user?.name || user?.email?.split('@')[0] || 'User';

  return (
    <header className="nav-root" role="banner">
      <div className="nav-inner">

        {/* ── Left: Logo ── */}
        <Link to={homeRoute} className="nav-brand" aria-label="EPUB Studio home">
          <div className="nav-brand-icon">
            <BookOpen size={20} />
          </div>
          {!collapsed && (
            <div className="nav-brand-text">
              <span className="nav-brand-title">EPUB Studio</span>
              <span className="nav-brand-sub">Management System</span>
            </div>
          )}
        </Link>

        {/* ── Middle: Context nav ── */}
        {user && (
          <nav className="nav-middle" aria-label="Main navigation">
            {renderMiddleNav()}
          </nav>
        )}

        {/* ── Right: User section ── */}
        {user && (
          <div className="nav-right" ref={menuRef}>
            <button
              type="button"
              className="nav-user-btn"
              onClick={() => setUserMenuOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={userMenuOpen}
              aria-label="User menu"
            >
              {/* Avatar circle */}
              <span className="nav-avatar" aria-hidden="true">
                {displayName.charAt(0).toUpperCase()}
              </span>

              {!collapsed && (
                <div className="nav-user-info">
                  <span className="nav-user-name">{displayName}</span>
                  <RoleBadge role={role} />
                </div>
              )}

              <ChevronDown
                size={14}
                className={`nav-chevron ${userMenuOpen ? 'nav-chevron--open' : ''}`}
                aria-hidden="true"
              />
            </button>

            {/* Dropdown */}
            {userMenuOpen && (
              <div className="nav-dropdown" role="menu" aria-label="User options">
                {/* User info header */}
                <div className="nav-dropdown-header">
                  <span className="nav-dropdown-name">{displayName}</span>
                  {user?.email && (
                    <span className="nav-dropdown-email">{user.email}</span>
                  )}
                  <RoleBadge role={role} />
                </div>

                <div className="nav-dropdown-divider" role="separator" />

                <button
                  type="button"
                  className="nav-dropdown-item nav-dropdown-item--danger"
                  onClick={handleLogout}
                  role="menuitem"
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default Navigation;
