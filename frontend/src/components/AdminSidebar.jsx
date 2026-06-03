/**
 * AdminSidebar.jsx
 *
 * Platform administrator sidebar — grouped nav matching the product shell
 * (Overview / Management / Configuration). Routes mirror AppRouter.jsx.
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Activity,
  BarChart3,
  Briefcase,
  Package,
  Users,
  RefreshCw,
  Settings,
  CreditCard,
  Terminal,
  Inbox,
  LogOut,
  Menu,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import useLogout from '../hooks/useLogout';
import { useAppBootstrap } from '../hooks/queries/useAppBootstrap';
import { adminService } from '../services/adminService';

import './layout/Layout.css';
import './AdminSidebar.css';

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
  return <span className={`admin-sidebar-badge admin-sidebar-badge--${tone}`}>{text}</span>;
}

const AdminSidebar = ({ onCollapse }) => {
  const location = useLocation();
  const { user } = useAuth();
  const onLogout = useLogout();
  const { activities, users } = useAppBootstrap();

  const { data: organizations = [] } = useQuery({
    queryKey: ['admin', 'organizations', 'sidebar'],
    queryFn: () => adminService.getOrganizations(),
    staleTime: 60 * 1000,
  });

  const { data: pendingPlanRequests = 0 } = useQuery({
    queryKey: ['admin', 'plan-requests', 'pending-count'],
    queryFn: () => adminService.getPlanRequestsPendingCount(),
    staleTime: 30 * 1000,
    retry: false,
  });

  const [mobileOpen, setMobileOpen] = useState(false);

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

  useEffect(() => {
    onCollapse?.(false);
  }, [onCollapse]);

  const closeMobile = () => setMobileOpen(false);

  const path = location.pathname;

  const active = useMemo(
    () => ({
      home: path === '/' || path === '',
      activity: path.startsWith('/admin/activity') || path.startsWith('/activity'),
      analytics: path.startsWith('/admin/analytics'),
      orgs: path.startsWith('/admin/organizations'),
      planRequests: path.startsWith('/admin/plan-requests'),
      plans: path.startsWith('/admin/plans'),
      users: path.startsWith('/admin/users'),
      conversions: path.startsWith('/admin/conversions'),
      settings: path.startsWith('/admin/settings') || path.startsWith('/admin/tts-management'),
      billing: path.startsWith('/admin/billing'),
      logs: path.startsWith('/admin/system-logs'),
    }),
    [path],
  );

  const activityCount = Array.isArray(activities) ? activities.length : 0;
  const userCount = Array.isArray(users) ? users.length : 0;
  const orgCount = Array.isArray(organizations) ? organizations.length : 0;

  return (
    <>
      <button
        className="admin-mobile-toggle"
        onClick={() => setMobileOpen((open) => !open)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileOpen}
        type="button"
      >
        <Menu size={20} />
      </button>
      {mobileOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
        <div className="admin-sidebar-brand">
          <div className="admin-sidebar-brand-mark" aria-hidden>
            <img src="/Tunr_Logo-01.svg" alt="" className="admin-sidebar-brand-logo" />
          </div>
          <div className="navbar-brand-text">
            <span className="navbar-brand-title">PDF to EPUB</span>
            <span className="navbar-brand-subtitle admin-sidebar-brand-tag">Converter</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <span className="admin-sidebar-section-label">Overview</span>
          <NavRow to="/" icon={Home} label="Dashboard" isActive={active.home} onClick={closeMobile} />

          <NavRow
            to="/admin/analytics"
            icon={BarChart3}
            label="Analytics"
            isActive={active.analytics}
            onClick={closeMobile}
          />
          <span className="admin-sidebar-section-label">Management</span>
          <NavRow
            to="/admin/organizations"
            icon={Briefcase}
            label="Organizations"
            isActive={active.orgs}
            end={<CountBadge count={orgCount} tone="blue" />}
            onClick={closeMobile}
          />
          <NavRow
            to="/admin/plan-requests"
            icon={Inbox}
            label="Plan requests"
            isActive={active.planRequests}
            end={<CountBadge count={pendingPlanRequests} tone="amber" />}
            onClick={closeMobile}
          />
          <NavRow
            to="/admin/plans"
            icon={Package}
            label="Plans & Features"
            isActive={active.plans}
            onClick={closeMobile}
          />
          <NavRow
            to="/admin/users"
            icon={Users}
            label="User Management"
            isActive={active.users}
            end={<CountBadge count={userCount} tone="amber" />}
            onClick={closeMobile}
          />
          <NavRow
            to="/admin/conversions"
            icon={RefreshCw}
            label="Conversions"
            isActive={active.conversions}
            onClick={closeMobile}
          />
          <span className="admin-sidebar-section-label">Configuration</span>
          <NavRow
            to="/admin/activity"
            icon={Activity}
            label="Activity"
            isActive={active.activity}
            end={<CountBadge count={activityCount} tone="mint" />}
            onClick={closeMobile}
          />

          <NavRow
            to="/admin/billing"
            icon={CreditCard}
            label="Billing & quotas"
            isActive={active.billing}
            onClick={closeMobile}
          />
          <NavRow
            to="/admin/system-logs"
            icon={Terminal}
            label="System Logs"
            isActive={active.logs}
            onClick={closeMobile}
          />
          <NavRow
            to="/admin/settings"
            icon={Settings}
            label="Settings"
            isActive={active.settings}
            onClick={closeMobile}
          />
        </nav>

        <div className="admin-sidebar-footer">
          {user && (
            <div className="admin-sidebar-user">
              <div className="admin-sidebar-avatar" aria-hidden>
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

export default AdminSidebar;
