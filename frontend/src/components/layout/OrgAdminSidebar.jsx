import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  Upload,
  RefreshCw,
  FileText,
  ArrowLeftRight,
  Film,
  FolderOpen,
  Gauge,
  Accessibility,
  ClipboardCheck,
  BookOpen,
  Activity,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { hasFeature } from '../../utils/features';
import { useAppBootstrap } from '../../hooks/queries/useAppBootstrap';
import './OrgAdminSidebar.css';

/* ─── sub-components ──────────────────────────────────────────────────────── */

const Badge = ({ count }) => {
  if (count == null || Number.isNaN(Number(count))) return null;
  return <span className="sb-badge">{Number(count)}</span>;
};

const SidebarItem = ({ to, icon, label, badge, collapsed, isActive, onClick }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const timerRef = useRef(null);

  const handleMouseEnter = () => {
    if (collapsed) {
      timerRef.current = setTimeout(() => setShowTooltip(true), 300);
    }
  };
  const handleMouseLeave = () => {
    clearTimeout(timerRef.current);
    setShowTooltip(false);
  };

  return (
    <Link
      to={to}
      className={`sb-item${isActive ? ' sb-item--active' : ''}`}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label={label}
      tabIndex={0}
    >
      <span className="sb-item-icon">{icon}</span>
      {!collapsed && <span className="sb-item-label">{label}</span>}
      {!collapsed && badge !== undefined && <Badge count={badge} />}
      {collapsed && showTooltip && (
        <span className="sb-tooltip" role="tooltip">{label}</span>
      )}
    </Link>
  );
};

const ExpandableItem = ({ icon, label, badge, collapsed, isActive, children, navigateTo }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(isActive);

  // Open while any child route is active; collapse when leaving that section (navigateTo groups only)
  useEffect(() => {
    if (isActive) setOpen(true);
    else if (navigateTo) setOpen(false);
  }, [isActive, navigateTo]);

  const handleParentClick = () => {
    if (navigateTo) {
      const onDefaultChild =
        location.pathname === navigateTo || location.pathname === `${navigateTo}/`;
      if (onDefaultChild) {
        setOpen((o) => !o);
      } else {
        navigate(navigateTo);
        setOpen(true);
      }
    } else {
      setOpen((o) => !o);
    }
  };

  return (
    <div className="sb-expandable">
      <button
        type="button"
        className={`sb-item sb-item--expandable${isActive ? ' sb-item--active' : ''}`}
        onClick={handleParentClick}
        aria-expanded={open}
      >
        <span className="sb-item-icon">{icon}</span>
        {!collapsed && <span className="sb-item-label">{label}</span>}
        {!collapsed && badge !== undefined && <Badge count={badge} />}
      </button>
      {open && !collapsed && (
        <div className="sb-sub-items">
          {children}
        </div>
      )}
    </div>
  );
};

const SubItem = ({ to, icon, label, isActive, onClick }) => (
  <Link
    to={to}
    className={`sb-sub-item${isActive ? ' sb-sub-item--active' : ''}`}
    onClick={onClick}
    aria-label={label}
  >
    <span className="sb-sub-dot" />
    <span className="sb-sub-label">{label}</span>
  </Link>
);

const SidebarSection = ({ label, children, collapsed }) => (
  <div className="sb-section">
    {!collapsed && <span className="sb-section-label">{label}</span>}
    {collapsed && <span className="sb-section-divider" aria-hidden="true" />}
    <div className="sb-section-items">{children}</div>
  </div>
);

const UserFooter = ({ user, onLogout, collapsed, backendStatus }) => (
  <div className="sb-footer">
    <div className="sb-footer-health">
      <span
        className={`sb-health-dot sb-health-dot--${backendStatus}`}
        title={`Backend ${backendStatus}`}
      />
      {!collapsed && (
        <span className={`sb-health-label sb-health-label--${backendStatus}`}>
          Backend {backendStatus}
        </span>
      )}
    </div>
    <button
      className={`sb-signout${collapsed ? ' sb-signout--icon' : ''}`}
      onClick={onLogout}
      aria-label="Sign out"
    >
      <LogOut className="sb-signout-icon" />
      {!collapsed && <span>Sign out</span>}
    </button>
  </div>
);

/* ─── main Sidebar ────────────────────────────────────────────────────────── */

const OrgAdminSidebar = ({ onCollapse, pdfCount = 0, conversionCount = 0 }) => {
  const location = useLocation();
  const { user, setUser } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Health status from shared bootstrap cache — no polling loop
  const { health } = useAppBootstrap();
  const backendStatus = health?.status === 'OK' ? 'healthy' : health ? 'unhealthy' : 'checking';

  const isOrgAdmin = user?.role === 'org_admin';

  // Feature flags
  const showConversion   = hasFeature(user, 'conversion.basic');
  const showAccessibility = hasFeature(user, 'accessibility_tools');
  const showEpubTools    = hasFeature(user, 'epub_tools');
  const showInteractive  = hasFeature(user, 'interactive.content');

  useEffect(() => {
    // Entrance animation
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Notify parent of collapse state so main content can adjust margin
    onCollapse?.(collapsed);
  }, [collapsed, onCollapse]);

  useEffect(() => {
    // Close mobile drawer on route change
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    window.location.href = '/login';
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const toggleCollapse = () => setCollapsed((c) => !c);
  const toggleMobile   = () => setMobileOpen((o) => !o);

  const sidebarClass = [
    'sb-root',
    collapsed   ? 'sb-root--collapsed' : '',
    mobileOpen  ? 'sb-root--mobile-open' : '',
    mounted     ? 'sb-root--mounted' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="sb-mobile-toggle"
        onClick={toggleMobile}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
      >
        {mobileOpen ? <X /> : <Menu />}
      </button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div className="sb-overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      <aside className={sidebarClass} aria-label="Main navigation">

        {/* ── Branding ── */}
        <div className="sb-brand">
          <div className="sb-brand-logo">
            <FileText />
          </div>
          {!collapsed && (
            <div className="sb-brand-text">
              <span className="sb-brand-title">PDF to EPUB</span>
              <span className="sb-brand-sub">Conversion Studio</span>
            </div>
          )}
          <button
            className="sb-collapse-btn"
            onClick={toggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </button>
        </div>

        {/* ── Nav ── */}
        <nav className="sb-nav" role="navigation">

          {/* WORKFLOW */}
          <SidebarSection label="Workflow" collapsed={collapsed}>
            <SidebarItem
              to="/"
              icon={<LayoutGrid />}
              label="Dashboard"
              collapsed={collapsed}
              isActive={isActive('/')}
            />
            {showConversion && (
              <>
                <SidebarItem
                  to="/pdfs/upload"
                  icon={<Upload />}
                  label="Upload PDF"
                  collapsed={collapsed}
                  isActive={isActive('/pdfs/upload')}
                />
                <SidebarItem
                  to="/epub-sync-import"
                  icon={<RefreshCw />}
                  label="EPUB Sync"
                  collapsed={collapsed}
                  isActive={isActive('/epub-sync-import')}
                />
                <SidebarItem
                  to="/pdfs"
                  icon={<FileText />}
                  label="My PDFs"
                  badge={pdfCount}
                  collapsed={collapsed}
                  isActive={isActive('/pdfs') && !isActive('/pdfs/upload')}
                />
                <ExpandableItem
                  icon={<ArrowLeftRight />}
                  label="Conversions"
                  badge={conversionCount}
                  collapsed={collapsed}
                  isActive={isActive('/conversions')}
                  navigateTo="/conversions"
                >
                  <SubItem
                    to="/conversions"
                    label="Conversion Jobs"
                    isActive={
                      location.pathname === '/conversions' ||
                      location.pathname === '/conversions/'
                    }
                  />
                  <SubItem
                    to="/conversions/fxl-editor"
                    label="FXL Editor"
                    isActive={isActive('/conversions/fxl-editor')}
                  />
                  <SubItem
                    to="/conversions/audio-sync"
                    label="Audio Sync Studio"
                    isActive={isActive('/conversions/audio-sync')}
                  />
                  <SubItem
                    to="/conversions/download"
                    label="Download EPUB"
                    isActive={isActive('/conversions/download')}
                  />
                </ExpandableItem>
              </>
            )}
          </SidebarSection>

          {/* LIBRARY */}
          <SidebarSection label="Library" collapsed={collapsed}>
            <SidebarItem
              to="/exports"
              icon={<Film />}
              label="Exports"
              collapsed={collapsed}
              isActive={isActive('/exports')}
            />
            <SidebarItem
              to="/org/media-library"
              icon={<FolderOpen />}
              label="Media Library"
              collapsed={collapsed}
              isActive={isActive('/org/media-library')}
            />
            <SidebarItem
              to="/org/usage"
              icon={<Gauge />}
              label="Usage"
              collapsed={collapsed}
              isActive={isActive('/org/usage')}
            />
          </SidebarSection>

          {/* TOOLS */}
          <SidebarSection label="Tools" collapsed={collapsed}>
            {showAccessibility && (
              <SidebarItem
                to="/accessibility"
                icon={<Accessibility />}
                label="Accessibility"
                collapsed={collapsed}
                isActive={isActive('/accessibility')}
              />
            )}
            {showEpubTools && (
              <SidebarItem
                to="/epub-checker"
                icon={<ClipboardCheck />}
                label="EPUB Checker"
                collapsed={collapsed}
                isActive={isActive('/epub-checker')}
              />
            )}
            {showInteractive && (
              <SidebarItem
                to="/interactive"
                icon={<BookOpen />}
                label="Interactive"
                collapsed={collapsed}
                isActive={isActive('/interactive')}
              />
            )}
          </SidebarSection>

          {/* ORG — org_admin only */}
          {isOrgAdmin && (
            <SidebarSection label="Org" collapsed={collapsed}>
              <SidebarItem
                to="/activity"
                icon={<Activity />}
                label="Activity"
                collapsed={collapsed}
                isActive={isActive('/activity')}
              />
              <SidebarItem
                to="/org/team"
                icon={<Users />}
                label="Team Users"
                collapsed={collapsed}
                isActive={isActive('/org/team')}
              />
            </SidebarSection>
          )}

        </nav>

        {/* ── Footer ── */}
        <UserFooter
          user={user}
          onLogout={handleLogout}
          collapsed={collapsed}
          backendStatus={backendStatus}
        />

      </aside>
    </>
  );
};

export default OrgAdminSidebar;
