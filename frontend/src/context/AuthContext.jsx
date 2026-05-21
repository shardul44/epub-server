/**
 * AuthContext — compatibility bridge over the Redux auth slice.
 *
 * All existing components that call `useAuth()` continue to work unchanged.
 * New code should prefer importing selectors and thunks from authSlice directly.
 *
 * What changed:
 *  - State is now owned by Redux (authSlice).
 *  - This context simply re-exports the same shape { user, loading, setUser, refreshUser }
 *    so zero call-sites need to be touched.
 */
import React, { createContext, useContext, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  selectUser,
  selectAuthLoading,
  selectAuthStatus,
  setUser,
  refreshUser as refreshUserThunk,
} from '../features/auth/authSlice';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const dispatch = useDispatch();
  const user     = useSelector(selectUser);
  const loading  = useSelector(selectAuthLoading);
  const status   = useSelector(selectAuthStatus);

  // Boot-time: restore session from persisted token.
  // We dispatch once on mount. The thunk's own `condition` guard (in authSlice)
  // prevents duplicate in-flight calls from React Strict Mode double-invocation.
  // We skip only if we already have a confirmed result (succeeded/failed) so we
  // don't re-fetch on every re-mount after the initial boot.
  useEffect(() => {
    if (status === 'succeeded' || status === 'failed') return;
    dispatch(refreshUserThunk());
  }, []);  

  // Stable reference so Layout's useEffect dependency never changes identity.
  const refreshUser   = useCallback(() => dispatch(refreshUserThunk()), [dispatch]);
  const handleSetUser = useCallback((u) => dispatch(setUser(u)), [dispatch]);

  const value = { user, loading, setUser: handleSetUser, refreshUser };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
