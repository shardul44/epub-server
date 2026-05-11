import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  loginUser,
  clearAuthError,
  selectAuthError,
  selectAuthLoading,
  selectIsAuthenticated,
} from '../features/auth/authSlice';
import { showToast } from '../slices/uiSlice';
import './Login.css';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  const authError      = useAppSelector(selectAuthError);
  const isLoading      = useAppSelector(selectAuthLoading);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError]     = useState('');
  const [toast, setToast]               = useState({ open: false, message: '' });
  const toastTimerRef                   = useRef(null);

  // Clean up any leftover error from a previous session when the form mounts.
  useEffect(() => {
    if (authError) dispatch(clearAuthError());
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once Redux confirms the user is authenticated, redirect.
  // `replace: true` so the back button doesn't return to /login.
  // We honor the redirect path the guard captured (location.state.from).
  useEffect(() => {
    if (!isAuthenticated) return;
    const target = location.state?.from?.pathname ?? '/';
    navigate(target, { replace: true });
  }, [isAuthenticated, navigate, location.state]);

  const showInlineToast = (message) => {
    setToast({ open: true, message });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((t) => ({ ...t, open: false }));
    }, 3000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');

    if (!email || !password) {
      setLocalError('Please enter email and password');
      return;
    }

    const result = await dispatch(loginUser({ email, password }));

    if (loginUser.fulfilled.match(result)) {
      // Redirect happens via the useEffect above as soon as
      // selectIsAuthenticated flips to true.
      dispatch(showToast({ type: 'success', message: 'Welcome back!' }));
      return;
    }

    // Rejected — surface the error inline AND via toast for invalid creds.
    const message = result.payload || 'Login failed';
    const lower   = String(message).toLowerCase();
    if (lower.includes('invalid')) {
      showInlineToast('Invalid email or password. Please try again.');
    }
  };

  const displayedError = localError || authError;

  return (
    <div className="login-container">
      {toast.open && <div className="auth-toast">{toast.message}</div>}
      <div className="login-card">
        <h2>Log in</h2>
        <p className="login-subtitle">
          Access your PDFs, conversions, and accessibility tools securely.
        </p>
        {displayedError && <div className="auth-error">{displayedError}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={isLoading}
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div className="pw-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                disabled={isLoading}
              />
              <button
                type="button"
                className="pw-toggle-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                disabled={isLoading}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="auth-actions">
            <button
              type="submit"
              className="auth-btn auth-btn-primary"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in…' : 'Login'}
            </button>
          </div>
        </form>
        <div className="auth-footer">
          <span>Don't have an account?</span>
          <button
            type="button"
            className="auth-link-button"
            onClick={() => navigate('/register')}
            disabled={isLoading}
          >
            Create one
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
