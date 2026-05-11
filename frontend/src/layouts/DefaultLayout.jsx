/**
 * DefaultLayout — original navbar + sidebar layout for users that are
 * neither platform_admin nor org_admin.
 *
 * Replaces the "all other roles" branch of the old monolithic Layout.jsx.
 *
 * Key changes:
 *   - Active link is computed from useLocation() (URL is the source of
 *     truth for navigation state).
 *   - Logout dispatches the existing `logout` action and uses navigate()
 *     instead of mutating localStorage + window.location.href.
 */
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
import HealthCheck from '../components/HealthCheck';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { logout, selectUser } from '../features/auth/authSlice';
import { hasFeature } from '../utils/features';
import '../components/layout/Layout.css';

export default function DefaultLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const user     = useAppSelector(selectUser);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/' ? 'active' : '';
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  const showConversion    = hasFeature(user, 'conversion.basic');
  const showEpubTools     = hasFeature(user, 'epub_tools');
  const showAccessibility = hasFeature(user, 'accessibility_tools');
  const showAi            = hasFeature(user, 'ai_config');
  const showTts           = hasFeature(user, 'tts_management');
  const showInteractive   = hasFeature(user, 'interactive.content');

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
}
