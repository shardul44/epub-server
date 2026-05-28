import { useEffect, useMemo, useState } from 'react';
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
  SlidersVertical,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import useLogout from '../../hooks/useLogout';
import { hasAnyFeature, hasFeature, WORKFLOW_LIBRARY_FEATURES } from '../../utils/features';
import { useSidebarBadges } from '../../hooks/useSidebarBadges';
import { useAppBootstrap } from '../../hooks/queries/useAppBootstrap';

import './Layout.css';
import './UserAppSidebar.css';

function NavRow({ to, icon: Icon, label, end, isActive, onClick }) {
  return (
    <Link to={to} onClick={onClick} className={`sidebar-link${isActive ? ' active' : ''}`}>
      <Icon className="sidebar-icon" aria-hidden />
      <span className="user-sidebar-label">{label}</span>
      {end}
    </Link>
  );
}

function CountBadge({ count, tone = 'mint' }) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  const text = n > 99 ? '99+' : String(n);
  return (
    <span className={`user-sidebar-badge user-sidebar-badge--${tone}`}>
      {text}
    </span>
  );
}

function ExpandableNav({ icon: Icon, label, isActive, navigateTo, end, children }) {
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
    <div className="user-sidebar-expandable sb-expandable">
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
        <span className="user-sidebar-label">{label}</span>
        {end}
      </button>
      {open && <div className="user-sidebar-sub-items">{children}</div>}
    </div>
  );
}

function SubNav({ to, label, isActive }) {
  return (
    <Link to={to} className={`user-sidebar-sub-item${isActive ? ' active' : ''}`}>
      <span className="user-sidebar-sub-dot" aria-hidden />
      <span className="user-sidebar-sub-label">{label}</span>
    </Link>
  );
}

/**
 * Sidebar for non-admin users — Workflow / Library / Tools / Account.
 * Uses `user-sidebar-*` BEM-style classes (not admin-sidebar-*).
 */
function formatUserRole(role) {
  if (!role) return '';
  const map = {
    org_admin: 'Org admin',
    platform_admin: 'Platform admin',
    user: 'Member',
    member: 'Member',
  };
  return map[role] || role.replace(/_/g, ' ');
}

export default function UserAppSidebar({ onCollapse }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const onLogout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pdfCount, conversionCount } = useSidebarBadges();
  const { activities } = useAppBootstrap();

  const activityCount = Array.isArray(activities) ? activities.length : 0;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    onCollapse?.(false);
  }, [onCollapse]);

  const path = location.pathname;

  const active = useMemo(
    () => ({
      home: path === '/' || path === '',
      pdfsUpload: path.startsWith('/pdfs/upload'),
      epubSync: path.startsWith('/epub-sync-import'),
      pdfs: path.startsWith('/pdfs') && !path.startsWith('/pdfs/upload'),
      conversions:
        path.startsWith('/conversions') ||
        path.startsWith('/audio-sync/') ||
        path.startsWith('/sync-studio') ||
        path.startsWith('/fxl-sync-studio') ||
        path.startsWith('/kitaboo-studio') ||
        path.startsWith('/fxl-studio') ||
        path.startsWith('/image-editor') ||
        path.startsWith('/epub-image-editor'),
      convJobs: path === '/conversions' || path === '/conversions/',
      convFxl: path.startsWith('/conversions/fxl-editor'),
      convAudio:
        path.startsWith('/conversions/audio-sync') ||
        path.startsWith('/audio-sync/fxl') ||
        path.startsWith('/audio-sync/reflow') ||
        path.startsWith('/sync-studio') ||
        path.startsWith('/fxl-sync-studio'),
      convDownload: path.startsWith('/conversions/download'),
      exports: path.startsWith('/exports'),
      mediaLibrary: path.startsWith('/media-library'),
      usage: path.startsWith('/usage'),
      accessibility: path.startsWith('/accessibility'),
      epubChecker: path.startsWith('/epub-checker'),
      interactive: path.startsWith('/interactive'),
      activity: path.startsWith('/activity'),
    }),
    [path],
  );

  const showConversion = hasFeature(user, 'conversion.basic');
  const showKitaboo = hasFeature(user, 'kitaboo.import');
  const planFeatures = user?.features || [];
  const showEpubSyncImport =
    planFeatures.includes('reflowable_epub.audio_sync') ||
    planFeatures.includes('hifi_fxl_epub.audio_sync');
  const showSyncStudio = hasFeature(user, 'sync_studio');
  const showDownload = showConversion || showKitaboo || showEpubSyncImport || showSyncStudio;
  const showLibrary = hasAnyFeature(user, WORKFLOW_LIBRARY_FEATURES);
  const showExports = showConversion || showEpubSyncImport;
  const showAccessibility = hasFeature(user, 'accessibility_tools');
  const showEpubTools = hasFeature(user, 'epub_tools');
  const showInteractive = hasFeature(user, 'interactive.content');

  const showWorkflowNav = showConversion || showKitaboo || showSyncStudio || showEpubSyncImport;

  const showToolsSection =
    showAccessibility || showEpubTools || showInteractive;

  return (
    <>
      <button
        className="user-sidebar-mobile-toggle"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        type="button"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {mobileOpen && (
        <div
          className="user-sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidebar user-app-sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`}
      >
        <div className="user-sidebar-brand">
          <div className="user-sidebar-brand-mark" aria-hidden>
            <BookOpen size={22} strokeWidth={2} />
          </div>
          <div className="user-sidebar-brand-text">
            <span className="user-sidebar-brand-title">PDF to EPUB</span>
            <span className="user-sidebar-brand-subtitle user-sidebar-brand-tag">
              Conversion Studio
            </span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="user-sidebar-section-label">Workflow</span>

          <NavRow to="/" icon={LayoutGrid} label="Dashboard" isActive={active.home} />

          {(showConversion || showKitaboo) && (
            <NavRow
              to="/pdfs/upload"
              icon={Upload}
              label="Upload PDF"
              isActive={active.pdfsUpload}
            />
          )}
          {showEpubSyncImport && (
            <NavRow
              to="/epub-sync-import"
              icon={RefreshCw}
              label="EPUB Sync"
              isActive={active.epubSync}
            />
          )}
          {showWorkflowNav && (
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
            >
              {showConversion && (
                <SubNav to="/conversions" label="Conversion Jobs" isActive={active.convJobs} />
              )}
              {showKitaboo && (
                <SubNav to="/conversions/fxl-editor" label="FXL Editor" isActive={active.convFxl} />
              )}
              {showSyncStudio && (
                <SubNav
                  to="/conversions/audio-sync"
                  label="Audio Sync Studio"
                  isActive={active.convAudio}
                />
              )}
              {showDownload && (
                <SubNav
                  to="/conversions/download"
                  label="Download EPUB"
                  isActive={active.convDownload}
                />
              )}
            </ExpandableNav>
          )}

          {showLibrary && <span className="user-sidebar-section-label">Library</span>}

          {showExports && (
            <NavRow to="/exports" icon={Film} label="Exports" isActive={active.exports} />
          )}
          {showLibrary && (
            <NavRow
              to="/media-library"
              icon={FolderOpen}
              label="Media Library"
              isActive={active.mediaLibrary}
            />
          )}
          <NavRow to="/usage" icon={Gauge} label="Usage" isActive={active.usage} />

          {showToolsSection && (
            <span className="user-sidebar-section-label">Tools</span>
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
              icon={SlidersVertical}
              label="Interactive"
              isActive={active.interactive}
            />
          )}

          <span className="user-sidebar-section-label">Account</span>

          <NavRow
            to="/activity"
            icon={Activity}
            label="Activity"
            isActive={active.activity}
            end={<CountBadge count={activityCount} tone="rose" />}
          />
        </nav>

        <div className="user-sidebar-footer">
          {user && (
            <div className="user-sidebar-user">
              <div className="user-sidebar-avatar" aria-hidden>
                {(user.name || user.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="user-sidebar-user-info">
                <span className="user-sidebar-user-name">
                  {user.name || user.email?.split('@')[0] || 'User'}
                </span>
                {user.email && (
                  <span className="user-sidebar-user-email">{user.email}</span>
                )}
                {user.role && (
                  <span className="user-sidebar-user-status">{formatUserRole(user.role)}</span>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            className="navbar-logout-btn user-sidebar-logout"
            onClick={onLogout}
          >
            <LogOut size={16} strokeWidth={2} aria-hidden />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
