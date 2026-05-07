/**
 * AdminSidebar.jsx
 *
 * Sidebar for platform_admin role.
 * Uses the exact same CSS classes and visual style as the sidebar in Layout.jsx
 * (sidebar, sidebar-nav, sidebar-link, sidebar-icon, active).
 *
 * Routes:
 *   /admin/organizations  — Manage orgs / tenants
 *   /admin/plans          — Plans & feature catalog
 *   /activity             — Platform-wide activity log
 *
 * Props:
 *   onCollapse(collapsed: boolean) — notifies Layout so main content can shift
 */

import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  LayoutTemplate,
  Activity,
  LogOut,
  BookOpen,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/* Reuse the exact same stylesheet that drives the sidebar in Layout.jsx */
import './layout/Layout.css';
import './AdminSidebar.css';

/* ─── AdminSidebar ────────────────────────────────────────────────────────── */

const AdminSidebar = ({ onCollapse }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);

  /* Close mobile drawer on route change */
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  /* Notify parent — admin sidebar is always full-width (never collapses to icon) */
  useEffect(() => {
    onCollapse?.(false);
  }, [onCollapse]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  /* Returns 'active' string when route matches — same helper as Layout.jsx */
  const isActive = (path) => {
    if (path === '/') return location.pathname === '/' ? 'active' : '';
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  return (
    <>
      {/* ── Mobile hamburger (≤ 768px) ── */}
      <button
        className="admin-mobile-toggle"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        type="button"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar — same markup pattern as Layout.jsx ── */}
      <aside className={`sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`}>

        {/* Brand — same style as .navbar-brand in Layout.jsx */}
        <div className="admin-sidebar-brand">
          <BookOpen className="navbar-brand-icon" />
          <div className="navbar-brand-text">
            <span className="navbar-brand-title">PDF to EPUB</span>
            <span className="navbar-brand-subtitle">Platform Admin</span>
          </div>
        </div>

        <nav className="sidebar-nav">

          {/* ── Administration ── */}
          <span className="admin-sidebar-section-label">Administration</span>

          <Link
            to="/admin/organizations"
            className={`sidebar-link ${isActive('/admin/organizations')}`}
          >
            <Building2 className="sidebar-icon" />
            <span>Organizations</span>
          </Link>

          <Link
            to="/admin/plans"
            className={`sidebar-link ${isActive('/admin/plans')}`}
          >
            <LayoutTemplate className="sidebar-icon" />
            <span>Plans &amp; Features</span>
          </Link>

          {/* ── Monitoring ── */}
          <span className="admin-sidebar-section-label">Monitoring</span>

          <Link
            to="/activity"
            className={`sidebar-link ${isActive('/activity')}`}
          >
            <Activity className="sidebar-icon" />
            <span>Activity Log</span>
          </Link>

        </nav>

        {/* ── Footer: user info + logout ── */}
        <div className="admin-sidebar-footer">
          {user && (
            <div className="admin-sidebar-user">
              <div className="admin-sidebar-avatar" aria-hidden="true">
                {(user.name || user.email || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="admin-sidebar-user-info">
                <span className="admin-sidebar-user-name">
                  {user.name || user.email?.split('@')[0] || 'Admin'}
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

export default AdminSidebar;
