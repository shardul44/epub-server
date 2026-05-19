/**
 * OrgAdminSidebar.jsx
 *
 * Org administrator sidebar — uses the SAME visual design system as the
 * Platform AdminSidebar (`.sidebar`, `.sidebar-link`, `.admin-sidebar-*`).
 *
 * The only differences vs. Platform Admin are:
 *   - menu items (Workflow / Library / Tools / Org)
 *   - data sources (org-scoped React Query / props)
 *   - an expandable "Conversions" group with sub-items
 *
 * Layout / spacing / typography / colors / shadows / sidebar width all
 * come from the shared admin styles in `Layout.css` + `AdminSidebar.css`.
 */
import { useState, useEffect, useMemo } from 'react';
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
  Menu,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAppDispatch } from '../../store/hooks';
import { logout as logoutAction } from '../../features/auth/authSlice';
import { hasFeature } from '../../utils/features';

import './Layout.css';
import '../AdminSidebar.css';
import './OrgAdminSidebar.css';

/* ─── small building blocks ───────────────────────────────────────────────── */

function NavRow({ to, icon: Icon, label, end, isActive, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`sidebar-link${isActive ? ' active' : ''}`}
    >
      <Icon className="sidebar-icon" aria-hidden />
      <span className="admin-sidebar-label">{label}</span>
      {end}
    </Link>
  );
}

function CountBadge({ count, tone = 'mint' }) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  const text = n > 99 ? '99+' : String(n);
  return (
    <span className={`admin-sidebar-badge admin-sidebar-badge--${tone}`}>
      {text}
    </span>
  );
}

/**
 * Expandable nav row (button with chevron + sub-items).
 *
 * Keeps the historical `sb-item--expandable` class for backward-compat
 * targeting while using AdminSidebar's `sidebar-link` visual styles.
 */
function ExpandableNav({
  icon: Icon,
  label,
  isActive,
  navigateTo,
  end,
  children,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
    else if (navigateTo) setOpen(false);
  }, [isActive, navigateTo]);

  const handleClick = () => {
    if (navigateTo) {
      const onDefaultChild =
        location.pathname === navigateTo ||
        location.pathname === `${navigateTo}/`;
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
    <div className="admin-sidebar-expandable sb-expandable">
      <button
        type="button"
        className={
          `sidebar-link sidebar-link--expandable sb-item--expandable` +
          (isActive ? ' active' : '') +
          (open ? ' is-open' : '')
        }
        onClick={handleClick}
        aria-expanded={open}
      >
        <Icon className="sidebar-icon" aria-hidden />
        <span className="admin-sidebar-label">{label}</span>
        {end}
        
      </button>
      {open && <div className="admin-sidebar-sub-items">{children}</div>}
    </div>
  );
}

function SubNav({ to, label, isActive }) {
  return (
    <Link
      to={to}
      className={`admin-sidebar-sub-item${isActive ? ' active' : ''}`}
    >
      <span className="admin-sidebar-sub-dot" aria-hidden />
      <span className="admin-sidebar-sub-label">{label}</span>
    </Link>
  );
}

/* ─── main sidebar ────────────────────────────────────────────────────────── */

const OrgAdminSidebar = ({ onCollapse, pdfCount = 0, conversionCount = 0 }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isOrgAdmin = user?.role === 'org_admin';

  // Plan feature flags — org admins always see full workflow + tools in this shell
  const showConversion    = isOrgAdmin || hasFeature(user, 'conversion.basic');
  const showAccessibility = isOrgAdmin || hasFeature(user, 'accessibility_tools');
  const showEpubTools     = isOrgAdmin || hasFeature(user, 'epub_tools');
  const showInteractive   = isOrgAdmin || hasFeature(user, 'interactive.content');

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Mirror AdminSidebar: this layout always uses the full-width rail (the
  // 1024px media query collapses it automatically). Notify parent once.
  useEffect(() => {
    onCollapse?.(false);
  }, [onCollapse]);

  const handleLogout = () => {
    dispatch(logoutAction());
    navigate('/login', { replace: true });
  };

  const path = location.pathname;

  const active = useMemo(
    () => ({
      home:           path === '/' || path === '',
      pdfsUpload:     path.startsWith('/pdfs/upload'),
      epubSync:       path.startsWith('/epub-sync-import'),
      pdfs:           path.startsWith('/pdfs') && !path.startsWith('/pdfs/upload'),
      conversions:
        path.startsWith('/conversions') ||
        path.startsWith('/audio-sync/') ||
        path.startsWith('/sync-studio') ||
        path.startsWith('/fxl-sync-studio') ||
        path.startsWith('/kitaboo-studio') ||
        path.startsWith('/fxl-studio') ||
        path.startsWith('/image-editor') ||
        path.startsWith('/epub-image-editor'),
      convJobs:       path === '/conversions' || path === '/conversions/',
      convFxl:        path.startsWith('/conversions/fxl-editor'),
      convAudio:
        path.startsWith('/conversions/audio-sync') ||
        path.startsWith('/audio-sync/fxl') ||
        path.startsWith('/audio-sync/reflow') ||
        path.startsWith('/sync-studio') ||
        path.startsWith('/fxl-sync-studio'),
      convDownload:   path.startsWith('/conversions/download'),
      exports:        path.startsWith('/exports'),
      mediaLibrary:   path.startsWith('/media-library'),
      usage:          path.startsWith('/usage'),
      accessibility:  path.startsWith('/accessibility'),
      epubChecker:    path.startsWith('/epub-checker'),
      interactive:    path.startsWith('/interactive'),
      activity:       path.startsWith('/activity'),
      orgTeam:        path.startsWith('/org/team'),
    }),
    [path],
  );

  return (
    <>
      {/* Mobile hamburger — uses shared AdminSidebar mobile styles */}
      <button
        className="admin-mobile-toggle"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        type="button"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {mobileOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
        {/* ── Brand block ── */}
        <div className="admin-sidebar-brand">
          <div className="admin-sidebar-brand-mark" aria-hidden>
            <FileText size={22} strokeWidth={2} />
          </div>
          <div className="navbar-brand-text">
            <span className="navbar-brand-title">PDF to EPUB</span>
            <span className="navbar-brand-subtitle admin-sidebar-brand-tag">
              Studio
            </span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {/* WORKFLOW */}
          <span className="admin-sidebar-section-label">Workflow</span>

          <NavRow
            to="/"
            icon={LayoutGrid}
            label="Dashboard"
            isActive={active.home}
          />

          {showConversion && (
            <>
              <NavRow
                to="/pdfs/upload"
                icon={Upload}
                label="Upload PDF"
                isActive={active.pdfsUpload}
              />
              <NavRow
                to="/epub-sync-import"
                icon={RefreshCw}
                label="EPUB Sync"
                isActive={active.epubSync}
              />
              <NavRow
                to="/pdfs"
                icon={FileText}
                label="My PDFs"
                isActive={active.pdfs}
                end={<CountBadge count={pdfCount} tone="blue" />}
              />

              <ExpandableNav
                icon={ArrowLeftRight}
                label="Conversions"
                isActive={active.conversions}
                navigateTo="/conversions"
                end={<CountBadge count={conversionCount} tone="mint" />}
              >
                <SubNav
                  to="/conversions"
                  label="Conversion Jobs"
                  isActive={active.convJobs}
                />
                <SubNav
                  to="/conversions/fxl-editor"
                  label="FXL Editor"
                  isActive={active.convFxl}
                />
                <SubNav
                  to="/conversions/audio-sync"
                  label="Audio Sync Studio"
                  isActive={active.convAudio}
                />
                <SubNav
                  to="/conversions/download"
                  label="Download EPUB"
                  isActive={active.convDownload}
                />
              </ExpandableNav>
            </>
          )}

          {/* LIBRARY */}
          <span className="admin-sidebar-section-label">Library</span>

          <NavRow
            to="/exports"
            icon={Film}
            label="Exports"
            isActive={active.exports}
          />
          <NavRow
            to="/media-library"
            icon={FolderOpen}
            label="Media Library"
            isActive={active.mediaLibrary}
          />
          <NavRow
            to="/usage"
            icon={Gauge}
            label="Usage"
            isActive={active.usage}
          />

          {/* TOOLS */}
          {(showAccessibility || showEpubTools || showInteractive) && (
            <span className="admin-sidebar-section-label">Tools</span>
          )}

          {showAccessibility && (
            <NavRow
              to="/accessibility"
              icon={Accessibility}
              label="Accessibility"
              isActive={active.accessibility}
            />
          )}
          {showEpubTools && (
            <NavRow
              to="/epub-checker"
              icon={ClipboardCheck}
              label="EPUB Checker"
              isActive={active.epubChecker}
            />
          )}
          {showInteractive && (
            <NavRow
              to="/interactive"
              icon={BookOpen}
              label="Interactive"
              isActive={active.interactive}
            />
          )}

          {/* ORG — org_admin only */}
          {isOrgAdmin && (
            <>
              <span className="admin-sidebar-section-label">Org</span>
              <NavRow
                to="/activity"
                icon={Activity}
                label="Activity"
                isActive={active.activity}
              />
              <NavRow
                to="/org/team"
                icon={Users}
                label="Team Users"
                isActive={active.orgTeam}
              />
            </>
          )}
        </nav>

        {/* ── Footer (user info + logout) ── */}
        <div className="admin-sidebar-footer">
          {user && (
            <div className="admin-sidebar-user">
              <div className="admin-sidebar-avatar" aria-hidden>
                {(user.name || user.email || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="admin-sidebar-user-info">
                <span className="admin-sidebar-user-name">
                  {user.name || user.email?.split('@')[0] || 'Org Admin'}
                </span>
                {user.email && (
                  <span className="admin-sidebar-user-email">{user.email}</span>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            className="navbar-logout-btn admin-sidebar-logout"
            onClick={handleLogout}
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default OrgAdminSidebar;
