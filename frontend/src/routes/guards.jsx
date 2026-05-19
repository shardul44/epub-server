/**
 * Route guards — small, composable wrappers used in routes/AppRouter.jsx.
 *
 * Why this file exists:
 *   - Keeps App.jsx readable.
 *   - Centralises the "wait for auth, then decide" pattern so we don't
 *     accidentally redirect the user to /login during the initial /auth/me
 *     fetch on hard refresh.
 *
 * Auth state comes straight from the Redux auth slice. We do NOT use the
 * legacy AuthContext here — that context is only kept for backwards
 * compatibility with older components.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '../store/hooks';
import {
  selectUser,
  selectAuthStatus,
} from '../features/auth/authSlice';
import { hasAnyFeature, hasFeature } from '../utils/features';
import RouteFallback from '../layouts/RouteFallback';

/**
 * RequireAuth — used as a layout route that gates everything beneath it.
 *
 * On hard refresh:
 *   1. authSlice starts in status='loading'
 *   2. AuthProvider dispatches refreshUser() once
 *   3. We render a fallback until status is 'succeeded' or 'failed'
 *   4. Only after a definitive answer do we redirect to /login if needed
 *
 * This prevents the "logged in but bounced to /login on refresh" bug.
 */
export function RequireAuth() {
  const user     = useAppSelector(selectUser);
  const status   = useAppSelector(selectAuthStatus);
  const location = useLocation();

  // While the boot /auth/me request is still in flight, show a neutral
  // placeholder. Returning null here would unmount the whole tree and
  // cause a flash of unstyled content on slow networks.
  //
  // Do NOT treat `idle` as loading: `logout()` sets status to `idle` with a
  // null user — we must fall through to the login redirect instead of showing
  // an infinite spinner on protected routes.
  if (status === 'loading') {
    return <RouteFallback />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

/**
 * RequireRole — restrict to a specific user role.
 *
 * Usage:
 *   <Route element={<RequireRole role="org_admin" />}>
 *     <Route path="org/team" element={<OrgTeam />} />
 *   </Route>
 */
export function RequireRole({ role, redirectTo = '/' }) {
  const user   = useAppSelector(selectUser);
  const status = useAppSelector(selectAuthStatus);

  if (status === 'loading') return <RouteFallback />;
  if (user?.role !== role)  return <Navigate to={redirectTo} replace />;
  return <Outlet />;
}

/**
 * RequireFeature — restrict to a plan feature flag.
 */
export function RequireFeature({ featureKey, redirectTo = '/' }) {
  const user   = useAppSelector(selectUser);
  const status = useAppSelector(selectAuthStatus);

  if (status === 'loading')           return <RouteFallback />;
  if (!hasFeature(user, featureKey))  return <Navigate to={redirectTo} replace />;
  return <Outlet />;
}

/** Allow route when the user has at least one of the listed plan features. */
export function RequireAnyFeature({ featureKeys, redirectTo = '/' }) {
  const user   = useAppSelector(selectUser);
  const status = useAppSelector(selectAuthStatus);

  if (status === 'loading') return <RouteFallback />;
  if (!hasAnyFeature(user, featureKeys)) return <Navigate to={redirectTo} replace />;
  return <Outlet />;
}

/**
 * Composable element-wrappers — for situations where a single child route
 * needs a guard but you don't want to nest a whole new layout route.
 */
export function RequirePlatformAdmin({ children }) {
  const user   = useAppSelector(selectUser);
  const status = useAppSelector(selectAuthStatus);
  if (status === 'loading')                return <RouteFallback />;
  if (user?.role !== 'platform_admin')     return <Navigate to="/" replace />;
  return children;
}

export function RequireOrgAdmin({ children }) {
  const user   = useAppSelector(selectUser);
  const status = useAppSelector(selectAuthStatus);
  if (status === 'loading')          return <RouteFallback />;
  if (user?.role !== 'org_admin')    return <Navigate to="/" replace />;
  return children;
}

export function RequirePlanFeature({ featureKey, children }) {
  const user   = useAppSelector(selectUser);
  const status = useAppSelector(selectAuthStatus);
  if (status === 'loading')              return <RouteFallback />;
  if (!hasFeature(user, featureKey))     return <Navigate to="/" replace />;
  return children;
}
