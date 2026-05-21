/**
 * useLogout — clears React Query cache, Redux auth, and navigates to login.
 *
 * Use this instead of dispatching `logout()` directly so cached server data
 * does not leak across user sessions.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '../store/hooks';
import { logout } from '../features/auth/authSlice';
import { queryClient } from '../lib/queryClient';

export function useLogout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return useCallback(() => {
    queryClient.clear();
    dispatch(logout());
    navigate('/login', { replace: true });
  }, [dispatch, navigate]);
}

export default useLogout;
