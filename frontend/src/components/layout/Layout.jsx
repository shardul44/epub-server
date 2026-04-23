import React, { useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  HiOutlineHome,
  HiOutlineDocument,
  HiOutlineCloudUpload,
  HiOutlineRefresh,
  HiOutlineCog,
  HiOutlineLogout,
  HiOutlineBookOpen,
  HiOutlineSpeakerphone,
  HiOutlineShieldCheck,
  HiOutlineClipboardCheck,
  HiOutlineOfficeBuilding,
  HiOutlineUsers,
  HiOutlineTemplate,
  HiOutlineClipboardList,
} from 'react-icons/hi';
import HealthCheck from '../HealthCheck';
import { useAuth } from '../../context/AuthContext';
import { hasFeature } from '../../utils/features';
import './Layout.css';

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser, refreshUser } = useAuth();

  // Keep feature visibility in sync (plans can change server-side).
  useEffect(() => {
    void refreshUser();
  }, [location.pathname, refreshUser]);

  const isPlatformAdmin = user?.role === 'platform_admin';
  const isOrgAdmin = user?.role === 'org_admin';

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
    if (path === '/') {
      return location.pathname === '/' ? 'active' : '';
    }
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  if (hideFullScreenPage) {
    return (
      <div className="layout layout-fullscreen">
        <main className="main-content main-content-fullscreen">
          <Outlet />
        </main>
      </div>
    );
  }

  const showConversion = !isPlatformAdmin && hasFeature(user, 'conversion.basic');
  const showEpubTools = !isPlatformAdmin && hasFeature(user, 'epub_tools');
  const showAccessibility = !isPlatformAdmin && hasFeature(user, 'accessibility_tools');
  const showAi = !isPlatformAdmin && hasFeature(user, 'ai_config');
  const showTts = !isPlatformAdmin && hasFeature(user, 'tts_management');
  const showInteractive = !isPlatformAdmin && hasFeature(user, 'interactive.content');

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-brand">
            <HiOutlineBookOpen className="navbar-brand-icon" />
            <div className="navbar-brand-text">
              <span className="navbar-brand-title">PDF to EPUB</span>
              <span className="navbar-brand-subtitle">Converter</span>
            </div>
          </div>

          <div className="navbar-actions">
            <HealthCheck />
            <button onClick={handleLogout} className="navbar-logout-btn">
              <HiOutlineLogout className="navbar-logout-icon" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </nav>

      <aside className="sidebar">
        <nav className="sidebar-nav">
          <Link to="/" className={`sidebar-link ${isActive('/')}`}>
            <HiOutlineHome className="sidebar-icon" />
            <span>Dashboard</span>
          </Link>

          {showConversion && (
            <>
              <Link to="/pdfs/upload" className={`sidebar-link ${isActive('/pdfs/upload')}`}>
                <HiOutlineCloudUpload className="sidebar-icon" />
                <span>Upload PDF</span>
              </Link>
              <Link to="/epub-sync-import" className={`sidebar-link ${isActive('/epub-sync-import')}`}>
                <HiOutlineBookOpen className="sidebar-icon" />
                <span>EPUB → sync</span>
              </Link>
              <Link to="/pdfs" className={`sidebar-link ${isActive('/pdfs')}`}>
                <HiOutlineDocument className="sidebar-icon" />
                <span>PDFs</span>
              </Link>
              <Link to="/conversions" className={`sidebar-link ${isActive('/conversions')}`}>
                <HiOutlineRefresh className="sidebar-icon" />
                <span>Conversions</span>
              </Link>
            </>
          )}

          {showAi && (
            <Link to="/ai-config" className={`sidebar-link ${isActive('/ai-config')}`}>
              <HiOutlineCog className="sidebar-icon" />
              <span>AI Config</span>
            </Link>
          )}
          {showTts && (
            <Link to="/tts-management" className={`sidebar-link ${isActive('/tts-management')}`}>
              <HiOutlineSpeakerphone className="sidebar-icon" />
              <span>TTS Management</span>
            </Link>
          )}
          {showAccessibility && (
            <Link to="/accessibility" className={`sidebar-link ${isActive('/accessibility')}`}>
              <HiOutlineShieldCheck className="sidebar-icon" />
              <span>Accessibility</span>
            </Link>
          )}
          {showEpubTools && (
            <Link to="/epub-checker" className={`sidebar-link ${isActive('/epub-checker')}`}>
              <HiOutlineClipboardCheck className="sidebar-icon" />
              <span>EPUB Checker</span>
            </Link>
          )}

          {showInteractive && (
            <Link to="/interactive" className={`sidebar-link ${isActive('/interactive')}`}>
              <HiOutlineBookOpen className="sidebar-icon" />
              <span>Interactive</span>
            </Link>
          )}

          <Link to="/activity" className={`sidebar-link ${isActive('/activity')}`}>
            <HiOutlineClipboardList className="sidebar-icon" />
            <span>Activity</span>
          </Link>

          {isPlatformAdmin && (
            <>
              <Link to="/admin/organizations" className={`sidebar-link ${isActive('/admin/organizations')}`}>
                <HiOutlineOfficeBuilding className="sidebar-icon" />
                <span>Admin — Orgs</span>
              </Link>
              <Link to="/admin/plans" className={`sidebar-link ${isActive('/admin/plans')}`}>
                <HiOutlineTemplate className="sidebar-icon" />
                <span>Admin — Plans</span>
              </Link>
            </>
          )}

          {isOrgAdmin && (
            <Link to="/org/team" className={`sidebar-link ${isActive('/org/team')}`}>
              <HiOutlineUsers className="sidebar-icon" />
              <span>Team users</span>
            </Link>
          )}
        </nav>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
