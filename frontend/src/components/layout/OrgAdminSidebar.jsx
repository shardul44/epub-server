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
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import useLogout from '../../hooks/useLogout';
import { hasAnyFeature, hasFeature } from '../../utils/features';

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
  onNavigate,
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
        onNavigate?.();
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

function SubNav({ to, label, isActive, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
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
  const { user } = useAuth();
  const onLogout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isOrgAdmin = user?.role === 'org_admin';

  // Plan feature flags — org admins inherit the same org plan as members.
  const showConversion    = hasFeature(user, 'conversion.basic');
  const showKitaboo = hasFeature(user, 'kitaboo.import');
  const planFeatures = user?.features || [];
  const showEpubSyncImport =
    planFeatures.includes('reflowable_epub.audio_sync') ||
    planFeatures.includes('hifi_fxl_epub.audio_sync');
  const showSyncStudio = hasFeature(user, 'sync_studio');
  const showWorkflowNav = showConversion || showKitaboo || showEpubSyncImport || showSyncStudio;
  const showDownload = showConversion || showKitaboo || showEpubSyncImport || showSyncStudio;
  const showExports = showConversion || showEpubSyncImport;
  const showAccessibility = hasFeature(user, 'accessibility_tools');
  const showEpubTools     = hasFeature(user, 'epub_tools');
  const showInteractive   = hasFeature(user, 'interactive.content');

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Mirror AdminSidebar: this layout always uses the full-width rail (the
  // 1024px media query collapses it automatically). Notify parent once.
  useEffect(() => {
    onCollapse?.(false);
  }, [onCollapse]);

  const closeMobile = () => setMobileOpen(false);

  const path = location.pathname;

  const active = useMemo(
    () => ({
      home:           path === '/' || path === '',
      pdfsUpload:     path.startsWith('/pdfs/upload'),
      epubSync:       path.startsWith('/epub-sync-import'),
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
      {mobileOpen ? (
        <button
          className="admin-mobile-toggle"
          onClick={closeMobile}
          aria-label="Close menu"
          type="button"
        >
          <X size={20} />
        </button>
      ) : (
        <button
          className="admin-mobile-toggle"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          type="button"
        >
          <Menu size={20} />
        </button>
      )}

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
            <img src="/Tunr_Logo-01.svg" alt="" className="admin-sidebar-brand-logo" />
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
            onClick={closeMobile}
          />
          {showEpubSyncImport && (
            <NavRow
              to="/epub-sync-import"
              icon={RefreshCw}
              label="EPUB Sync"
              isActive={active.epubSync}
              onClick={closeMobile}
            />
          )}

          {showWorkflowNav && (
            <>
              {(showConversion || showKitaboo) && (
                <NavRow
                  to="/pdfs/upload"
                  icon={Upload}
                  label="Upload PDF"
                  isActive={active.pdfsUpload}
                  onClick={closeMobile}
                />
              )}
              <ExpandableNav
                icon={ArrowLeftRight}
                label="Conversions"
                isActive={active.conversions}
                navigateTo={
                  showConversion
                    ? '/conversions'
                    : showKitaboo
                      ? '/conversions/fxl-editor'
                      : '/conversions/audio-sync'
                }
                end={<CountBadge count={conversionCount} tone="mint" />}
                onNavigate={closeMobile}
              >
                {showConversion && (
                  <SubNav
                    to="/conversions"
                    label="Conversion Jobs"
                    isActive={active.convJobs}
                    onClick={closeMobile}
                  />
                )}
                {showKitaboo && (
                  <SubNav
                    to="/conversions/fxl-editor"
                    label="FXL Editor"
                    isActive={active.convFxl}
                    onClick={closeMobile}
                  />
                )}
                {showSyncStudio && (
                  <SubNav
                    to="/conversions/audio-sync"
                    label="Audio Sync Studio"
                    isActive={active.convAudio}
                    onClick={closeMobile}
                  />
                )}
                {showDownload && (
                  <SubNav
                    to="/conversions/download"
                    label="Download EPUB"
                    isActive={active.convDownload}
                    onClick={closeMobile}
                  />
                )}
              </ExpandableNav>
            </>
          )}

          {/* LIBRARY */}
          <span className="admin-sidebar-section-label">Library</span>

          {showExports && (
            <NavRow
              to="/exports"
              icon={Film}
              label="Exports"
              isActive={active.exports}
              onClick={closeMobile}
            />
          )}
          <NavRow
            to="/media-library"
            icon={FolderOpen}
            label="Media Library"
            isActive={active.mediaLibrary}
            onClick={closeMobile}
          />
          <NavRow
            to="/usage"
            icon={Gauge}
            label="Usage"
            isActive={active.usage}
            onClick={closeMobile}
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
              onClick={closeMobile}
            />
          )}
          {showEpubTools && (
            <NavRow
              to="/epub-checker"
              icon={ClipboardCheck}
              label="EPUB Checker"
              isActive={active.epubChecker}
              onClick={closeMobile}
            />
          )}
          {showInteractive && (
            <NavRow
              to="/interactive"
              icon={BookOpen}
              label="Interactive"
              isActive={active.interactive}
              onClick={closeMobile}
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
                onClick={closeMobile}
              />
              <NavRow
                to="/org/team"
                icon={Users}
                label="Team Users"
                isActive={active.orgTeam}
                onClick={closeMobile}
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
            onClick={onLogout}
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
