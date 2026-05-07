import { useEffect, useState, useCallback } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  FileText,
  CloudUpload,
  RefreshCw,
  Settings,
  LogOut,
  BookOpen,
  Radio,
  ShieldCheck,
  ClipboardCheck,
  ClipboardList,
} from 'lucide-react';
import HealthCheck from '../HealthCheck';
import OrgAdminSidebar from './OrgAdminSidebar';
import AdminSidebar from '../AdminSidebar';
import { useAuth } from '../../context/AuthContext';
import { hasFeature } from '../../utils/features';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import './Layout.css';

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser, refreshUser } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const queryClient = useQueryClient();

  // Sidebar badges — read from the shared React Query cache (no extra fetch)
  const sidebarPdfCount        = 0; // PDFs badge not critical; skip extra fetch
  const sidebarConversionCount = (() => {
    const cached = queryClient.getQueryData(queryKeys.conversions.list());
    return Array.isArray(cached) ? cached.length : 0;
  })();

  useEffect(() => {
    if (!user) void refreshUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isPlatformAdmin = user?.role === 'platform_admin';
  const isOrgAdmin      = user?.role === 'org_admin';

  const hideFullScreenPage =
    location.pathname.startsWith('/sync-studio') ||
    location.pathname.startsWith('/reader/epub') ||
    location.pathname.startsWith('/epub-image-editor') ||
    location.pathname.startsWith('/kitaboo-studio') ||
    location.pathname.startsWith('/fxl-sync-studio');

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/' ? 'active' : '';
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  const handleSidebarCollapse = useCallback((collapsed) => {
    setSidebarCollapsed(collapsed);
  }, []);

  if (hideFullScreenPage) {
    return (
      <div className="layout layout-fullscreen">
        <main className="main-content main-content-fullscreen">
          <Outlet />
        </main>
      </div>
    );
  }

  const showConversion   = !isPlatformAdmin && hasFeature(user, 'conversion.basic');
  const showEpubTools    = !isPlatformAdmin && hasFeature(user, 'epub_tools');
  const showAccessibility = !isPlatformAdmin && hasFeature(user, 'accessibility_tools');
  const showAi           = !isPlatformAdmin && hasFeature(user, 'ai_config');
  const showTts          = !isPlatformAdmin && hasFeature(user, 'tts_management');
  const showInteractive  = !isPlatformAdmin && hasFeature(user, 'interactive.content');

  /* ── Org Admin layout — new premium sidebar, no top navbar ── */
  if (isOrgAdmin) {
    return (
      <div
        className={`layout layout--org-admin${sidebarCollapsed ? ' layout--sb-collapsed' : ''}`}
      >
        <OrgAdminSidebar
          onCollapse={handleSidebarCollapse}
          pdfCount={sidebarPdfCount}
          conversionCount={sidebarConversionCount}
        />
        <main className="main-content main-content--org-admin">
          <Outlet />
        </main>
      </div>
    );
  }

  /* ── Platform Admin layout — AdminSidebar, no top navbar ── */
  if (isPlatformAdmin) {
    return (
      <div
        className={`layout layout--org-admin${sidebarCollapsed ? ' layout--sb-collapsed' : ''}`}
      >
        <AdminSidebar onCollapse={handleSidebarCollapse} />
        <main className="main-content main-content--org-admin">
          <Outlet />
        </main>
      </div>
    );
  }

  /* ── All other roles — original navbar + sidebar layout ── */
  return (
    <div className="layout">
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <BookOpen className="navbar-brand-icon" />
            <div className="navbar-brand-text">
              <span className="navbar-brand-title">PDF to EPUB</span>
              <span className="navbar-brand-subtitle">Converter</span>
            </div>
          </div>

          <div className="navbar-actions">
            <HealthCheck />
            <button onClick={handleLogout} className="navbar-logout-btn">
              <LogOut className="navbar-logout-icon" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </nav>

      <aside className="sidebar">
        <nav className="sidebar-nav">
          <Link to="/" className={`sidebar-link ${isActive('/')}`}>
            <Home className="sidebar-icon" />
            <span>Dashboard</span>
          </Link>

          {showConversion && (
            <>
              <Link to="/pdfs/upload" className={`sidebar-link ${isActive('/pdfs/upload')}`}>
                <CloudUpload className="sidebar-icon" />
                <span>Upload PDF</span>
              </Link>
              <Link to="/epub-sync-import" className={`sidebar-link ${isActive('/epub-sync-import')}`}>
                <BookOpen className="sidebar-icon" />
                <span>EPUB → sync</span>
              </Link>
              <Link to="/pdfs" className={`sidebar-link ${isActive('/pdfs')}`}>
                <FileText className="sidebar-icon" />
                <span>PDFs</span>
              </Link>
              <Link to="/conversions" className={`sidebar-link ${isActive('/conversions')}`}>
                <RefreshCw className="sidebar-icon" />
                <span>Conversions</span>
              </Link>
            </>
          )}

          {showAi && (
            <Link to="/ai-config" className={`sidebar-link ${isActive('/ai-config')}`}>
              <Settings className="sidebar-icon" />
              <span>AI Config</span>
            </Link>
          )}
          {showTts && (
            <Link to="/tts-management" className={`sidebar-link ${isActive('/tts-management')}`}>
              <Radio className="sidebar-icon" />
              <span>TTS Management</span>
            </Link>
          )}
          {showAccessibility && (
            <Link to="/accessibility" className={`sidebar-link ${isActive('/accessibility')}`}>
              <ShieldCheck className="sidebar-icon" />
              <span>Accessibility</span>
            </Link>
          )}
          {showEpubTools && (
            <Link to="/epub-checker" className={`sidebar-link ${isActive('/epub-checker')}`}>
              <ClipboardCheck className="sidebar-icon" />
              <span>EPUB Checker</span>
            </Link>
          )}
          {showInteractive && (
            <Link to="/interactive" className={`sidebar-link ${isActive('/interactive')}`}>
              <BookOpen className="sidebar-icon" />
              <span>Interactive</span>
            </Link>
          )}

          <Link to="/activity" className={`sidebar-link ${isActive('/activity')}`}>
            <ClipboardList className="sidebar-icon" />
            <span>Activity</span>
          </Link>
        </nav>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
