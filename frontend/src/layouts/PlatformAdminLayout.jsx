/**
 * PlatformAdminLayout — sidebar layout for platform_admin role.
 *
 * Replaces the platform-admin branch of the old monolithic Layout.jsx.
 * Mirrors OrgAdminLayout in structure but mounts AdminSidebar.
 */
import { useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectSidebarCollapsed, setSidebarCollapsed } from '../slices/uiSlice';
import '../components/layout/Layout.css';

export default function PlatformAdminLayout() {
  const dispatch  = useAppDispatch();
  const collapsed = useAppSelector(selectSidebarCollapsed);

  const handleSidebarCollapse = useCallback(
    (next) => dispatch(setSidebarCollapsed(next)),
    [dispatch],
  );

  return (
    <div className={`layout layout--org-admin${collapsed ? ' layout--sb-collapsed' : ''}`}>
      <AdminSidebar onCollapse={handleSidebarCollapse} />
      <main className="main-content main-content--org-admin">
        <Outlet />
      </main>
    </div>
  );
}
