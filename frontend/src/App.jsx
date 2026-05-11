/**
 * App — top-level component.
 *
 * Responsibilities:
 *   - Mount the AuthProvider (compatibility bridge over Redux auth).
 *   - Wrap the route tree in a route-aware ErrorBoundary that auto-resets
 *     when the user navigates to a different path.
 *   - Render the central <AppRouter /> (route definitions live there).
 *
 * Redux Provider, BrowserRouter, QueryClientProvider, and the global
 * Toaster are all set up in main.jsx.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import AppRouter from './routes/AppRouter';

/**
 * RouteAwareErrorBoundary — passes the current pathname as the boundary's
 * `resetKey` so a render error on one page doesn't lock the entire app
 * out of navigation. Once the user moves to a different route, the
 * boundary resets automatically.
 */
function RouteAwareErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <AuthProvider>
      <RouteAwareErrorBoundary>
        <AppRouter />
      </RouteAwareErrorBoundary>
    </AuthProvider>
  );
}
