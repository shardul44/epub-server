/**
 * RootLayout — top-level authenticated layout selector.
 *
 * Picks the correct inner layout based on the user's role:
 *   - org_admin       → OrgAdminLayout
 *   - platform_admin  → PlatformAdminLayout
 *   - everyone else   → DefaultLayout
 *
 * Renders the matched layout's <Outlet /> so child routes mount inside it.
 *
 * Auth gating happens upstream in routes/guards.jsx (RequireAuth) so this
 * component can assume a user exists.
 */
import { Suspense } from 'react';
import { useAppSelector } from '../store/hooks';
import { selectUser } from '../features/auth/authSlice';
import OrgAdminLayout from './OrgAdminLayout';
import PlatformAdminLayout from './PlatformAdminLayout';
import DefaultLayout from './DefaultLayout';
import RouteFallback from './RouteFallback';

export default function RootLayout() {
  const user = useAppSelector(selectUser);
  const role = user?.role;

  let Layout = DefaultLayout;
  if (role === 'org_admin')      Layout = OrgAdminLayout;
  if (role === 'platform_admin') Layout = PlatformAdminLayout;

  return (
    <Suspense fallback={<RouteFallback />}>
      <Layout />
    </Suspense>
  );
}
