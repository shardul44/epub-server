import React from 'react';
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
} from 'react-icons/hi';
import HealthCheck from '../HealthCheck';
import './Layout.css';

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Hide sidebar and nav for full-screen pages (Sync Studio, EPUB Image Editor, FXL Zoning Studio, FXL Sync Studio)
  const isFullScreenPage = location.pathname.startsWith('/sync-studio') || 
                           location.pathname.startsWith('/reader/epub') ||
                           location.pathname.startsWith('/epub-image-editor') ||
                           location.pathname.startsWith('/kitaboo-studio') ||
                           location.pathname.startsWith('/fxl-sync-studio');

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/' ? 'active' : '';
    }
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  // Full-screen layout (no sidebar, no navbar)
  if (isFullScreenPage) {
    return (
      <div className="layout layout-fullscreen">
        <main className="main-content main-content-fullscreen">
          <Outlet />
        </main>
      </div>
    );
  }

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
          <Link to="/ai-config" className={`sidebar-link ${isActive('/ai-config')}`}>
            <HiOutlineCog className="sidebar-icon" />
            <span>AI Config</span>
          </Link>
          <Link to="/tts-management" className={`sidebar-link ${isActive('/tts-management')}`}>
            <HiOutlineSpeakerphone className="sidebar-icon" />
            <span>TTS Management</span>
          </Link>
          <Link to="/accessibility" className={`sidebar-link ${isActive('/accessibility')}`}>
            <HiOutlineShieldCheck className="sidebar-icon" />
            <span>Accessibility</span>
          </Link>
          <Link to="/epub-checker" className={`sidebar-link ${isActive('/epub-checker')}`}>
            <HiOutlineClipboardCheck className="sidebar-icon" />
            <span>EPUB Checker</span>
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

