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
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './Login.css';

const EASE_PREMIUM = [0.16, 1, 0.3, 1];

const IconEnvelope = () => (
  <svg className="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);

const IconLock = () => (
  <svg className="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const IconSignIn = () => (
  <svg className="login-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
  </svg>
);

const IconBolt = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
  </svg>
);

const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const IconChart = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M3 3v18h18M7 16l4-4 4 4 5-6" />
  </svg>
);

const IconTrustShieldCheck = () => (
  <svg className="login-trust-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const IconTrustLock = () => (
  <svg className="login-trust-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const IconTrustUptime = () => (
  <svg className="login-trust-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
    <path d="M5.5 14.5A7 7 0 0 1 19 12" />
    <path d="M17 10l2.5 2.5L17 15" />
  </svg>
);

const REMEMBER_EMAIL_KEY = 'loginRememberEmail';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const reduceMotion = useReducedMotion();

  const authError = useAppSelector(selectAuthError);
  const isLoading = useAppSelector(selectAuthLoading);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [localError, setLocalError] = useState('');
  const [toast, setToast] = useState({ open: false, message: '' });
  const toastTimerRef = useRef(null);

  useEffect(() => {
    if (authError) dispatch(clearAuthError());
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      try {
        if (rememberMe) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
        else localStorage.removeItem(REMEMBER_EMAIL_KEY);
      } catch {
        /* ignore */
      }
      dispatch(showToast({ type: 'success', message: 'Welcome back!' }));
      return;
    }

    const message = result.payload || 'Login failed';
    const lower = String(message).toLowerCase();
    if (lower.includes('invalid')) {
      showInlineToast('Invalid email or password. Please try again.');
    }
  };

  const displayedError = localError || authError;

  const enter = (duration = 0.5, delay = 0) =>
    reduceMotion ? { duration: 0 } : { duration, delay, ease: EASE_PREMIUM };

  return (
    <div className="login-page">
      <AnimatePresence>
        {toast.open && (
          <motion.div
            key="login-toast"
            className="auth-toast"
            role="status"
            initial={reduceMotion ? false : { opacity: 0, y: -16, scale: 0.97, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10, scale: 0.98, filter: 'blur(4px)' }}
            transition={enter(0.32)}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.aside
        className="login-hero"
        aria-label="Product overview"
        initial={reduceMotion ? false : { opacity: 0, x: -32 }}
        animate={{ opacity: 1, x: 0 }}
        transition={enter(0.55)}
      >
        <div className="login-hero-bg" aria-hidden />
        <div className="login-hero-inner">
          <div className="login-hero-main">
            <header className="login-brand">
              <div className="login-brand-mark" aria-hidden>
                <span className="login-brand-p">P</span>
              </div>
              <div className="login-brand-text">
                <span className="login-brand-title">PDF to EPUB</span>
                <span className="login-brand-sub">PLATFORM</span>
              </div>
            </header>

            <span className="login-badge">#1 Conversion Platform</span>

            <h1 className="login-hero-headline">
              Transform PDFs into interactive EPUBs{' '}
              <span className="login-hero-accent">effortlessly</span>
            </h1>
            <p className="login-hero-lede">
              Trusted by teams worldwide to convert, manage, and deliver content with precision and speed.
            </p>

            <ul className="login-features">
              <li>
                <span className="login-feature-icon login-feature-icon--blue" aria-hidden>
                  <IconBolt />
                </span>
                <div>
                  <strong>Fast &amp; Reliable</strong>
                  <p>Convert large files in seconds with enterprise-grade performance.</p>
                </div>
              </li>
              <li>
                <span className="login-feature-icon login-feature-icon--green" aria-hidden>
                  <IconShield />
                </span>
                <div>
                  <strong>Secure &amp; Private</strong>
                  <p>Your files are encrypted and handled with the highest security standards.</p>
                </div>
              </li>
              <li>
                <span className="login-feature-icon login-feature-icon--purple" aria-hidden>
                  <IconChart />
                </span>
                <div>
                  <strong>Powerful Dashboard</strong>
                  <p>Track your conversions, manage files, and analyze performance in real-time.</p>
                </div>
              </li>
            </ul>
          </div>

          <div className="login-illustration" aria-hidden>
            <div className="login-illustration-orbit" />
            <div className="login-illustration-stage">
              <div className="login-illustration-doc-wrap login-illustration-doc-wrap--pdf">
                <div className="login-illustration-doc">
                  <span className="login-illustration-fold" />
                  <span className="login-illustration-tag login-illustration-tag--red">PDF</span>
                  <span className="login-illustration-lines">
                    <span className="login-illustration-line" />
                    <span className="login-illustration-line" />
                    <span className="login-illustration-line login-illustration-line--short" />
                    <span className="login-illustration-line" />
                  </span>
                </div>
              </div>

              <div className="login-illustration-hub">
                <svg className="login-illustration-hub-svg" viewBox="0 0 64 64" width="64" height="64">
                  <defs>
                    <linearGradient id="loginHubGrad" x1="18%" y1="12%" x2="82%" y2="92%">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="45%" stopColor="#2563eb" />
                      <stop offset="100%" stopColor="#1d4ed8" />
                    </linearGradient>
                  </defs>
                  <circle cx="32" cy="32" r="28" fill="url(#loginHubGrad)" />
                  <path
                    d="M22 32h20M34 24l8 8-8 8"
                    stroke="#fff"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    className="login-illustration-hub-arrow"
                  />
                </svg>
              </div>

              <div className="login-illustration-doc-wrap login-illustration-doc-wrap--epub">
                <div className="login-illustration-doc">
                  <span className="login-illustration-fold" />
                  <span className="login-illustration-tag login-illustration-tag--green">EPUB</span>
                  <span className="login-illustration-lines">
                    <span className="login-illustration-line" />
                    <span className="login-illustration-line" />
                    <span className="login-illustration-line login-illustration-line--short" />
                    <span className="login-illustration-line" />
                  </span>
                </div>
              </div>
            </div>
          </div>

          <footer className="login-hero-footer">© 2026 PDF to EPUB Platform. All rights reserved.</footer>
        </div>
      </motion.aside>

      <motion.main
        className="login-panel"
        initial={reduceMotion ? false : { opacity: 0, x: 28 }}
        animate={{ opacity: 1, x: 0 }}
        transition={enter(0.52, 0.04)}
      >
        <div className="login-panel-ambient" aria-hidden />
        <div className="login-panel-inner">
          <motion.div
            className="login-card login-card--glass"
            initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={enter(0.55, 0.08)}
          >
            <h2 className="login-welcome">
              Welcome back! <span aria-hidden>👋</span>
            </h2>
            <p className="login-welcome-sub">Sign in to your account to continue</p>

            <AnimatePresence mode="wait">
              {displayedError && (
                <motion.div
                  key={String(displayedError)}
                  className="auth-error"
                  initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
                  transition={enter(0.22)}
                >
                  {displayedError}
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="login-email">Email address</label>
                <div className="login-input-shell">
                  <IconEnvelope />
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    autoComplete="email"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="login-password">Password</label>
                <div className="login-input-shell login-input-shell--password">
                  <IconLock />
                  <input
                    id="login-password"
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

              <div className="login-form-row">
                <label className="login-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={isLoading}
                  />
                  <span>Remember me</span>
                </label>
                <button
                  type="button"
                  className="login-forgot"
                  onClick={() =>
                    showInlineToast('Please contact your administrator to reset your password.')
                  }
                  disabled={isLoading}
                >
                  Forgot password?
                </button>
              </div>

              <div className="auth-actions">
                <motion.button
                  type="submit"
                  className="auth-btn auth-btn-primary"
                  disabled={isLoading}
                  whileHover={reduceMotion || isLoading ? undefined : { scale: 1.015 }}
                  whileTap={reduceMotion || isLoading ? undefined : { scale: 0.985 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                >
                  <IconSignIn />
                  {isLoading ? 'Signing in…' : 'Sign in to your account'}
                </motion.button>
              </div>
            </form>

            <div className="login-card-footer">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="login-card-footer-link"
                onClick={() =>
                  showInlineToast('Please contact your administrator to create an account.')
                }
                disabled={isLoading}
              >
                Contact your administrator
              </button>
            </div>
          </motion.div>

          <motion.div
            className="login-trust"
            role="group"
            aria-label="Trust and security"
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={enter(0.45, reduceMotion ? 0 : 0.18)}
          >
            <div className="login-trust-item">
              <span className="login-trust-icon" aria-hidden>
                <IconTrustShieldCheck />
              </span>
              <span className="login-trust-copy">
                <span className="login-trust-title">AI-Powered</span>
                <span className="login-trust-desc">Processing</span>
              </span>
            </div>
            <div className="login-trust-item">
              <span className="login-trust-icon" aria-hidden>
                <IconTrustLock />
              </span>
              <span className="login-trust-copy">
                <span className="login-trust-title">256-bit</span>
                <span className="login-trust-desc">Encryption</span>
              </span>
            </div>
            <div className="login-trust-item">
              <span className="login-trust-icon" aria-hidden>
                <IconTrustUptime />
              </span>
              <span className="login-trust-copy">
                <span className="login-trust-title">99.9%</span>
                <span className="login-trust-desc">Uptime</span>
              </span>
            </div>
          </motion.div>
        </div>
      </motion.main>
    </div>
  );
};

export default Login;
